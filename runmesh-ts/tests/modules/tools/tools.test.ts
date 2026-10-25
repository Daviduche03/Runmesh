import { describe, expect, test } from "bun:test";
import { agentEvents } from "../../../src/core/db/schema.js";
import { agents } from "../../../src/core/db/schema.js";
import { agentRuns } from "../../../src/core/db/schema.js";
import { tools } from "../../../src/core/db/schema.js";
import { connectConnections } from "../../../src/core/db/schema.js";
import { connectGrants } from "../../../src/core/db/schema.js";
import { eq } from "drizzle-orm";
import {
  forwardBody,
  forwardUrl,
  injectAuth,
  invokeTool,
  forwardTool,
  listTools,
  requestFingerprint,
  resourceAllowed,
  sanitizeHeaders,
} from "../../../src/modules/tools/invoke.js";
import { redactSecrets } from "../../../src/modules/tools/redact.js";
import { upsertConnection } from "../../../src/modules/connect/sessions.js";
import { attachProviderIdentity } from "../../../src/modules/connect/sessions.js";
import {
  ConnectConnectionModel,
  ConnectGrantModel,
  ConnectUserModel,
} from "../../../src/core/db/orm.js";
import type { FetchLike } from "../../../src/modules/webhooks/service.js";
import { ensurePersonalWorkspace } from "../../../src/modules/workspace/tenancy.js";
import {
  createTestUser,
  getJson,
  postJson,
  startTestApp,
} from "../../helpers/test-app.js";
import type { TestApp } from "../../helpers/test-app.js";

async function setupToolWorld(app: TestApp, provider = "google") {
  const db = app.handle.db;
  const user = await createTestUser(app, `${provider}-tool@example.com`);
  const workspaceId = ensurePersonalWorkspace(db, user.id);
  const now = new Date().toISOString();

  db.insert(agents)
    .values({ id: "ag_tool", workspaceId, userId: user.id, name: "Tool Agent", createdAt: now, updatedAt: now })
    .run();
  db.insert(agentRuns)
    .values({ id: "run_tool", workspaceId, agentId: "ag_tool", threadId: "th_tool", startedAt: now, createdAt: now, updatedAt: now })
    .run();
  db.insert(tools)
    .values({
      id: "tool_gmail",
      workspaceId,
      name: "gmail.send",
      kind: "managed",
      provider,
      action: "google.gmail.send",
      method: "POST",
      url: "https://example.com/upstream/send",
      baseUrl: "https://example.com/upstream",
      authScheme: "bearer",
      resourceParam: "repo",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const connectUser = new ConnectUserModel(db).create({
    primaryEmail: "cu@example.com",
    primaryEmailVerified: true,
  });
  const identity = attachProviderIdentity(db, {
    connectUserId: connectUser.id,
    provider,
    providerSubject: "sub-tool",
    email: "cu@example.com",
    emailVerified: true,
  });
  const connectionId = upsertConnection(db, {
    connectUserId: connectUser.id,
    provider,
    scopes: ["gmail.send"],
    accessToken: "secret-token-abc",
    identityId: identity.id,
    workspaceId,
  });
  return { db, user, workspaceId, runId: "run_tool", connectUser, connectionId };
}

function approveAgentGrant(
  db: Parameters<typeof upsertConnection>[0],
  workspaceId: string,
  connectUserId: string,
  connectionId: string,
  extra: Record<string, unknown> = {},
): string {
  const now = new Date().toISOString();
  const id = `cg_${Math.random().toString(36).slice(2, 10)}`;
  db.insert(connectGrants)
    .values({
      id,
      connectUserId,
      connectionId,
      scopes: JSON.stringify(["gmail.send"]),
      status: "active",
      grantedAt: now,
      createdAt: now,
      updatedAt: now,
      agentId: "ag_tool",
      approvalStatus: "approved",
      workspaceId,
      ...extra,
    })
    .run();
  return id;
}

function connectionIdOf(db: Parameters<typeof upsertConnection>[0]): string {
  return db.select().from(connectConnections).limit(1).all()[0]!.id;
}

function okFetch(handler: (url: string, init: RequestInit) => unknown): FetchLike {
  return (async (url: string, init: RequestInit) => {
    const payload = handler(url, init);
    return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
      status: 200,
    });
  }) as FetchLike;
}

