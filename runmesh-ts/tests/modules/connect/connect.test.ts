import { describe, expect, test } from "bun:test";
import { config } from "../../../src/core/config.js";
import {
  ConnectAppUserModel,
  ConnectGrantModel,
  ConnectIdentityModel,
  ConnectOtpChallengeModel,
  ConnectSessionModel,
  ConnectUserModel,
} from "../../../src/core/db/orm.js";
import { agentEvents, agentRuns, agents, connectConnections } from "../../../src/core/db/schema.js";
import { Queue } from "../../../src/core/runtime/queue.js";
import { recordAuditEvent } from "../../../src/modules/connect/audit.js";
import { ensureWorkspaceApp } from "../../../src/modules/connect/apps.js";
import { hashConnectSecret } from "../../../src/modules/connect/crypto.js";
import {
  exchangeGoogleCode,
  fetchGoogleProviderAccount,
  fetchGoogleUserinfo,
  buildGoogleAuthorizeUrl,
} from "../../../src/modules/connect/google.js";
import { upsertConnection } from "../../../src/modules/connect/sessions.js";
import type { FetchLike } from "../../../src/modules/webhooks/service.js";
import { ensurePersonalWorkspace } from "../../../src/modules/workspace/tenancy.js";
import {
  createTestUser,
  getJson,
  postJson,
  startTestApp,
} from "../../helpers/test-app.js";

async function setupConnectUser(app: Awaited<ReturnType<typeof startTestApp>>, email: string) {
  const db = app.handle.db;
  const user = await createTestUser(app, email);
  const workspaceId = ensurePersonalWorkspace(db, user.id);
  const connectUser = new ConnectUserModel(db).create({
    primaryEmail: email,
    primaryEmailVerified: true,
  });
  const connectApp = ensureWorkspaceApp(db, workspaceId, user.id);
  new ConnectAppUserModel(db).create({
    connectAppId: connectApp.id,
    externalUserId: "ext-1",
    connectUserId: connectUser.id,
  });
  return { db, user, workspaceId, connectUser, connectApp };
}

