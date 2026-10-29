import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { TaskModel } from "../../../src/core/db/orm.js";
import {
  WEBHOOK_RETRY_DELAYS,
  buildEventEnvelope,
  dispatchEvent,
  normalizeEvents,
  processWebhookQueueMessage,
  signPayload,
  webhookSubscribesTo,
} from "../../../src/modules/webhooks/service.js";
import type { FetchLike } from "../../../src/modules/webhooks/service.js";
import { Queue } from "../../../src/core/runtime/queue.js";
import {
  createTestUser,
  deleteJson,
  getJson,
  postJson,
  startTestApp,
} from "../../helpers/test-app.js";

describe("signature helpers", () => {
  test("signPayload matches a manual HMAC over '<ts>.<body bytes>'", () => {
    const body = Buffer.from(JSON.stringify({ a: 1 }), "utf8");
    const expected = createHmac("sha256", "whsec_test").update(`1720000000.`, "utf8").update(body).digest("hex");
    expect(signPayload("whsec_test", 1720000000, body)).toBe(expected);
  });

  test("normalizeEvents defaults, dedupes, and validates", () => {
    expect(normalizeEvents(undefined)).toEqual(["task.completed", "task.failed"]);
    expect(normalizeEvents(" Task.Running ,task.running")).toEqual(["task.running"]);
    expect(() => normalizeEvents("nope")).toThrow();
  });

  test("webhookSubscribesTo matches case-insensitively", () => {
    expect(webhookSubscribesTo("task.completed,task.failed", "TASK.COMPLETED")).toBe(true);
    expect(webhookSubscribesTo(null, "task.completed")).toBe(false);
  });
});