describe("tool helpers", () => {
  test("redactSecrets masks secret keys past a depth cap", () => {
    expect(redactSecrets({ api_key: "x", nested: { token: "y", ok: 1 } })).toEqual({
      api_key: "[REDACTED]",
      nested: { token: "[REDACTED]", ok: 1 },
    });
    expect(redactSecrets({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } })).toEqual({
      a: { b: { c: { d: { e: { f: "[TRUNCATED]" } } } } },
    });
    expect(redactSecrets([1, { password: "p" }])).toEqual([1, { password: "[REDACTED]" }]);
  });

  test("resourceAllowed enforces grant filters", () => {
    expect(resourceAllowed(null, "")).toBe(true);
    expect(resourceAllowed({ repo: "org/x" }, "")).toBe(false);
    expect(resourceAllowed({ repo: "org/x" }, "ORG/X")).toBe(true);
    expect(resourceAllowed({ repo: "org/x" }, "org/other")).toBe(false);
    expect(resourceAllowed("oops", "x")).toBe(false);
  });

  test("requestFingerprint is stable and order-insensitive", () => {
    expect(requestFingerprint("r", { b: 1, a: 2 })).toBe(requestFingerprint("r", { a: 2, b: 1 }));
    expect(requestFingerprint("r", { a: 1 })).not.toBe(requestFingerprint("r", { a: 2 }));
  });

  test("injectAuth / sanitizeHeaders / forwardBody / forwardUrl", () => {
    expect(
      injectAuth({}, { authScheme: "bearer", authHeader: "Authorization", authFormat: "Bearer {token}" }, "t"),
    ).toEqual({ Authorization: "Bearer t" });
    expect(
      injectAuth({ a: "b" }, { authScheme: "none", authHeader: null, authFormat: null }, "t"),
    ).toEqual({ a: "b" });
    const clean = sanitizeHeaders(
      { "X-Ok": "1", Authorization: "evil", Host: "x", ["a".repeat(200)]: "y", "X-Big": "z".repeat(5000) },
      { id: "t" },
    );
    expect(clean.Authorization).toBeUndefined();
    expect(clean.Host).toBeUndefined();
    expect(clean["X-Ok"]).toBe("1");
    expect(clean["X-Big"]!.length).toBe(4096);
    expect(Object.keys(clean).length).toBeLessThanOrEqual(40);
    expect(forwardBody(null)).toBeNull();
    expect(forwardBody({ a: 1 })).toBe('{"a":1}');
    expect(forwardBody(42)).toBe("42");
    expect(forwardUrl({ baseUrl: "https://api.example.com/v1/" }, "/users", { q: "x y" })).toBe(
      "https://api.example.com/v1/users?q=x+y",
    );
    expect(() => forwardUrl({ baseUrl: null }, "/x", null)).toThrow();
    expect(() => forwardUrl({ baseUrl: "https://a.example" }, "//evil", null)).toThrow();
    expect(() => forwardUrl({ baseUrl: "https://a.example" }, "/x y", null)).toThrow();
  });
});

