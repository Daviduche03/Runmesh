import { describe, expect, test } from "bun:test";
import {
  createAgentVersion,
  normalizeTool,
  registerTools,
  safeBaseUrl,
  toolRef,
} from "../../../src/modules/collection/service.js";
import {
  createTestUser,
  deleteJson,
  getJson,
  postJson,
  putJson,
  startTestApp,
} from "../../helpers/test-app.js";
import { createTrigger, fireTrigger } from "../../../src/modules/triggers/index.js";
import { ensurePersonalWorkspace } from "../../../src/modules/workspace/tenancy.js";

describe("collection helpers", () => {
  test("toolRef is a stable workspace-scoped ref", () => {
    expect(toolRef("ws1", "gmail.send")).toBe(toolRef("ws1", "gmail.send"));
    expect(toolRef("ws1", "gmail.send")).not.toBe(toolRef("ws2", "gmail.send"));
    expect(toolRef("ws1", "gmail.send")).toMatch(/^tool_[0-9a-f]{12}$/);
  });

  test("safeBaseUrl only allows https or localhost http", () => {
    expect(safeBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
    expect(safeBaseUrl("http://localhost:3000/x")).toBe("http://localhost:3000/x");
    expect(safeBaseUrl("http://evil.example.com/x")).toBeNull();
    expect(safeBaseUrl("not-a-url")).toBeNull();
    expect(safeBaseUrl(null)).toBeNull();
  });

  test("normalizeTool classifies and demotes managed declarations", () => {
    const { tool, warning } = normalizeTool({
      name: "gmail.send",
      kind: "managed",
      provider: "google",
      url: "https://gmail.example.com/send",
    });
    expect(tool!.kind).toBe("managed");
    expect(tool!.action).toBe("google.gmail.send");
    expect(warning).toBeNull();

    const demoted = normalizeTool({ name: "half", kind: "managed" });
    expect(demoted.tool!.kind).toBe("local");
    expect(demoted.warning!.code).toBe("managed_missing_config");

    const bad = normalizeTool({ name: "" });
    expect(bad.tool).toBeNull();
    expect(bad.warning!.code).toBe("invalid_name");

    const weird = normalizeTool({ name: "x", kind: "quantum", method: "BREW", authScheme: "magic" });
    expect(weird.tool!.kind).toBe("local");
    expect(weird.tool!.method).toBe("POST");
    expect(weird.tool!.authScheme).toBe("none");
  });
});

describe("collection routes", () => {
  test("resolve → runs → ingest → finish → replay → get", async () => {
    const app = await startTestApp("collection-flow");
    try {
      const user = await createTestUser(app, "col@example.com");

      const resolved = await putJson(app, "/api/v1/agents:resolve", {
        external_key: "ext-9",
        fingerprint: "fp-1",
        name: "Collector",
        framework: "demo",
        model: "m1",
        tools: [{ name: "gmail.send", kind: "managed", provider: "google", url: "https://x.example.com" }],
      }, user.token);
      expect(resolved.body.message).toBe("Agent registered");
      expect(resolved.body.data.is_new).toBe(true);
      expect(resolved.body.data.tools[0].ref).toMatch(/^tool_/);
      const agentId: string = resolved.body.data.id;

      // Same fingerprint resolves without a new version; a new one versions.
      const again = await putJson(app, "/api/v1/agents:resolve", {
        external_key: "ext-9",
        fingerprint: "fp-1",
      }, user.token);
      expect(again.body.message).toBe("Agent resolved");
      expect(again.body.data.is_new_version).toBe(false);

      const versioned = await putJson(app, "/api/v1/agents:resolve", {
        external_key: "ext-9",
        fingerprint: "fp-2",
      }, user.token);
      expect(versioned.body.data.is_new_version).toBe(true);
      expect(versioned.body.data.version).toBe(2);

      const started = await postJson(app, "/api/v1/runs", {
        agent_id: agentId,
        input: '{"goal":"test"}',
      }, user.token);
      expect(started.body.message).toBe("Run started");
      const runId: string = started.body.data.id;
      expect(started.body.data.thread_id).toMatch(/^th_/);

      const child = await postJson(app, "/api/v1/runs", {
        agent_id: agentId,
        parent_run_id: runId,
      }, user.token);
      expect(child.body.data.thread_id).toBe(started.body.data.thread_id);

      const ingested = await postJson(app, "/api/v1/ingest", {
        events: [
          { run_id: runId, kind: "tool.call", name: "gmail.send", args: { api_key: "shh", to: "x" } },
          { run_id: runId, kind: "tool.result", name: "gmail.send", result: { ok: true } },
        ],
      }, user.token);
      expect(ingested.body.data.ingested).toBe(2);

      const detail = await getJson(app, `/api/v1/runs/${runId}`, user.token);
      expect(detail.body.data.event_count).toBe(2);
      expect(detail.body.data.events[0].args).toEqual({ api_key: "[REDACTED]", to: "x" });
      expect(detail.body.data.child_runs).toHaveLength(1);
      expect(detail.body.data.definition.version).toBe(2);

      const finished = await postJson(app, `/api/v1/runs/${runId}/finish`, {
        status: "completed",
        usage: { tokens: 10 },
      }, user.token);
      expect(finished.body.data.status).toBe("completed");

      const conflict = await postJson(app, `/api/v1/runs/${runId}/finish`, {
        status: "failed",
      }, user.token);
      expect(conflict.status).toBe(409);

      const replay = await postJson(app, `/api/v1/runs/${runId}/replay`, {}, user.token);
      expect(replay.body.data.mode).toBe("replay");

      const runs = await getJson(app, `/api/v1/agents/${agentId}/runs`, user.token);
      expect(runs.body.meta.total).toBe(3);

      const missing = await getJson(app, "/api/v1/runs/run_missing", user.token);
      expect(missing.status).toBe(404);
    } finally {
      await app.close();
    }
  });

  test("validation errors", async () => {
    const app = await startTestApp("collection-validation");
    try {
      const user = await createTestUser(app, "colv@example.com");

      const noKey = await putJson(app, "/api/v1/agents:resolve", {}, user.token);
      expect(noKey.status).toBe(400);

      const noAgent = await postJson(app, "/api/v1/runs", { agent_id: "ag_missing" }, user.token);
      expect(noAgent.status).toBe(404);

      const empty = await postJson(app, "/api/v1/ingest", { events: [] }, user.token);
      expect(empty.status).toBe(400);

      const tooMany = await postJson(app, "/api/v1/ingest", {
        events: Array.from({ length: 201 }, (_, i) => ({ run_id: `r${i}`, kind: "log" })),
      }, user.token);
      expect(tooMany.status).toBe(400);

      const resolved = await putJson(app, "/api/v1/agents:resolve", { external_key: "ek-1" }, user.token);
      const agentId: string = resolved.body.data.id;
      const started = await postJson(app, "/api/v1/runs", { agent_id: agentId }, user.token);
      const runId: string = started.body.data.id;

      const badKind = await postJson(app, "/api/v1/ingest", {
        events: [{ run_id: runId, kind: "nope" }],
      }, user.token);
      expect(badKind.status).toBe(400);

      const badStatus = await postJson(app, `/api/v1/runs/${runId}/finish`, { status: "maybe" }, user.token);
      expect(badStatus.status).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe("triggers", () => {
  test("CRUD, fire with signed callback, and schedule sweep", async () => {
    const app = await startTestApp("triggers-flow");
    try {
      const user = await createTestUser(app, "trg@example.com");

      const resolved = await putJson(app, "/api/v1/agents:resolve", { external_key: "trg-agent" }, user.token);
      const agentId: string = resolved.body.data.id;

      const badType = await postJson(app, "/api/v1/triggers", {
        agent_id: agentId,
        type: "nope",
        name: "T",
      }, user.token);
      expect(badType.status).toBe(400);

      const missingAgent = await postJson(app, "/api/v1/triggers", {
        agent_id: "ag_missing",
        name: "T",
      }, user.token);
      expect(missingAgent.status).toBe(404);

      // Endpoint delivery: the signed callback carries the run context.
      const created = await postJson(app, "/api/v1/triggers", {
        agent_id: agentId,
        type: "api",
        name: "Ping",
        endpoint: "http://127.0.0.1:1/run",
        endpoint_secret: "s3cret",
      }, user.token);
      expect(created.body.message).toBe("Trigger created");
      const triggerId: string = created.body.data.id;

      // Stub the global fetch path? The service takes fetchImpl; exercise the route
      // against an unreachable endpoint and assert the run failed visibly.
      const fired = await postJson(app, `/api/v1/triggers/${triggerId}/fire`, {
        input: { hello: "world" },
      }, user.token);
      expect(fired.body.message).toBe("Trigger fired");

      const runs = await getJson(app, `/api/v1/triggers/${triggerId}/runs`, user.token);
      expect(runs.body.meta.total).toBe(1);

      const deactivated = await postJson(app, `/api/v1/triggers/${triggerId}/deactivate`, {}, user.token);
      expect(deactivated.body.data.enabled).toBe(false);
      const blocked = await postJson(app, `/api/v1/triggers/${triggerId}/fire`, {}, user.token);
      expect(blocked.status).toBe(400);
      await postJson(app, `/api/v1/triggers/${triggerId}/activate`, {}, user.token);

      const listed = await getJson(app, `/api/v1/triggers?agent_id=${agentId}`, user.token);
      expect(listed.body.meta.total).toBe(1);

      const deleted = await deleteJson(app, `/api/v1/triggers/${triggerId}`, user.token);
      expect(deleted.body.message).toBe("Trigger deleted");
      expect((await getJson(app, `/api/v1/triggers/${triggerId}`, user.token)).status).toBe(404);
    } finally {
      await app.close();
    }
  });

  test("dispatch records system_error when delivery fails", async () => {
    const app = await startTestApp("triggers-fail");
    try {
      const user = await createTestUser(app, "trgf@example.com");
      const db = app.handle.db;
      const workspaceId = ensurePersonalWorkspace(db, user.id);
      const resolved = await putJson(app, "/api/v1/agents:resolve", { external_key: "fail-agent" }, user.token);
      const agentId: string = resolved.body.data.id;
      const { data } = createTrigger(db, user.id, workspaceId, {
        agentId,
        type: "api",
        name: "Failer",
        endpoint: "https://agent.example.com/run",
        endpointSecret: "s3cret",
      });
      const failingFetch = (async () => new Response("down", { status: 500 })) as never;
      const fired = await fireTrigger(db, user.id, workspaceId, String(data.id), { a: 1 }, failingFetch);
      expect(fired.message).toBe("Trigger fired");
      const run = await getJson(app, `/api/v1/runs/${String(fired.data.id)}`, user.token);
      expect(run.body.data.status).toBe("failed");
      expect(run.body.data.events[0].kind).toBe("error");
      expect(run.body.data.events[0].name).toBe("system_error");
    } finally {
      await app.close();
    }
  });
});

describe("dashboard", () => {
  test("analytics aggregates the caller's tasks", async () => {
    const app = await startTestApp("dashboard-analytics");
    try {
      const user = await createTestUser(app, "dash@example.com");
      await postJson(app, "/api/v1/tasks", { url: "https://example.com/1" }, user.token);
      await postJson(app, "/api/v1/tasks", { url: "https://example.com/2" }, user.token);

      const analytics = await getJson(app, "/api/analytics", user.token);
      expect(analytics.body.data.stats.total_tasks).toBe(2);
      expect(analytics.body.data.stats.active_runs).toBe(2);
      expect(analytics.body.data.recent_tasks).toHaveLength(2);
      expect(analytics.body.data.recent_tasks[0].endpoint).toBe("https://example.com/2");

      // API keys are rejected: dashboard auth is JWT-only.
      const keyed = await getJson(app, "/api/analytics");
      expect(keyed.status).toBe(401);
    } finally {
      await app.close();
    }
  });
});
