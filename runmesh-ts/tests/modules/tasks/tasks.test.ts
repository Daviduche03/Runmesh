import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { connectApps, connectConnections, connectGrants, connectUsers } from "../../../src/core/db/schema.js";
import { TaskModel } from "../../../src/core/db/orm.js";
import { Queue } from "../../../src/core/runtime/queue.js";
import {
  buildTaskContext,
  parseStoredResponse,
  renderTemplate,
  resolveTaskRequest,
  validateTemplate,
} from "../../../src/modules/tasks/templating.js";
import { processTaskMessage } from "../../../src/modules/tasks/queue.js";
import { enqueueDueTasks } from "../../../src/modules/tasks/scheduler.js";
import type { FetchLike } from "../../../src/modules/webhooks/service.js";
import {
  createTestUser,
  deleteJson,
  getJson,
  postJson,
  startTestApp,
} from "../../helpers/test-app.js";

describe("templating", () => {
  test("renderTemplate interpolates context and offers a tojson filter", () => {
    expect(renderTemplate("hi {{ task.id }}", { task: { id: "t1" } })).toBe("hi t1");
    expect(renderTemplate("{{ payload | tojson }}", { payload: { a: 1 } })).toBe('{"a":1}');
    // Jinja default: missing names render empty rather than raising.
    expect(renderTemplate("[{{ nope }}]", {})).toBe("[]");
  });

  test("validateTemplate rejects broken syntax with a 400", () => {
    expect(() => validateTemplate("{{ unclosed", "url_template")).toThrow();
    try {
      validateTemplate("{% if %}", "url_template");
      expect.unreachable();
    } catch (err) {
      expect((err as { status?: number }).status).toBe(400);
    }
    validateTemplate("fine {{ task.id }}", "url_template");
    validateTemplate("   ", "url_template");
  });

  test("resolveTaskRequest renders url/payload templates or falls back to stored values", () => {
    const task = {
      id: "t1",
      url: "https://example.com/static",
      payload: JSON.stringify({ n: 7 }),
      urlTemplate: "https://example.com/items/{{ payload.n }}",
      payloadTemplate: '{"echo": {{ payload.n }}, "id": "{{ task.id }}"}',
    };
    const [url, body] = resolveTaskRequest(task);
    expect(url).toBe("https://example.com/items/7");
    expect(body).toEqual({ echo: 7, id: "t1" });

    const [plainUrl, plainBody] = resolveTaskRequest({
      url: "https://example.com/x",
      payload: "not-json",
    });
    expect(plainUrl).toBe("https://example.com/x");
    expect(plainBody).toEqual({ raw: "not-json" });
  });

  test("resolveTaskRequest rejects empty urls and non-JSON payload renders", () => {
    expect(() => resolveTaskRequest({ url: "", payload: "{}" })).toThrow();
    expect(() =>
      resolveTaskRequest({ url: "https://example.com/x", payloadTemplate: "nope{" }),
    ).toThrow();
  });

  test("buildTaskContext normalizes payload shapes like the Python context", () => {
    expect(buildTaskContext({ payload: "[1,2]" }).payload).toEqual({ value: [1, 2] });
    const ctx = buildTaskContext({
      id: "t9",
      status: "queued",
      retries: 0,
      payload: "{}",
    }) as { task: Record<string, unknown>; now: string };
    expect(ctx.task.max_retries).toBe(5);
    expect(ctx.task.step_order).toBe(0);
    expect(typeof ctx.now).toBe("string");
  });

  test("parseStoredResponse mirrors the Python helper", () => {
    expect(parseStoredResponse(null)).toBeNull();
    expect(parseStoredResponse("")).toBeNull();
    expect(parseStoredResponse({ a: 1 })).toEqual({ a: 1 });
    expect(parseStoredResponse('{"a":1}')).toEqual({ a: 1 });
    expect(parseStoredResponse("plain")).toBe("plain");
    expect(parseStoredResponse(5)).toBe(5);
  });
});

