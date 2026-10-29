import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readOAuthState, signToken, verifyToken } from "../../../src/core/auth/tokens.js";
import {
  createTestUser,
  getJson,
  postJson,
  startTestApp,
} from "../../helpers/test-app.js";
import type { TestApp } from "../../helpers/test-app.js";

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp("auth");
});

afterAll(async () => {
  await app.close();
});

describe("CLI device flow", () => {
  test("start returns a device code, a formatted user code and a verification URI", async () => {
    const response = await postJson(app, "/auth/cli/start", {});
    expect(response.status).toBe(200);
    expect(response.body.data.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(response.body.data.device_code.length).toBeGreaterThan(20);
    expect(response.body.data.verification_uri).toContain("/cli/verify?code=");
    expect(response.body.data.expires_in).toBe(600);
  });

  test("confirm requires a session token", async () => {
    const start = await postJson(app, "/auth/cli/start", {});
    const response = await postJson(app, "/auth/cli/confirm", {
      user_code: start.body.data.user_code,
    });
    expect(response.status).toBe(401);
  });

  test("start → confirm → poll mints a working CLI token exactly once", async () => {
    const user = await createTestUser(app, "cli@example.com");
    const start = await postJson(app, "/auth/cli/start", {});
    const { device_code: deviceCode, user_code: userCode } = start.body.data;

    const pending = await postJson(app, "/auth/cli/poll", { device_code: deviceCode });
    expect(pending.body.data.status).toBe("pending");

    const confirmed = await postJson(
      app,
      "/auth/cli/confirm",
      { user_code: userCode },
      user.token,
    );
    expect(confirmed.body.data.status).toBe("confirmed");

    const polled = await postJson(app, "/auth/cli/poll", { device_code: deviceCode });
    expect(polled.body.data.status).toBe("confirmed");
    expect(polled.body.data.user.id).toBe(user.id);

    const claims = await verifyToken(polled.body.data.token);
    expect(claims?.sub).toBe(user.id);
    // The dashboard decodes the payload itself (frontend/src/lib/stores/auth-store.ts).
    expect(claims?.id).toBe(user.id);
    expect(claims?.email).toBe("cli@example.com");

    const reused = await postJson(app, "/auth/cli/poll", { device_code: deviceCode });
    expect(reused.status).toBe(404);
  });

  test("confirm with an unknown code is a 404", async () => {
    const user = await createTestUser(app, "unknown@example.com");
    const response = await postJson(
      app,
      "/auth/cli/confirm",
      { user_code: "AAAA-BBBB" },
      user.token,
    );
    expect(response.status).toBe(404);
    expect(response.body.error.message).toBe("Invalid or expired code");
  });

  test("poll with an unknown device code is a 404", async () => {
    const response = await postJson(app, "/auth/cli/poll", { device_code: "nope" });
    expect(response.status).toBe(404);
  });
});

describe("session exchange", () => {
  test("rejects a token that is not an auth code", async () => {
    const user = await createTestUser(app, "exchange@example.com");
    const response = await postJson(app, "/auth/exchange", { code: user.token });
    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe("Invalid or expired auth code");
  });

  test("a missing code is a 400", async () => {
    const response = await postJson(app, "/auth/exchange", {});
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("code is required");
  });

  test("swaps an auth code for a session token usable on /api/me", async () => {
    const user = await createTestUser(app, "exchange2@example.com");
    const code = await signToken({ type: "auth_code", sub: user.id }, 60);

    const exchanged = await postJson(app, "/auth/exchange", { code });
    expect(exchanged.status).toBe(200);
    expect(exchanged.body.data.user.id).toBe(user.id);

    const claims = await verifyToken(exchanged.body.data.token);
    expect(claims?.sub).toBe(user.id);
    expect(claims?.id).toBe(user.id);
    expect(claims?.email).toBe("exchange2@example.com");

    const me = await getJson(app, "/api/me", exchanged.body.data.token);
    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(user.id);
  });
});

describe("GitHub OAuth", () => {
  test("login returns an authorize URL with a verifiable state", async () => {
    const response = await getJson(app, "/auth/github/login?redirect_to=/agents");
    expect(response.status).toBe(200);
    expect(response.body.data.url).toContain("https://github.com/login/oauth/authorize");
    expect(response.body.data.url).toContain("scope=user:email");
    expect(response.body.data.url).toContain("state=");

    const state = await readOAuthState(response.body.data.state);
    expect(state?.type).toBe("oauth_state");
    expect(state?.redirect_to).toBe("/agents");
  });

  test("login drops an absolute redirect target", async () => {
    const response = await getJson(app, "/auth/github/login?redirect_to=https://evil.example");
    const state = await readOAuthState(response.body.data.state);
    expect(state?.redirect_to).toBe("");
  });

  test("callback rejects an invalid state before calling GitHub", async () => {
    const response = await fetch(`${app.base}/auth/github/callback?code=x&state=bogus`, {
      redirect: "manual",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Invalid or expired OAuth state");
  });
});

describe("CLI verify page", () => {
  test("renders the pending code", async () => {
    const start = await postJson(app, "/auth/cli/start", {});
    const code = start.body.data.user_code as string;

    const response = await fetch(`${app.base}/cli/verify?code=${encodeURIComponent(code)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const html = await response.text();
    expect(html).toContain(code);
    expect(html).toContain("/auth/cli/confirm");
  });

  test("unknown code renders the invalid page", async () => {
    const response = await fetch(`${app.base}/cli/verify?code=ZZZZ-9999`);
    const html = await response.text();
    expect(html).toContain("Code invalid or expired");
  });

  test("HTML in the query string is escaped", async () => {
    const response = await fetch(
      `${app.base}/cli/verify?code=${encodeURIComponent('"><script>alert(1)</script>')}`,
    );
    const html = await response.text();
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