describe("connect consent lifecycle", () => {
  test("session → authorize → consent → code → approve → token → current grant", async () => {
    const app = await startTestApp("connect-flow");
    try {
      const { db, user, connectUser, connectApp } = await setupConnectUser(app, "cu@example.com");

      // Grant-mode session for a provider the user has not connected yet.
      const created = await postJson(
        app,
        "/api/v1/connect/sessions",
        {
          mode: "grant",
          redirect_uri: "https://app.example.com/cb",
          external_user_id: "ext-1",
          connect_user_id: connectUser.id,
          provider: "google",
          scopes: ["gmail.send"],
        },
        user.token,
      );
      expect(created.status).toBe(200);
      expect(created.body.message).toBe("Connect session created");
      const state: string = created.body.data.state;
      expect(created.body.data.authorize_url).toContain("/connect/authorize?state=");

      // Simulate the prior connect: identity + active connection.
      const identity = new ConnectIdentityModel(db).create({
        connectUserId: connectUser.id,
        provider: "google",
        providerSubject: "google-sub-1",
        email: "cu@example.com",
        emailVerified: true,
      });
      upsertConnection(db, {
        connectUserId: connectUser.id,
        provider: "google",
        scopes: ["gmail.send"],
        accessToken: "ya29.test",
        identityId: identity.id,
        accountLabel: "cu@example.com",
      });

      // Authorize now lands on the consent page (connection active, no grant).
      const authorize = await fetch(`${app.base}/connect/authorize?state=${state}`, {
        redirect: "manual",
      });
      expect(authorize.status).toBe(302);
      const authorizeTo = authorize.headers.get("location") ?? "";
      expect(authorizeTo).toContain("/connect/consent?state=");

      const html = await (
        await fetch(`${app.base}/connect/consent?state=${state}`)
      ).text();
      expect(html).toContain("Approve access");
      expect(html).toContain(connectApp.name);

      // Approve via the HTML form path.
      const submit = await fetch(`${app.base}/connect/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `state=${encodeURIComponent(state)}&action=approve`,
        redirect: "manual",
      });
      expect(submit.status).toBe(302);
      const redirectTo = submit.headers.get("location") ?? "";
      expect(redirectTo).toContain("https://app.example.com/cb");
      expect(redirectTo).toContain("code=");
      const code = new URL(redirectTo).searchParams.get("code")!;
      expect(code).toBeTruthy();

      // Exchange while the grant is still pending → 403 with a JSON detail.
      const pending = await postJson(app, "/api/v1/connect/token", { code }, user.token);
      expect(pending.status).toBe(403);
      expect(pending.body.error.message).toContain("grant_pending_approval");

      const grants = await getJson(app, "/api/v1/grants", user.token);
      const grantId: string = grants.body.data[0].id;
      expect(grants.body.data[0].approval_status).toBe("pending_approval");

      // Deny requires a reason; approve releases the code path.
      const denyNoReason = await postJson(
        app,
        `/api/v1/connect/grants/${grantId}/deny`,
        {},
        user.token,
      );
      expect(denyNoReason.status).toBe(422);

      const approved = await postJson(
        app,
        `/api/v1/connect/grants/${grantId}/approve`,
        { reason: "looks good" },
        user.token,
      );
      expect(approved.body.data.approval_status).toBe("approved");

      const exchanged = await postJson(app, "/api/v1/connect/token", { code }, user.token);
      expect(exchanged.body.message).toBe("Connect token exchanged");
      expect(exchanged.body.data.grant_access_token).toMatch(/^rct_/);
      expect(exchanged.body.data.grant_access_expires_in).toBe(3600);
      const grantToken: string = exchanged.body.data.grant_access_token;

      const current = await fetch(`${app.base}/api/v1/connect/grants/current`, {
        headers: { "X-Connect-Grant-Token": grantToken },
      });
      expect(current.status).toBe(200);
      const currentBody = (await current.json()) as { data: Record<string, unknown> };
      expect(currentBody.data.provider).toBe("google");
      expect(currentBody.data.scopes).toEqual(["gmail.send"]);

      const noHeader = await fetch(`${app.base}/api/v1/connect/grants/current`);
      expect(noHeader.status).toBe(401);

      // Metrics, token ledger, and the merged audit stream all observe the flow.
      const metrics = await getJson(app, "/api/v1/connect/metrics", user.token);
      expect(metrics.body.data.token_requests_24h).toBe(1);

      const tokens = await getJson(app, "/api/v1/connect/tokens", user.token);
      expect(tokens.body.data.length).toBe(1);
      expect(tokens.body.data[0].metadata.grant_id).toBe(grantId);

      const audit = await getJson(app, "/api/v1/connect/audit", user.token);
      expect(audit.body.meta.total).toBeGreaterThan(0);
      const types = (audit.body.data as Array<{ event_type: string }>).map((e) => e.event_type);
      expect(types).toContain("connect.session.created");
      expect(types).toContain("connect.token.exchanged");
    } finally {
      await app.close();
    }
  });

  test("deny cancels the session; double decisions conflict", async () => {
    const app = await startTestApp("connect-deny");
    try {
      const { db, user, connectUser } = await setupConnectUser(app, "deny@example.com");

      const created = await postJson(
        app,
        "/api/v1/connect/sessions",
        {
          mode: "grant",
          redirect_uri: "https://app.example.com/cb",
          external_user_id: "ext-1",
          connect_user_id: connectUser.id,
          provider: "google",
          scopes: ["gmail.send"],
        },
        user.token,
      );
      const state: string = created.body.data.state;

      const identity = new ConnectIdentityModel(db).create({
        connectUserId: connectUser.id,
        provider: "google",
        providerSubject: "google-sub-9",
        emailVerified: false,
      });
      upsertConnection(db, {
        connectUserId: connectUser.id,
        provider: "google",
        scopes: ["gmail.send"],
        accessToken: "xoxp-test",
        identityId: identity.id,
      });

      const submit = await fetch(`${app.base}/connect/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, action: "deny" }),
        redirect: "manual",
      });
      expect(submit.status).toBe(302);
      expect(submit.headers.get("location") ?? "").toContain("error=access_denied");

      // No grant was minted; create one directly, deny it, then approve conflicts.
      const via = await postJson(
        app,
        "/api/v1/grants",
        { connection_id: "missing", scopes: ["x"] },
        user.token,
      );
      expect(via.status).toBe(200);
      expect(via.body.ok).toBe(false);
      expect(via.body.error.code).toBe(404);

      const grant = await postJson(
        app,
        "/api/v1/grants",
        {
          connection_id: db.select().from(connectConnections).limit(1).all()[0]!.id,
          scopes: ["gmail.send"],
        },
        user.token,
      );
      const grantId: string = grant.body.data.id;

      const denied = await postJson(
        app,
        `/api/v1/connect/grants/${grantId}/deny`,
        { reason: "nope" },
        user.token,
      );
      expect(denied.body.data.approval_status).toBe("denied");

      const approve = await postJson(
        app,
        `/api/v1/connect/grants/${grantId}/approve`,
        { reason: "too late" },
        user.token,
      );
      expect(approve.status).toBe(200);
      expect(approve.body.ok).toBe(false);
      expect(approve.body.error.code).toBe(409);
      expect(JSON.parse(approve.body.error.message).error).toBe("grant_invalid_state");
    } finally {
      await app.close();
    }
  });

  test("approve releases tasks parked in waiting_for_grant", async () => {
    const app = await startTestApp("connect-release");
    try {
      const { db, user, connectUser } = await setupConnectUser(app, "rel@example.com");

      const identity = new ConnectIdentityModel(db).create({
        connectUserId: connectUser.id,
        provider: "google",
        providerSubject: "sub-rel",
        emailVerified: true,
      });
      const connectionId = upsertConnection(db, {
        connectUserId: connectUser.id,
        provider: "google",
        scopes: ["gmail.send"],
        accessToken: "tok",
        identityId: identity.id,
      });

      const grant = await postJson(
        app,
        "/api/v1/grants",
        { connection_id: connectionId, scopes: ["gmail.send"] },
        user.token,
      );
      const grantId: string = grant.body.data.id;

      const parked = await postJson(
        app,
        "/api/v1/tasks",
        { url: "https://example.com/gated", connect_grant_id: grantId },
        user.token,
      );
      expect(parked.body.message).toBe("Task waiting for grant approval");
      expect(new Queue(db, "runmesh-tasks").size()).toBe(0);

      await postJson(app, `/api/v1/connect/grants/${grantId}/approve`, {}, user.token);
      expect(new Queue(db, "runmesh-tasks").size()).toBe(1);

      const status = await getJson(app, `/api/v1/tasks/${parked.body.data.task_id}/grant_status`, user.token);
      expect(status.body.data.approval_status).toBe("approved");
      expect(status.body.data.grant_id).toBe(grantId);
    } finally {
      await app.close();
    }
  });
});