describe("webhook routes", () => {
  test("CRUD: create reveals secret once, list masks it, rotate, delete", async () => {
    const app = await startTestApp("webhooks-crud");
    try {
      const user = await createTestUser(app, "wh@example.com");

      const created = await postJson(
        app,
        "/api/webhooks",
        { name: "hook", url: "https://example.com/hook", events: "task.completed" },
        user.token,
      );
      expect(created.status).toBe(201);
      expect(created.body.data.secret).toMatch(/^whsec_/);
      const id: string = created.body.data.id;

      const listed = await getJson(app, "/api/webhooks", user.token);
      expect(listed.body.meta.total).toBe(1);
      expect(listed.body.data[0].secret_hint).toMatch(/^whsec_/);
      expect(listed.body.data[0].secret).toBeUndefined();

      // Invalid URL rejected with 4xx (SSRF-blocked target).
      const bad = await postJson(
        app,
        "/api/webhooks",
        { name: "bad", url: "http://169.254.169.254/x" },
        user.token,
      );
      expect(bad.status).toBeGreaterThanOrEqual(400);

      const rotated = await postJson(app, `/api/webhooks/${id}/rotate-secret`, {}, user.token);
      expect(rotated.body.data.secret).toMatch(/^whsec_/);
      expect(rotated.body.data.secret).not.toBe(created.body.data.secret);

      const deleted = await deleteJson(app, `/api/webhooks/${id}`, user.token);
      expect(deleted.body.data.deleted).toBe(true);

      const missing = await deleteJson(app, "/api/webhooks/wh_missing", user.token);
      expect(missing.status).toBe(404);
    } finally {
      await app.close();
    }
  });

  test("dispatch → deliver via stub fetch; failures retry then land in dead letters", async () => {
    const app = await startTestApp("webhooks-delivery");
    try {
      const user = await createTestUser(app, "dl@example.com");
      const db = app.handle.db;

      const created = await postJson(
        app,
        "/api/webhooks",
        { name: "hook", url: "https://example.com/hook", events: "task.completed" },
        user.token,
      );
      const webhookId: string = created.body.data.id;
      const secret: string = created.body.data.secret;

      const taskId = new TaskModel(db).create({
        userId: user.id,
        url: "https://example.com/do",
        status: "completed",
        type: "http",
        executionType: "immediate",
        scheduledAt: new Date().toISOString(),
        payload: JSON.stringify({ x: 1 }),
      });
      const task = new TaskModel(db).findById(taskId)!;

      // OK path: envelope queued, stub fetch verifies the signature, response captured.
      const okFetch: FetchLike = async (url, init) => {
        const headers = new Headers(init.headers as unknown as Record<string, string>);
        const sig = headers.get("x-runmesh-signature")!;
        const ts = headers.get("x-runmesh-timestamp")!;
        const raw = init.body as Buffer;
        const expected = createHmac("sha256", secret)
          .update(`${ts}.`, "utf8")
          .update(raw)
          .digest("hex");
        expect(url).toBe("https://example.com/hook");
        expect(headers.get("x-runmesh-event")).toBe("task.completed");
        expect(sig).toBe(`t=${ts},v1=${expected}`);
        return new Response("ok", { status: 200 });
      };

      expect(dispatchEvent(db, new Queue(db, "runmesh-webhooks"), user.id, "task.completed", task)).toBe(1);
      expect(dispatchEvent(db, new Queue(db, "runmesh-webhooks"), user.id, "bogus", task)).toBe(0);

      const webhookQueue = new Queue(db, "runmesh-webhooks");
      let received = webhookQueue.receive(10);
      expect(received.length).toBe(1);
      const envelope = JSON.parse(received[0]!.body).body as Record<string, unknown>;
      expect((envelope.data as Record<string, unknown>).task_id).toBe(taskId);

      const seen: string[] = [];
      const queue = {
        send: (message: unknown, delay?: number) => {
          seen.push(JSON.stringify({ message, delay }));
          webhookQueue.send(message as never, delay);
        },
      } as unknown as Queue;

      await processWebhookQueueMessage(db, queue, okFetch, JSON.parse(received[0]!.body));
      expect(seen.length).toBe(0); // success: nothing requeued

      // Failure path: drive all six attempts manually (the DB-backed retry rows carry
      // real future delays, so feed the incremented attempt straight back in) and check
      // the backoff schedule plus the eventual dead letter.
      const failFetch: FetchLike = async () => new Response("boom", { status: 500 });
      const queued = JSON.parse(received[0]!.body) as { body: Record<string, unknown> };

      let attemptBody: Record<string, unknown> = {
        webhook_id: webhookId,
        event: "task.completed",
        body: queued.body,
        delivery_attempt: 1,
      };

      for (let attempt = 1; attempt <= 6; attempt++) {
        const sends: Array<{ message: Record<string, unknown>; delay?: number }> = [];
        const drivingQueue = {
          send: (message: unknown, delay?: number) => {
            sends.push({ message: message as Record<string, unknown>, delay });
          },
        } as unknown as Queue;
        await processWebhookQueueMessage(db, drivingQueue, failFetch, attemptBody);
        if (attempt < 6) {
          expect(sends.length).toBe(1);
          expect(sends[0]!.delay).toBe(WEBHOOK_RETRY_DELAYS[attempt - 1]);
          expect(sends[0]!.message.delivery_attempt).toBe(attempt + 1);
          attemptBody = sends[0]!.message;
        } else {
          expect(sends.length).toBe(0);
        }
      }

      const dead = await getJson(app, "/api/webhooks/dead-letters", user.token);
      expect(dead.body.meta.total).toBe(1);
      expect(dead.body.data[0].event).toBe("task.completed");
      expect(dead.body.data[0].attempts).toBe(6);
      const deadId: string = dead.body.data[0].id;

      const replayed = await postJson(
        app,
        `/api/webhooks/dead-letters/${deadId}/replay`,
        {},
        user.token,
      );
      expect(replayed.body.data.replayed_at).toBeTruthy();
      // receive() is time-gated; the retry row is due now, replay also sends immediately.
      expect(webhookQueue.receive(10).length).toBe(1);

      const dismissed = await deleteJson(app, `/api/webhooks/dead-letters/${deadId}`, user.token);
      expect(dismissed.body.data.deleted).toBe(true);

      // Envelope carry-over: non-JSON task payloads become { raw }.
      const rawId = new TaskModel(db).create({
        userId: user.id,
        url: "https://example.com/do",
        status: "completed",
        type: "http",
        executionType: "immediate",
        scheduledAt: new Date().toISOString(),
        payload: "not-json",
      });
      const rawTask = new TaskModel(db).findById(rawId)!;
      expect((buildEventEnvelope("task.completed", rawTask).data as Record<string, unknown>).payload).toEqual({
        raw: "not-json",
      });
      expect(webhookId).toBeTruthy();
    } finally {
      await app.close();
    }
  });
});
