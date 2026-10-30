import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { generateApiKey, hashApiKey } from "../../../src/core/auth/api-key.js";
import { ApiKeyModel } from "../../../src/core/db/orm.js";
import { agentEvents, agentRuns, policyDecisions } from "../../../src/core/db/schema.js";
import { ensurePersonalWorkspace } from "../../../src/modules/workspace/index.js";
import { createTestUser, postJson, startTestApp } from "../../helpers/test-app.js";
import type { TestApp, TestUser } from "../../helpers/test-app.js";

let app: TestApp;

beforeEach(async () => {
  app = await startTestApp("hooks");
});

afterEach(async () => {
  await app.close();
});

interface Fixture {
  user: TestUser;
  workspaceId: string;
  apiKey: string;
}

async function setup(email = "hooks@example.com"): Promise<Fixture> {
  const user = await createTestUser(app, email);
  const workspaceId = ensurePersonalWorkspace(app.handle.db, user.id);
  const apiKey = generateApiKey();
  new ApiKeyModel(app.handle.db).create({
    keyHash: hashApiKey(apiKey),
    name: "hooks",
    userId: user.id,
    permissions: JSON.stringify(["read", "write"]),
    isActive: 1,
    workspaceId,
  });
  return { user, workspaceId, apiKey };
}

async function postHook(
  path: string,
  body: unknown,
  apiKey: string,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${app.base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function allowTests(fixture: Fixture): Promise<void> {
  await postJson(
    app,
    "/api/v1/policies/rules",
    {
      name: "Allow the test suite",
      conditions: [{ field: "action", operator: "is", value: "test.run" }],
      action: "allow",
      mode: "enforce",
      enabled: true,
    },
    fixture.user.token,
  );
}

describe("agent hooks", () => {
  test("rejects a call without a credential", async () => {
    await setup();
    const response = await fetch(`${app.base}/api/v1/agent-hooks/tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "exec",
        event: "tool.before",
        session_id: "s1",
        tool: "Bash",
        input: { command: "ls" },
      }),
    });
    expect(response.status).toBe(401);
  });

  test("allows, assesses, and records when policy is not configured", async () => {
    const fixture = await setup();

    const result = await postHook(
      "/api/v1/agent-hooks/tool",
      {
        source: "exec",
        event: "tool.before",
        session_id: "s1",
        tool: "Bash",
        input: { command: "cat .env" },
      },
      fixture.apiKey,
    );

    expect(result.status).toBe(200);
    expect(result.body.data.decision.decision).toBe("allow");
    expect(result.body.data.decision.enforced).toBe(false);
    expect(result.body.data.assessment.action).toBe("secrets.read");
    expect(result.body.data.assessment.suspicion).toBe("high");
    expect(result.body.data.run_id).toStartWith("run_");
    expect(result.body.data.thread_id).toStartWith("th_hook_");

    const events = app.handle.db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.runId, result.body.data.run_id))
      .all();
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("tool.call");
    expect(events[0]?.name).toBe("Bash");
  });

  test("reuses one run for every tool call in a session", async () => {
    const fixture = await setup();
    const body = {
      source: "exec",
      event: "tool.before" as const,
      session_id: "session-42",
      tool: "Bash",
      input: { command: "ls" },
    };

    const first = await postHook("/api/v1/agent-hooks/tool", body, fixture.apiKey);
    const second = await postHook("/api/v1/agent-hooks/tool", body, fixture.apiKey);

    expect(second.body.data.run_id).toBe(first.body.data.run_id);

    const runs = app.handle.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.threadId, first.body.data.thread_id))
      .all();
    expect(runs).toHaveLength(1);
  });

  test("denies a credential read once an enforce rule exists and writes the ledger", async () => {
    const fixture = await setup();
    await postJson(
      app,
      "/api/v1/policies/rules",
      {
        name: "Deny credential reads",
        conditions: [{ field: "action", operator: "is", value: "secrets.read" }],
        action: "deny",
        mode: "enforce",
        enabled: true,
      },
      fixture.user.token,
    );

    const result = await postHook(
      "/api/v1/agent-hooks/tool",
      {
        source: "exec",
        event: "tool.before",
        session_id: "s1",
        tool: "Bash",
        input: { command: "cat ~/.ssh/id_rsa" },
      },
      fixture.apiKey,
    );

    expect(result.body.data.decision.decision).toBe("deny");
    expect(result.body.data.decision.enforced).toBe(true);
    expect(result.body.data.decision.reason).toContain("Deny credential reads");

    const decisions = app.handle.db
      .select()
      .from(policyDecisions)
      .where(eq(policyDecisions.workspaceId, fixture.workspaceId))
      .all();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("secrets.read");
    expect(decisions[0]?.decision).toBe("deny");
    expect(decisions[0]?.runId).toBe(result.body.data.run_id);
    expect(decisions[0]?.source).toBe("tool-call");
  });

  test("unmatched actions fall to the configured default", async () => {
    const fixture = await setup();
    await allowTests(fixture);

    const allowed = await postHook(
      "/api/v1/agent-hooks/tool",
      {
        source: "exec",
        event: "tool.before",
        session_id: "s1",
        tool: "Bash",
        input: { command: "bun test" },
      },
      fixture.apiKey,
    );
    expect(allowed.body.data.decision.decision).toBe("allow");
    expect(allowed.body.data.decision.enforced).toBe(true);

    const unmatched = await postHook(
      "/api/v1/agent-hooks/tool",
      {
        source: "exec",
        event: "tool.before",
        session_id: "s1",
        tool: "Bash",
        input: { command: "make deploy" },
      },
      fixture.apiKey,
    );
    expect(unmatched.body.data.decision.decision).toBe("deny");
    expect(unmatched.body.data.decision.defaultApplied).toBe(true);
  });

  test("records a tool result event", async () => {
    const fixture = await setup();
    const before = await postHook(
      "/api/v1/agent-hooks/tool",
      {
        source: "exec",
        event: "tool.before",
        session_id: "s1",
        tool: "Bash",
        input: { command: "ls" },
      },
      fixture.apiKey,
    );

    await postHook(
      "/api/v1/agent-hooks/tool",
      {
        source: "exec",
        event: "tool.after",
        session_id: "s1",
        tool: "Bash",
        output: { stdout: "ok" },
        duration_ms: 12,
      },
      fixture.apiKey,
    );

    const events = app.handle.db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.runId, before.body.data.run_id))
      .all();
    expect(events.map((event) => event.kind)).toEqual(["tool.call", "tool.result"]);
    expect(events[1]?.durationMs).toBe(12);
  });
});