describe("connect sessions and OTP", () => {
  test("authenticate mode issues a challenge; verify/ resend paths", async () => {
    const app = await startTestApp("connect-otp");
    try {
      const { db, user } = await setupConnectUser(app, "otp@example.com");

      const created = await postJson(
        app,
        "/api/v1/connect/sessions",
        {
          mode: "authenticate",
          redirect_uri: "https://app.example.com/cb",
          external_user_id: "ext-1",
          email: "otp@example.com",
        },
        user.token,
      );
      expect(created.body.data.challenge_id).toBeTruthy();
      expect(created.body.data.authorize_url ?? null).toBeNull();

      // Unknown challenge, wrong code, bad email all fail distinctly.
      const unknown = await postJson(
        app,
        "/api/v1/connect/otp/verify",
        { challenge_id: "nope", code: "000000" },
        user.token,
      );
      expect(unknown.status).toBe(404);

      const badMode = await postJson(
        app,
        "/api/v1/connect/sessions",
        {
          mode: "party",
          redirect_uri: "https://app.example.com/cb",
          external_user_id: "ext-1",
        },
        user.token,
      );
      expect(badMode.status).toBe(400);

      const badRedirect = await postJson(
        app,
        "/api/v1/connect/sessions",
        {
          mode: "authenticate",
          redirect_uri: "http://app.example.com/cb",
          external_user_id: "ext-1",
          email: "otp@example.com",
        },
        user.token,
      );
      expect(badRedirect.status).toBe(400);

      // Positive verification with a known code hash wired to the session.
      const sessionId: string = new ConnectSessionModel(db).findByState(
        created.body.data.state,
      )!.id;
      const challenge = new ConnectOtpChallengeModel(db).create({
        connectAppId: created.body.data.app_id,
        externalUserId: "ext-1",
        connectSessionId: sessionId,
        email: "otp@example.com",
        codeHash: hashConnectSecret("654321", config.jwtSecret),
        connectUserId: null,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });

      const wrong = await postJson(
        app,
        "/api/v1/connect/otp/verify",
        { challenge_id: challenge.id, code: "000000" },
        user.token,
      );
      expect(wrong.status).toBe(400);

      const verified = await postJson(
        app,
        "/api/v1/connect/otp/verify",
        { challenge_id: challenge.id, code: "654321" },
        user.token,
      );
      expect(verified.body.message).toBe("User verified");
      expect(verified.body.data.session_id).toBe(sessionId);
      expect(verified.body.data.code).toBeTruthy();

      // The issued code exchanges cleanly: authenticate mode carries no grant.
      const exchanged = await postJson(
        app,
        "/api/v1/connect/token",
        { code: verified.body.data.code },
        user.token,
      );
      expect(exchanged.body.data.grant_access_token ?? null).toBeNull();
      expect(exchanged.body.data.mode).toBe("authenticate");

      // Resend cooldown: first resend ok, immediate second is throttled.
      const session2 = await postJson(
        app,
        "/api/v1/connect/sessions",
        {
          mode: "authenticate",
          redirect_uri: "https://app.example.com/cb",
          external_user_id: "ext-1",
          email: "otp@example.com",
        },
        user.token,
      );
      const challengeId2: string = session2.body.data.challenge_id;
      const resent = await postJson(
        app,
        "/api/v1/connect/otp/resend",
        { challenge_id: challengeId2 },
        user.token,
      );
      expect(resent.body.message).toBe("Verification code resent");
      const throttled = await postJson(
        app,
        "/api/v1/connect/otp/resend",
        { challenge_id: challengeId2 },
        user.token,
      );
      expect(throttled.status).toBe(429);
    } finally {
      await app.close();
    }
  });

  test("provider gating and token request validation", async () => {
    const app = await startTestApp("connect-gating");
    try {
      const { user, connectUser } = await setupConnectUser(app, "gate@example.com");

      // Unknown provider rejected.
      const unknown = await postJson(
        app,
        "/api/v1/connect/sessions",
        {
          mode: "connect",
          redirect_uri: "https://app.example.com/cb",
          external_user_id: "ext-1",
          connect_user_id: connectUser.id,
          provider: "nope",
          scopes: ["x"],
        },
        user.token,
      );
      expect(unknown.status).toBe(400);

      // Non-OAuth provider rejected at session creation.
      const slack = await postJson(
        app,
        "/api/v1/connect/sessions",
        {
          mode: "connect",
          redirect_uri: "https://app.example.com/cb",
          external_user_id: "ext-1",
          connect_user_id: connectUser.id,
          provider: "slack",
          scopes: ["chat:write"],
        },
        user.token,
      );
      expect(slack.status).toBe(501);

      // Token exchange requires exactly one of code/grant_id.
      const neither = await postJson(app, "/api/v1/connect/token", {}, user.token);
      expect(neither.status).toBe(422);
      const both = await postJson(
        app,
        "/api/v1/connect/token",
        { code: "x", grant_id: "y" },
        user.token,
      );
      expect(both.status).toBe(422);

      const missing = await postJson(
        app,
        "/api/v1/connect/token",
        { grant_id: "cg_missing" },
        user.token,
      );
      expect(missing.status).toBe(404);

      // Providers catalog is public.
      const providers = await getJson(app, "/api/v1/connect/providers");
      expect(providers.body.data.map((p: { id: string }) => p.id)).toEqual([
        "google",
        "slack",
        "meta",
        "intercom",
      ]);
    } finally {
      await app.close();
    }
  });
});