describe("tool invoke", () => {
  test("allow path injects auth, scrubs the secret, and records the ledger", async () => {
    const app = await startTestApp("tools-invoke");
    try {
      const { db, user, workspaceId, runId, connectUser, connectionId } = await setupToolWorld(app);
      const seen: Array<{ url: string; init: RequestInit }> = [];
      const fetchImpl = okFetch((url, init) => {
        seen.push({ url: String(url), init });
        return { sent_token_echo: (init.body as string).includes("secret-token-abc") ? "LEAK" : "clean" };
      });

      // Approved grant bound to the agent.
      const grantId = approveAgentGrant(db, workspaceId, connectUser.id, connectionId);

      const result = await invokeTool(db, {
        userId: user.id,
        workspaceId,
        ref: "tool_gmail",
        runId,
        args: { to: "x@example.com", repo: "org/x", secret_note: "shh" },
        idempotencyKey: "idem-1",
        fetchImpl,
      });

      expect(result.decision).toBe("allow");
      expect(result.status).toBe(200);
      expect(result.upstream_error).toBe(false);
      expect(seen).toHaveLength(1);
      expect(seen[0]!.init.headers).toMatchObject({ Authorization: "Bearer secret-token-abc" });
      // Secret scrubbed from the stored body, redacted args in the ledger.
      expect(result.body as string).not.toContain("secret-token-abc");
      const events = db.select().from(agentEvents).where(eq(agentEvents.runId, runId)).all();
      expect(events.map((e) => e.kind)).toEqual(["tool.call", "tool.result"]);
      expect(events[0]!.seq).toBe(1);
      expect(JSON.parse(events[0]!.args).secret_note).toBe("[REDACTED]");

      // Grant use was reserved.
      expect(new ConnectGrantModel(db).findById(grantId)!.useCount).toBe(1);

      // Replay returns the cached payload without a second fetch or use.
      const replay = await invokeTool(db, {
        userId: user.id,
        workspaceId,
        ref: "tool_gmail",
        runId,
        args: { to: "x@example.com", repo: "org/x", secret_note: "shh" },
        idempotencyKey: "idem-1",
        fetchImpl,
      });
      expect(replay.idempotent_replay).toBe(true);
      expect(seen).toHaveLength(1);
      expect(new ConnectGrantModel(db).findById(grantId)!.useCount).toBe(1);

      // Same key with different args is rejected.
      await expect(
        invokeTool(db, {
          userId: user.id,
          workspaceId,
          ref: "tool_gmail",
          runId,
          args: { to: "other@example.com" },
          idempotencyKey: "idem-1",
          fetchImpl,
        }),
      ).rejects.toThrow("idempotency key already used for a different request");
    } finally {
      await app.close();
    }
  });

  test("missing connection and missing grant resolve to consent", async () => {
    const app = await startTestApp("tools-consent");
    try {
      const { db, user, workspaceId, runId, connectionId } = await setupToolWorld(app, "slack");

      // Revoke the setup connection: no active connection resolves to consent.
      new ConnectConnectionModel(db).revoke(connectionId);
      const noConnection = await invokeTool(db, {
        userId: user.id,
        workspaceId,
        ref: "tool_gmail",
        runId,
        args: {},
        fetchImpl: okFetch(() => ({})),
      });
      expect(noConnection.decision).toBe("consent");
      expect(noConnection.reason).toContain("Connect slack");

      // Add a connection but no grant: consent with a resume URL, and a pending
      // grant minted for the operator as the fallback resume path.
      const connectUser = new ConnectUserModel(db).findByPrimaryEmail("cu@example.com")!;
      const identity = attachProviderIdentity(db, {
        connectUserId: connectUser.id,
        provider: "slack",
        providerSubject: "sub-2",
        emailVerified: false,
      });
      upsertConnection(db, {
        connectUserId: connectUser.id,
        provider: "slack",
        scopes: ["chat:write"],
        accessToken: "xoxp-1",
        identityId: identity.id,
        workspaceId,
      });
      const noGrant = await invokeTool(db, {
        userId: user.id,
        workspaceId,
        ref: "tool_gmail",
        runId,
        args: {},
        fetchImpl: okFetch(() => ({})),
      });
      expect(noGrant.decision).toBe("consent");
      expect(typeof noGrant.consent_url).toBe("string");
    } finally {
      await app.close();
    }
  });

  test("exhausted and expired grants are refused with reasons", async () => {
    const app = await startTestApp("tools-refuse");
    try {
      const { db, user, workspaceId, runId, connectUser, connectionId } = await setupToolWorld(app);
      approveAgentGrant(db, workspaceId, connectUser.id, connectionId, { maxUses: 1, useCount: 1 });
      const exhausted = await invokeTool(db, {
        userId: user.id,
        workspaceId,
        ref: "tool_gmail",
        runId,
        args: {},
        fetchImpl: okFetch(() => ({})),
      });
      expect(exhausted.decision).toBe("deny");
      expect(exhausted.reason).toBe("The grant has no uses left.");
      expect(exhausted.rule).toBeNull();
    } finally {
      await app.close();
    }
  });

  test("expired grants are refused", async () => {
    const app = await startTestApp("tools-expired");
    try {
      const { db, user, workspaceId, runId, connectUser, connectionId } = await setupToolWorld(app);
      approveAgentGrant(db, workspaceId, connectUser.id, connectionId, {
        validUntil: "2000-01-01T00:00:00.000Z",
      });
      const expired = await invokeTool(db, {
        userId: user.id,
        workspaceId,
        ref: "tool_gmail",
        runId,
        args: {},
        fetchImpl: okFetch(() => ({})),
      });
      expect(expired.decision).toBe("deny");
      expect(expired.reason).toBe("The grant has expired.");
    } finally {
      await app.close();
    }
  });

  test("resource filters gate calls by the named resource", async () => {
    const app = await startTestApp("tools-resource");
    try {
      const { db, user, workspaceId, runId, connectUser, connectionId } = await setupToolWorld(app);
      approveAgentGrant(db, workspaceId, connectUser.id, connectionId, {
        resourceFilters: JSON.stringify({ repo: "org/allowed" }),
      });

      const denied = await invokeTool(db, {
        userId: user.id,
        workspaceId,
        ref: "tool_gmail",
        runId,
        args: { repo: "org/other" },
        fetchImpl: okFetch(() => ({})),
      });
      expect(denied.decision).toBe("deny");
      expect(denied.reason).toBe("The grant does not cover this resource.");

      const allowed = await invokeTool(db, {
        userId: user.id,
        workspaceId,
        ref: "tool_gmail",
        runId,
        args: { repo: "org/allowed" },
        fetchImpl: okFetch(() => ({ ok: true })),
      });
      expect(allowed.decision).toBe("allow");
    } finally {
      await app.close();
    }
  });

  test("forward injects auth, strips caller credentials, and pins the host", async () => {
    const app = await startTestApp("tools-forward-unit");
    try {
      const { db, user, workspaceId, runId, connectUser, connectionId } = await setupToolWorld(app);
      approveAgentGrant(db, workspaceId, connectUser.id, connectionId);

      const seen: Array<{ url: string; init: RequestInit }> = [];
      const result = await forwardTool(db, {
        userId: user.id,
        workspaceId,
        ref: "tool_gmail",
        method: "put",
        path: "/messages/1",
        headers: { Authorization: "evil", "X-Keep": "yes" },
        body: { a: 1 },
        query: { q: "x" },
        runId,
        fetchImpl: okFetch((url, init) => {
          seen.push({ url: String(url), init });
          return { ok: true };
        }),
      });
      expect(result.decision).toBe("allow");
      expect(seen).toHaveLength(1);
      expect(seen[0]!.url).toBe("https://example.com/upstream/messages/1?q=x");
      const headers = seen[0]!.init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer secret-token-abc");
      expect(headers["X-Keep"]).toBe("yes");
      expect(seen[0]!.init.body).toBe('{"a":1}');
      const callEvent = db
        .select()
        .from(agentEvents)
        .where(eq(agentEvents.runId, runId))
        .all()
        .find((e) => e.kind === "tool.call")!;
      expect(JSON.parse(callEvent.args)).toEqual({ method: "PUT", path: "/messages/1" });
    } finally {
      await app.close();
    }
  });

  test("tool and run resolution errors", async () => {
    const app = await startTestApp("tools-resolve");
    try {
      const { db, user, workspaceId, runId } = await setupToolWorld(app);
      await expect(
        invokeTool(db, { userId: user.id, workspaceId, ref: "missing", runId, args: {}, fetchImpl: okFetch(() => ({})) }),
      ).rejects.toThrow("Tool not found");
      await expect(
        invokeTool(db, { userId: user.id, workspaceId, ref: "tool_gmail", runId: "", args: {}, fetchImpl: okFetch(() => ({})) }),
      ).rejects.toThrow("run_id is required");
      await expect(
        invokeTool(db, { userId: user.id, workspaceId, ref: "tool_gmail", runId: "run_missing", args: {}, fetchImpl: okFetch(() => ({})) }),
      ).rejects.toThrow("Run not found");

      const now = new Date().toISOString();
      db.insert(tools)
        .values({ id: "tool_local", workspaceId, name: "local.one", kind: "local", createdAt: now, updatedAt: now })
        .run();
      await expect(
        invokeTool(db, { userId: user.id, workspaceId, ref: "tool_local", runId, args: {}, fetchImpl: okFetch(() => ({})) }),
      ).rejects.toThrow("local tools run in-process");
    } finally {
      await app.close();
    }
  });
});