describe("task routes", () => {
  test("create → list → delete, with validation and idempotency", async () => {
    const app = await startTestApp("tasks-crud");
    try {
      const user = await createTestUser(app, "tasks@example.com");

      const created = await postJson(
        app,
        "/api/v1/tasks",
        { url: "https://example.com/hook", payload: { a: 1 }, max_retries: 3 },
        user.token,
      );
      expect(created.status).toBe(200);
      expect(created.body.message).toBe("Task queued");
      const taskId: string = created.body.data.task_id;
      expect(taskId).toBeTruthy();

      // The queue holds the new task.
      expect(new Queue(app.handle.db, "runmesh-tasks").size()).toBe(1);

      // Missing url and url_template.
      const missing = await postJson(app, "/api/v1/tasks", { payload: {} }, user.token);
      expect(missing.status).toBe(400);

      // SSRF-blocked static URL.
      const blocked = await postJson(
        app,
        "/api/v1/tasks",
        { url: "http://169.254.169.254/x" },
        user.token,
      );
      expect(blocked.status).toBe(400);

      // Idempotent replay returns the same id without queueing again.
      const replay = await postJson(
        app,
        "/api/v1/tasks",
        { url: "https://example.com/hook", idempotency_key: "k1", payload: {} },
        user.token,
      );
      const replay2 = await postJson(
        app,
        "/api/v1/tasks",
        { url: "https://example.com/other", idempotency_key: "k1", payload: {} },
        user.token,
      );
      expect(replay.body.data.task_id).toBe(replay2.body.data.task_id);
      expect(replay2.body.message).toBe("Task already queued");

      const listed = await getJson(app, "/api/v1/tasks", user.token);
      expect(listed.body.meta.total).toBe(2);
      const row = listed.body.data.find((t: { id: string }) => t.id === taskId);
      expect(row.endpoint).toBe("https://example.com/hook");
      expect(row.status).toBe("Queued");
      expect(row.duration).toBeNull();
      expect(row.retries).toBe(0);

      const badPage = await getJson(app, "/api/v1/tasks?page=nope", user.token);
      expect(badPage.status).toBe(400);

      const deleted = await deleteJson(app, `/api/v1/tasks/${taskId}`, user.token);
      expect(deleted.body.message).toBe("Task deleted");
      expect(deleted.body.data.id).toBe(taskId);

      const gone = await deleteJson(app, "/api/v1/tasks/t_missing", user.token);
      expect(gone.status).toBe(404);
    } finally {
      await app.close();
    }
  });

  test("schedule → scheduled list (snake_case) → cancel / reschedule + legacy aliases", async () => {
    const app = await startTestApp("tasks-scheduled");
    try {
      const user = await createTestUser(app, "sched@example.com");
      const future = new Date(Date.now() + 3600_1000).toISOString();

      const scheduled = await postJson(
        app,
        "/api/v1/tasks/schedule",
        { url: "https://example.com/later", scheduled_at: future, payload: { a: 1 } },
        user.token,
      );
      expect(scheduled.body.message).toBe("Task scheduled");
      expect(scheduled.body.data.scheduled_at).toBe(future);
      const taskId: string = scheduled.body.data.task_id;

      const past = await postJson(
        app,
        "/api/v1/tasks/schedule",
        { url: "https://example.com/later", scheduled_at: "2000-01-01T00:00:00Z" },
        user.token,
      );
      expect(past.status).toBe(400);

      const invalid = await postJson(
        app,
        "/api/v1/tasks/schedule",
        { url: "https://example.com/later", scheduled_at: "not-a-date" },
        user.token,
      );
      expect(invalid.status).toBe(400);

      const listed = await getJson(app, "/api/v1/tasks/scheduled", user.token);
      expect(listed.body.meta.total).toBe(1);
      expect(listed.body.data[0].task_id).toBeUndefined();
      expect(listed.body.data[0].id).toBe(taskId);
      expect(listed.body.data[0].scheduled_at).toBe(future);
      expect(listed.body.data[0].execution_type).toBe("scheduled");

      const cancelled = await postJson(app, `/api/v1/tasks/${taskId}/cancel`, {}, user.token);
      expect(cancelled.body.message).toBe("Task cancelled");
      const cancelledAgain = await postJson(app, `/api/v1/tasks/${taskId}/cancel`, {}, user.token);
      expect(cancelledAgain.status).toBe(400);

      const rescheduled = await postJson(
        app,
        `/api/v1/tasks/${taskId}/reschedule`,
        { scheduled_at: future },
        user.token,
      );
      // A cancelled (non-queued/failed) scheduled task cannot be rescheduled.
      expect(rescheduled.status).toBe(400);

      // Legacy aliases share the versioned handlers.
      const legacyScheduled = await postJson(
        app,
        "/api/v1/task/schedule",
        { url: "https://example.com/legacy", scheduled_at: future },
        user.token,
      );
      expect(legacyScheduled.body.message).toBe("Task scheduled");
      const legacyId: string = legacyScheduled.body.data.task_id;

      const legacyCancel = await postJson(app, `/api/v1/task/${legacyId}/cancel`, {}, user.token);
      expect(legacyCancel.body.message).toBe("Task cancelled");

      const legacyPublish = await postJson(
        app,
        "/api/v1/task/publish",
        { url: "https://example.com/now", payload: {} },
        user.token,
      );
      expect(legacyPublish.body.message).toBe("Task queued");

      const legacyReschedule = await postJson(
        app,
        `/api/v1/task/${legacyId}/reschedule`,
        { scheduled_at: future },
        user.token,
      );
      expect(legacyReschedule.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  test("execution succeeds end-to-end and emits running/completed webhooks", async () => {
    const app = await startTestApp("tasks-execute");
    try {
      const user = await createTestUser(app, "exec@example.com");
      const db = app.handle.db;

      await postJson(
        app,
        "/api/webhooks",
        {
          name: "all",
          url: "https://example.com/hook",
          events: "task.running,task.completed,task.failed",
        },
        user.token,
      );

      const created = await postJson(
        app,
        "/api/v1/tasks",
        {
          url: "https://example.com/do",
          payload: { n: 3 },
          payload_template: '{"got": {{ payload.n }}}',
        },
        user.token,
      );
      const taskId: string = created.body.data.task_id;

      let seenBody: unknown;
      const okFetch: FetchLike = async (_url, init) => {
        seenBody = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      };

      const taskQueue = new Queue(db, "runmesh-tasks");
      const webhookQueue = new Queue(db, "runmesh-webhooks");
      const queued = taskQueue.receive(10);
      expect(queued.length).toBe(1);

      await processTaskMessage(db, taskQueue, webhookQueue, okFetch, JSON.parse(queued[0]!.body));
      expect(seenBody).toEqual({ got: 3 });

      const task = new TaskModel(db).findById(taskId)!;
      expect(task.status).toBe("completed");
      expect(task.responseStatus).toBe(201);
      expect(task.responseBody).toContain('"ok":true');
      expect(task.retries).toBe(0);

      // running + completed webhook deliveries were queued.
      const deliveries = webhookQueue.receive(10);
      expect(deliveries.length).toBe(2);
      const events = deliveries.map((d) => (JSON.parse(d.body) as { event: string }).event).sort();
      expect(events).toEqual(["task.completed", "task.running"]);

      // Terminal tasks short-circuit without touching the network.
      let calls = 0;
      const counting: FetchLike = async () => {
        calls += 1;
        return new Response("x", { status: 200 });
      };
      await processTaskMessage(db, taskQueue, webhookQueue, counting, { task_id: taskId });
      expect(calls).toBe(0);
      expect(taskQueue.size()).toBe(0);
    } finally {
      await app.close();
    }
  });

  test("failed targets retry to max_retries, then finalize as failed", async () => {
    const app = await startTestApp("tasks-retry");
    try {
      const user = await createTestUser(app, "retry@example.com");
      const db = app.handle.db;

      const created = await postJson(
        app,
        "/api/v1/tasks",
        { url: "https://example.com/flaky", max_retries: 2 },
        user.token,
      );
      const taskId: string = created.body.data.task_id;

      const failFetch: FetchLike = async () => new Response("boom", { status: 500 });
      const taskQueue = new Queue(db, "runmesh-tasks");
      const webhookQueue = new Queue(db, "runmesh-webhooks");

      for (let attempt = 0; attempt < 3; attempt++) {
        const items = taskQueue.receive(10);
        expect(items.length).toBe(1);
        await processTaskMessage(db, taskQueue, webhookQueue, failFetch, JSON.parse(items[0]!.body));
      }

      const task = new TaskModel(db).findById(taskId)!;
      expect(task.status).toBe("failed");
      // complete_execution adds one more retry count on terminal failure (Python parity).
      expect(task.retries).toBe(3);
      expect(task.responseBody).toBe("boom");
      expect(task.responseStatus).toBe(500);
      expect(taskQueue.size()).toBe(0);
    } finally {
      await app.close();
    }
  });

  test("template-rendered SSRF targets fail permanently without a fetch", async () => {
    const app = await startTestApp("tasks-ssrf");
    try {
      const user = await createTestUser(app, "ssrf@example.com");
      const db = app.handle.db;

      const taskId = new TaskModel(db).create({
        userId: user.id,
        url: "",
        status: "queued",
        type: "http",
        executionType: "immediate",
        scheduledAt: new Date().toISOString(),
        payload: JSON.stringify({ host: "169.254.169.254" }),
        urlTemplate: "http://{{ payload.host }}/latest",
        workspaceId: null,
      });

      let calls = 0;
      const counting: FetchLike = async () => {
        calls += 1;
        return new Response("x", { status: 200 });
      };
      await processTaskMessage(
        db,
        new Queue(db, "runmesh-tasks"),
        new Queue(db, "runmesh-webhooks"),
        counting,
        { task_id: taskId },
      );
      expect(calls).toBe(0);
      expect(new TaskModel(db).findById(taskId)!.status).toBe("failed");
    } finally {
      await app.close();
    }
  });

  test("unapproved grants park tasks in waiting_for_grant", async () => {
    const app = await startTestApp("tasks-grant");
    try {
      const user = await createTestUser(app, "grant@example.com");
      const db = app.handle.db;
      const now = new Date().toISOString();

      db.insert(connectUsers)
        .values({ id: "cu_1", createdAt: now, updatedAt: now })
        .run();
      db.insert(connectApps)
        .values({
          id: "ca_1",
          developerUserId: user.id,
          name: "Test App",
          slug: "test-app",
          clientSecretHash: "x",
          createdAt: now,
          updatedAt: now,
        })
        .run();
      db.insert(connectConnections)
        .values({
          id: "conn_1",
          connectUserId: "cu_1",
          provider: "github",
          createdAt: now,
          updatedAt: now,
        })
        .run();
      db.insert(connectGrants)
        .values({
          id: "cg_pending",
          connectAppId: "ca_1",
          connectUserId: "cu_1",
          connectionId: "conn_1",
          scopes: "[]",
          status: "active",
          grantedAt: now,
          createdAt: now,
          updatedAt: now,
          approvalStatus: "pending_approval",
        })
        .run();

      const parked = await postJson(
        app,
        "/api/v1/tasks",
        { url: "https://example.com/gated", connect_grant_id: "cg_pending" },
        user.token,
      );
      expect(parked.body.message).toBe("Task waiting for grant approval");
      const parkedId: string = parked.body.data.task_id;
      expect(new TaskModel(db).findById(parkedId)!.status).toBe("waiting_for_grant");
      expect(new Queue(db, "runmesh-tasks").size()).toBe(0);

      db.update(connectGrants)
        .set({ approvalStatus: "approved" })
        .where(eq(connectGrants.id, "cg_pending"))
        .run();
      const released = await postJson(
        app,
        "/api/v1/tasks",
        { url: "https://example.com/gated", connect_grant_id: "cg_pending" },
        user.token,
      );
      expect(released.body.message).toBe("Task queued");
    } finally {
      await app.close();
    }
  });

  test("sweep enqueues only due scheduled tasks", async () => {
    const app = await startTestApp("tasks-sweep");
    try {
      const user = await createTestUser(app, "sweep@example.com");
      const db = app.handle.db;
      const taskQueue = new Queue(db, "runmesh-tasks");

      const past = new Date(Date.now() - 1000).toISOString();
      const future = new Date(Date.now() + 3600_1000).toISOString();
      const mk = (scheduledAt: string) =>
        new TaskModel(db).create({
          userId: user.id,
          url: "https://example.com/x",
          status: "queued",
          type: "task",
          executionType: "scheduled",
          scheduledAt,
          payload: "{}",
        });
      const dueId = mk(past);
      mk(future);

      expect(enqueueDueTasks(db, taskQueue)).toBe(1);
      expect(new TaskModel(db).findById(dueId)!.status).toBe("dispatched");
      expect(taskQueue.size()).toBe(1);
      expect(enqueueDueTasks(db, taskQueue)).toBe(0);
    } finally {
      await app.close();
    }
  });
});