describe("google provider calls", () => {
  const okToken: FetchLike = async () =>
    new Response(JSON.stringify({ access_token: "ya29.x", expires_in: 3600 }), { status: 200 });

  test("authorize URL carries offline access for connect mode", () => {
    const url = buildGoogleAuthorizeUrl("https://api.example.com", "st", "connect", ["gmail.send"]);
    expect(url).toContain("access_type=offline");
    expect(url).toContain(encodeURIComponent("https://www.googleapis.com/auth/gmail.send"));
    const grantUrl = buildGoogleAuthorizeUrl("https://api.example.com/", "st", "grant", ["gmail.send"]);
    expect(grantUrl).not.toContain("access_type");
    expect(grantUrl).toContain("https%3A%2F%2Fapi.example.com%2Fconnect%2Fcallback");
  });

  test("exchange and account lookup map success and failure shapes", async () => {
    const token = await exchangeGoogleCode("code", "https://api.example.com", okToken);
    expect(token.access_token).toBe("ya29.x");

    const denied: FetchLike = async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    await expect(exchangeGoogleCode("bad", "https://api.example.com", denied)).rejects.toThrow(
      "Google token exchange failed: invalid_grant",
    );

    const info: FetchLike = async () =>
      new Response(JSON.stringify({ user_id: "123", email: "g@example.com", verified_email: true }), {
        status: 200,
      });
    expect(await fetchGoogleProviderAccount("tok", info)).toEqual({
      sub: "123",
      email: "g@example.com",
      email_verified: true,
    });

    const badInfo: FetchLike = async () => new Response("nope", { status: 200 });
    await expect(fetchGoogleProviderAccount("tok", badInfo)).rejects.toThrow(
      "Failed to parse Google token info",
    );

    const userinfo: FetchLike = async () => new Response(JSON.stringify({ sub: "123" }), { status: 200 });
    expect(await fetchGoogleUserinfo("tok", userinfo)).toEqual({ sub: "123" });
  });
});