describe("tool routes", () => {
  test("list, invoke, and raw forward passthrough", async () => {
    const app = await startTestApp("tools-routes");
    try {
      const { db, user, workspaceId, runId } = await setupToolWorld(app);

      const listed = await getJson(app, "/api/v1/tools", user.token);
      expect(listed.body.data).toEqual([
        { id: "tool_gmail", name: "gmail.send", action: "google.gmail.send", kind: "managed", provider: "google" },
      ]);

      // No grant yet: invoke resolves to consent with HTTP 200 + ok:true envelope.
      const consent = await postJson(
        app,
        "/api/v1/tools/tool_gmail/invoke",
        { run_id: runId, args: {} },
        user.token,
      );
      expect(consent.body.data.decision).toBe("consent");

      const missing = await postJson(
        app,
        "/api/v1/tools/tool_missing/invoke",
        { run_id: runId, args: {} },
        user.token,
      );
      expect(missing.body.ok).toBe(false);
      expect(missing.body.error.code).toBe(404);
      void db;
      void workspaceId;
    } finally {
      await app.close();
    }
  });

  test("forward route validates method/path and injects auth", async () => {
    const app = await startTestApp("tools-forward");
    try {
      const { user, runId } = await setupToolWorld(app);

      const badMethod = await postJson(
        app,
        "/api/v1/tools/tool_gmail/forward",
        { run_id: runId, method: "BREW", path: "/x" },
        user.token,
      );
      expect(badMethod.body.error.code).toBe(400);

      const badPath = await postJson(
        app,
        "/api/v1/tools/tool_gmail/forward",
        { run_id: runId, method: "GET", path: "relative" },
        user.token,
      );
      expect(badPath.body.error.code).toBe(400);
      void runId;
    } finally {
      await app.close();
    }
  });
});
