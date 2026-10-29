import { Router } from "express";
import type { Request } from "express";
import { and, eq } from "drizzle-orm";
import createError from "http-errors";
import { createOAuthState, readOAuthState } from "../../core/auth/tokens.js";
import { config } from "../../core/config.js";
import { cliAuthCodes } from "../../core/db/schema.js";
import { isHttpError } from "../../core/http/errors.js";
import { success } from "../../core/http/responses.js";
import { log } from "../../core/log.js";
import { currentUser, requireJwt } from "../../core/middleware/auth.js";
import { enforceRateLimit, getClientIp } from "../../core/rate-limit.js";
import {
  authCodeFor,
  confirmCliAuth,
  exchangeAuthCode,
  exchangeCodeForToken,
  fetchGithubUser,
  fetchPrimaryEmail,
  findOrCreateUser,
  frontendUrl,
  githubCallbackRedirectUri,
  pollCliAuth,
  requestBaseUrl,
  startCliAuth,
} from "./service.js";

export const authRouter = Router();

function clientIp(req: Request): string {
  return getClientIp(req.headers, req.socket.remoteAddress);
}

function bodyOf(req: Request): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

function queryString(req: Request, name: string): string {
  const value = req.query[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

authRouter.post("/auth/cli/start", async (req, res) => {
  await enforceRateLimit(
    req.ctx.db,
    `cli-start:${clientIp(req)}`,
    10,
    600,
    "Too many login attempts. Try again later.",
  );
  res.json(success(startCliAuth(req.ctx.db, frontendUrl(req))));
});

authRouter.post("/auth/cli/confirm", requireJwt(), (req, res) => {
  const userCode = String(bodyOf(req).user_code ?? "").trim();
  confirmCliAuth(req.ctx.db, currentUser(req).id, userCode);
  res.json(success({ status: "confirmed" }));
});

authRouter.post("/auth/cli/poll", async (req, res) => {
  const deviceCode = String(bodyOf(req).device_code ?? "").trim();
  await enforceRateLimit(
    req.ctx.db,
    `cli-poll:${deviceCode}`,
    240,
    600,
    "Polling too frequently. Slow down.",
  );
  res.json(success(await pollCliAuth(req.ctx.db, deviceCode)));
});

authRouter.get("/cli/verify", (req, res) => {
  const code = queryString(req, "code");
  const row = req.ctx.db
    .select({ userCode: cliAuthCodes.userCode })
    .from(cliAuthCodes)
    .where(and(eq(cliAuthCodes.userCode, code), eq(cliAuthCodes.status, "pending")))
    .limit(1)
    .get();

  const baseUrl = requestBaseUrl(req);
  const safeBase = escapeHtml(baseUrl);
  const safeCodeHtml = escapeHtml(code);
  const safeCodeUrl = encodeURIComponent(code);

  if (!row) {
    res
      .status(200)
      .type("html")
      .send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Invalid Code — Runmesh</title><style>body{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;background:#08090a;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh}main{max-width:440px;padding:40px;text-align:center}h1{font-size:24px}p{color:#969799}</style>
</head><body><main><h1>Code invalid or expired</h1><p>This verification code was not found or has expired. Please run <code>runmesh login</code> again.</p></main></body></html>`);
    return;
  }

  const safeUserCode = escapeHtml(row.userCode);
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Confirm CLI Login — Runmesh</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;background:#08090a;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh}
  main{max-width:480px;padding:40px;text-align:center}
  .code{font-family:ui-monospace,monospace;font-size:36px;letter-spacing:0.15em;background:#1c1c1c;padding:20px 28px;border-radius:12px;display:inline-block;margin:24px 0;border:1px solid #23252a}
  .btn{display:inline-block;height:44px;line-height:44px;padding:0 32px;border:none;border-radius:8px;background:#f2f2f2;color:#08090a;font-size:15px;font-weight:500;cursor:pointer;text-decoration:none}
  .btn:hover{background:#fff}
  .btn:disabled{opacity:0.5;cursor:default}
  p{color:#969799;line-height:1.5;margin:8px 0}
  h1{font-size:24px;font-weight:600;margin:0 0 8px}
  .status{margin-top:16px;font-size:14px}
</style>
</head>
<body>
  <main>
    <h1>Confirm CLI Login</h1>
    <p>A CLI session is requesting access to your Runmesh account.</p>
    <div class="code">${safeUserCode}</div>
    <p style="font-size:13px;color:#595a5c">If this code matches your terminal, click Confirm.</p>
    <div id="auth-section">
      <a href="${safeBase}/auth/github/login?redirect_to=/cli/verify%3Fcode%3D${safeCodeUrl}" class="btn" id="login-btn">Sign in with GitHub</a>
    </div>
    <div id="confirm-section" style="display:none">
      <button class="btn" id="confirm-btn" onclick="confirmLogin()">Confirm</button>
    </div>
    <p class="status" id="status"></p>
  </main>
  <script>
    var token = localStorage.getItem('runmesh-token');
    if (token) {
      document.getElementById('auth-section').style.display = 'none';
      document.getElementById('confirm-section').style.display = 'block';
    }
    function confirmLogin() {
      var token = localStorage.getItem('runmesh-token');
      if (!token) { document.getElementById('status').textContent = 'Please sign in first'; return; }
      document.getElementById('confirm-btn').disabled = true;
      fetch('${safeBase}/auth/cli/confirm', {
        method: 'POST',
        headers: {'Content-Type':'application/json','Authorization':'Bearer '+token},
        body: JSON.stringify({user_code:'${safeCodeHtml}'})
      }).then(function(r){return r.json()}).then(function(d){
        if(d.ok){document.getElementById('status').textContent = 'Confirmed! You can close this tab.';}
        else{document.getElementById('status').textContent = 'Error: '+(d.error?.message||'failed');document.getElementById('confirm-btn').disabled=false;}
      })
    }
  </script>
</body></html>`;

  res.status(200).type("html").send(html);
});

authRouter.get("/auth/github/login", async (req, res) => {
  await enforceRateLimit(
    req.ctx.db,
    `github-login:${clientIp(req)}`,
    30,
    600,
    "Too many login attempts. Try again later.",
  );

  const redirectUri = githubCallbackRedirectUri(req);
  const redirectTo = queryString(req, "redirect_to");
  const state = await createOAuthState(redirectTo);

  const url =
    "https://github.com/login/oauth/authorize" +
    `?client_id=${encodeURIComponent(config.github.clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    "&scope=user:email" +
    `&state=${encodeURIComponent(state)}`;

  res.json(success({ url, state }));
});

authRouter.get("/auth/github/callback", async (req, res) => {
  await enforceRateLimit(
    req.ctx.db,
    `github-callback:${clientIp(req)}`,
    30,
    600,
    "Too many login attempts. Try again later.",
  );

  const code = queryString(req, "code");
  const state = queryString(req, "state");
  const redirectUri = githubCallbackRedirectUri(req);

  const statePayload = await readOAuthState(state);
  if (!statePayload) throw createError(400, "Invalid or expired OAuth state");

  try {
    const accessToken = await exchangeCodeForToken(code, redirectUri);
    const githubUser = await fetchGithubUser(accessToken);

    const githubId = String(githubUser.id);
    const name = githubUser.name || githubUser.login;
    const avatarUrl = githubUser.avatar_url ?? "";
    // Only verified emails may be used for account matching — /user's public email is
    // unverified and must not be trusted.
    const githubEmail = await fetchPrimaryEmail(accessToken);

    const userId = findOrCreateUser(req.ctx.db, {
      githubId,
      name,
      avatarUrl,
      githubEmail,
      login: githubUser.login,
    });

    const authCode = await authCodeFor(userId);
    const redirectTo = String(statePayload.redirect_to ?? "");
    let callbackUrl =
      `${frontendUrl(req)}/auth/callback?code=${encodeURIComponent(authCode)}` +
      `&state=${encodeURIComponent(state)}`;
    if (redirectTo) callbackUrl += `&redirect_to=${encodeURIComponent(redirectTo)}`;

    res.redirect(callbackUrl);
  } catch (err) {
    if (isHttpError(err)) throw err;
    log("error", "github_callback_error", { error: String(err) });
    throw createError(500, "Failed to complete GitHub login");
  }
});

authRouter.post("/auth/exchange", async (req, res) => {
  await enforceRateLimit(
    req.ctx.db,
    `auth-exchange:${clientIp(req)}`,
    30,
    600,
    "Too many attempts. Try again later.",
  );

  const code = String(bodyOf(req).code ?? "").trim();
  if (!code) throw createError(400, "code is required");

  res.json(success(await exchangeAuthCode(req.ctx.db, code)));
});