describe("audit stream", () => {
  test("base ledger and agent telemetry merge with attribution", async () => {
    const app = await startTestApp("connect-audit");
    try {
      const { db, user, workspaceId } = await setupConnectUser(app, "audit@example.com");

      recordAuditEvent(db, {
        eventType: "connect.grant.created",
        actorType: "connect_user",
        actorId: user.id,
        workspaceId,
        metadata: { approval_status: "pending_approval" },
      });

      const now = "2026-01-01T00:00:00.000Z";
      db.insert(agents)
        .values({ id: "ag_1", workspaceId, userId: user.id, name: "Helper", createdAt: now, updatedAt: now })
        .run();
      db.insert(agentRuns)
        .values({ id: "run_1", workspaceId, agentId: "ag_1", threadId: "th_1", startedAt: now, createdAt: now, updatedAt: now })
        .run();
      db.insert(agentEvents)
        .values({ id: "evt_1", workspaceId, runId: "run_1", seq: 0, kind: "tool.call", name: "gmail.send", args: '{"to":"x"}', result: '{"ok":true}', createdAt: "2026-01-02T00:00:00.000Z" })
        .run();

      const all = await getJson(app, "/api/v1/connect/audit", user.token);
      expect(all.body.meta.total).toBe(2);
      // Ascending display order: the January tool call sorts before today's ledger row.
      expect(all.body.data[0].event_type).toBe("tool.call");
      expect(all.body.data[1].event_type).toBe("connect.grant.created");
      expect(all.body.data[1].actor).toBe(user.id.slice(0, 8));
      const tool = all.body.data[0];
      expect(tool.event_type).toBe("tool.call");
      expect(tool.actor).toBe("Helper");
      expect(tool.thread_id).toBe("th_1");
      expect(tool.trace_id).toBe("run_1");

      const filtered = await getJson(app, "/api/v1/connect/audit?event_type=tool.call", user.token);
      expect(filtered.body.meta.total).toBe(1);
      expect(filtered.body.data[0].id).toBe("evt_1");

      const missing = await getJson(app, "/api/v1/connect/audit?event_type=bogus", user.token);
      expect(missing.body.meta.total).toBe(0);
    } finally {
      await app.close();
    }
  });
});
