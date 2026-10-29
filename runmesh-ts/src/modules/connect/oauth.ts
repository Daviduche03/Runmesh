/**
 * Connect OAuth: provider authorize redirects, the callback that mints connections, the
 * human consent page, and the token exchange that turns codes/grants into scoped access
 * tokens. Every redirect lands back at the app's `redirect_uri` with `state` echoed, so
 * the app can correlate the round trip.
 */
import createError from "http-errors";
import type { Db } from "../../core/db/client.js";
import {
  ConnectAppModel,
  ConnectConnectionModel,
  ConnectGrantModel,
  ConnectSessionModel,
  ConnectUserModel,
} from "../../core/db/orm.js";
import type { ConnectSessionRow } from "../../core/db/orm.js";
import { enforceGrantIssuance } from "../policies/service.js";
import type { FetchLike } from "../webhooks/index.js";
import { recordAuditEvent } from "./audit.js";
import { ensureWorkspaceApp } from "./apps.js";
import {
  appRedirectUrl,
  attachSessionConnectUser,
  bumpMetric,
  buildGrantAccessToken,
  issueConnectCode,
  loadPendingSession,
  parseConnectCode,
  recordLatency,
  requireAuthenticatedAppUser,
  requireGoogleConnectConfig,
  secondsUntil,
} from "./common.js";
import type { ConnectRedirect } from "./common.js";
import { buildGoogleAuthorizeUrl, exchangeGoogleCode, fetchGoogleProviderAccount } from "./google.js";
import { attachProviderIdentity, completeSession, upsertConnection } from "./sessions.js";
import { ensureGrant } from "./grants.js";
import { OAUTH_ENABLED_PROVIDERS, listProvidersCatalog } from "./providers.js";

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Grant-mode authorize: reuse an active connection/grant, else bounce to OAuth or consent. */
export async function grantAuthorizeRedirect(
  db: Db,
  session: ConnectSessionRow,
  publicBaseUrl: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<string> {
  void fetchImpl;
  if (!session.connectUserId) {
    return appRedirectUrl(session, { error: "authentication_required" });
  }

  const connection = new ConnectConnectionModel(db).findByUserProvider(
    session.connectUserId,
    session.provider ?? "",
  );
  if (!connection || connection.status !== "active") {
    if (session.provider === "google") {
      requireGoogleConnectConfig();
      return buildGoogleAuthorizeUrl(
        publicBaseUrl,
        session.state,
        "connect",
        session.scopes,
      );
    }
    throw createError(501, `OAuth authorize not implemented for ${session.provider}`);
  }

  const existingGrant = new ConnectGrantModel(db).findActive(
    session.connectAppId,
    session.connectUserId,
    connection.id,
  );
  if (existingGrant) {
    completeSession(db, { ...session, connectUserId: session.connectUserId });
    const code = await issueConnectCode({
      session,
      connectUserId: session.connectUserId,
      grantId: existingGrant.id,
      connectionId: connection.id,
    });
    return appRedirectUrl(session, { code });
  }

  return `${publicBaseUrl.replace(/\/+$/, "")}/connect/consent?state=${session.state}`;
}

export function connectOAuthErrorRedirect(db: Db, state: string, error?: string | null): string {
  const session = new ConnectSessionModel(db).findByState(state.trim());
  if (!session) throw createError(404, "Connect session not found");
  return appRedirectUrl(session, { error: error || "oauth_failed" });
}

export async function beginConnectAuthorize(
  db: Db,
  state: string,
  publicBaseUrl: string,
): Promise<ConnectRedirect> {
  const session = loadPendingSession(db, state);

  const connectUserId = session.connectUserId;
  if (!connectUserId) {
    return { url: appRedirectUrl(session, { error: "authentication_required" }) };
  }

  if (session.mode === "connect" || session.mode === "grant") {
    if (!session.externalUserId) {
      return { url: appRedirectUrl(session, { error: "authentication_required" }) };
    }
    try {
      requireAuthenticatedAppUser(db, {
        connectAppId: session.connectAppId,
        externalUserId: session.externalUserId,
        connectUserId,
      });
    } catch {
      return { url: appRedirectUrl(session, { error: "authentication_required" }) };
    }
  }

  const attached = attachSessionConnectUser(db, session, connectUserId);

  if (attached.mode === "authenticate") {
    return { url: appRedirectUrl(attached, { error: "use_otp_verify" }) };
  }

  if (attached.mode === "grant") {
    return {
      url: await grantAuthorizeRedirect(db, attached, publicBaseUrl),
      connectUserId,
    };
  }

  if (!OAUTH_ENABLED_PROVIDERS.has(attached.provider as "google")) {
    throw createError(501, `OAuth not enabled for provider ${attached.provider}`);
  }

  if (attached.provider === "google") {
    requireGoogleConnectConfig();
    return {
      url: buildGoogleAuthorizeUrl(publicBaseUrl, attached.state, attached.mode as "connect" | "grant", attached.scopes),
      connectUserId,
    };
  }
  throw createError(501, `OAuth authorize not implemented for ${attached.provider}`);
}

export interface CallbackInput {
  code: string;
  state: string;
  publicBaseUrl: string;
}

export async function handleConnectCallback(
  db: Db,
  input: CallbackInput,
  fetchImpl: FetchLike = defaultFetch,
): Promise<ConnectRedirect> {
  const session = loadPendingSession(db, input.state);
  if (!OAUTH_ENABLED_PROVIDERS.has(session.provider as "google")) {
    return { url: appRedirectUrl(session, { error: "provider_unavailable" }) };
  }

  if (!session.connectUserId) {
    return { url: appRedirectUrl(session, { error: "authentication_required" }) };
  }

  const connectUser = new ConnectUserModel(db).findById(session.connectUserId);
  if (!connectUser) {
    return { url: appRedirectUrl(session, { error: "authentication_required" }) };
  }

  let tokenData: { access_token: string; refresh_token?: string; expires_in?: number };
  let oauthEmail: string | undefined;
  let oauthVerified = false;
  let providerSubject = "";
  try {
    if (session.provider === "google") {
      requireGoogleConnectConfig();
      tokenData = await exchangeGoogleCode(input.code, input.publicBaseUrl, fetchImpl);
      const account = await fetchGoogleProviderAccount(tokenData.access_token, fetchImpl);
      providerSubject = account.sub.trim();
      oauthEmail = account.email;
      oauthVerified = Boolean(account.email_verified);
    } else {
      return { url: appRedirectUrl(session, { error: "provider_unavailable" }) };
    }
  } catch {
    return { url: appRedirectUrl(session, { error: "oauth_failed" }) };
  }

  if (!providerSubject) {
    return { url: appRedirectUrl(session, { error: "provider_missing" }) };
  }

  const identity = attachProviderIdentity(db, {
    connectUserId: connectUser.id,
    provider: "google",
    providerSubject,
    email: oauthEmail,
    emailVerified: oauthVerified,
  });

  const app = new ConnectAppModel(db).findById(session.connectAppId);
  if (!app) throw createError(404, "Connect app not found");

  const connectionModel = new ConnectConnectionModel(db);
  const grantModel = new ConnectGrantModel(db);

  if (session.mode === "connect") {
    const grantWorkspaceId = session.workspaceId;
    if (!grantWorkspaceId) throw createError(400, "Connect session has no workspace");
    const connectionId = upsertConnection(db, {
      connectUserId: connectUser.id,
      provider: session.provider ?? "google",
      scopes: session.scopes,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      identityId: identity.id,
      accountLabel: connectUser.primaryEmail ?? oauthEmail ?? null,
      workspaceId: grantWorkspaceId,
    });
    const grantId = await ensureGrant(db, {
      connectAppId: session.connectAppId,
      connectUserId: connectUser.id,
      connectionId,
      scopes: session.scopes,
      workspaceId: grantWorkspaceId,
    });
    completeSession(db, { ...session, connectUserId: connectUser.id });
    recordAuditEvent(db, {
      eventType: "connect.connection.created",
      actorType: "connect_user",
      actorId: connectUser.id,
      connectUserId: connectUser.id,
      connectAppId: app.id,
      resourceType: "connect_connection",
      resourceId: connectionId,
      workspaceId: grantWorkspaceId,
      metadata: { provider: session.provider, grant_id: grantId },
    });
    const code = await issueConnectCode({
      session,
      connectUserId: connectUser.id,
      grantId,
      connectionId,
    });
    return { url: appRedirectUrl(session, { code }), connectUserId: connectUser.id };
  }

  let connection = connectionModel.findByUserProvider(connectUser.id, session.provider ?? "");
  if (!connection || connection.status !== "active") {
    if (session.scopes.length === 0) {
      return { url: appRedirectUrl(session, { error: "connection_required" }) };
    }
    const sessionWorkspaceId = session.workspaceId;
    if (!sessionWorkspaceId) throw createError(400, "Connect session has no workspace");
    const connectionId = upsertConnection(db, {
      connectUserId: connectUser.id,
      provider: session.provider ?? "google",
      scopes: session.scopes,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      identityId: identity.id,
      accountLabel: oauthEmail,
      workspaceId: sessionWorkspaceId,
    });
    connection = connectionModel.findById(connectionId);
    if (!connection) {
      return { url: appRedirectUrl(session, { error: "connection_required" }) };
    }
  }

  if (connection.status !== "active") {
    return { url: appRedirectUrl(session, { error: "connection_required" }) };
  }

  const existingGrant = grantModel.findActive(
    session.connectAppId,
    connectUser.id,
    connection.id,
  );
  if (existingGrant) {
    completeSession(db, { ...session, connectUserId: connectUser.id });
    const code = await issueConnectCode({
      session,
      connectUserId: connectUser.id,
      grantId: existingGrant.id,
      connectionId: connection.id,
    });
    return { url: appRedirectUrl(session, { code }), connectUserId: connectUser.id };
  }

  return {
    url: `${input.publicBaseUrl.replace(/\/+$/, "")}/connect/consent?state=${session.state}`,
    connectUserId: connectUser.id,
  };
}

export function getConnectConsentPage(db: Db, state: string): string {
  const session = loadPendingSession(db, state);
  if (session.mode !== "grant") {
    throw createError(400, "Consent is only available for grant sessions");
  }
  if (!session.connectUserId) {
    throw createError(400, "Connect session is missing identity");
  }

  const app = new ConnectAppModel(db).findById(session.connectAppId);
  if (!app) throw createError(404, "Connect app not found");

  const connection = new ConnectConnectionModel(db).findByUserProvider(
    session.connectUserId,
    session.provider ?? "",
  );
  if (!connection) throw createError(404, "Connection not found");

  const scopes = session.scopes.length > 0 ? session.scopes.join(", ") : (session.provider ?? "");
  const account = connection.providerAccountLabel ?? session.provider ?? "";
  // All interpolated values are HTML-escaped: app names / account labels are
  // user-controlled and would otherwise be a stored-XSS vector.
  const safeAppName = escapeHtml(app.name);
  const safeAccount = escapeHtml(account);
  const safeScopes = escapeHtml(scopes);
  const safeState = escapeHtml(session.state);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Runmesh Connect</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
    main { max-width: 480px; margin: 48px auto; padding: 24px; background: #fff; border: 1px solid #e2e8f0; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { margin: 0 0 16px; line-height: 1.5; color: #475569; }
    .meta { font-size: 14px; margin-bottom: 24px; }
    form { display: flex; gap: 12px; }
    button { flex: 1; height: 40px; border: 1px solid #0f172a; background: #0f172a; color: #fff; cursor: pointer; }
    button[name="action"][value="deny"] { background: #fff; color: #0f172a; }
  </style>
</head>
<body>
  <main>
    <h1>Approve access</h1>
    <p><strong>${safeAppName}</strong> wants to use your connected account.</p>
    <div class="meta">
      <div>Account: ${safeAccount}</div>
      <div>Scopes: ${safeScopes}</div>
    </div>
    <form method="post" action="/connect/consent">
      <input type="hidden" name="state" value="${safeState}" />
      <button type="submit" name="action" value="approve">Approve</button>
      <button type="submit" name="action" value="deny">Deny</button>
    </form>
  </main>
</body>
</html>`;
}

export interface ConsentInput {
  state: string;
  action: string;
}

export async function submitConnectConsent(
  db: Db,
  input: ConsentInput,
): Promise<ConnectRedirect> {
  const action = input.action.trim().toLowerCase();
  if (action !== "approve" && action !== "deny") {
    throw createError(400, "Invalid consent action");
  }

  const session = loadPendingSession(db, input.state);
  if (session.mode !== "grant") {
    throw createError(400, "Consent is only available for grant sessions");
  }
  if (!session.connectUserId) {
    throw createError(400, "Connect session is missing identity");
  }

  const sessionModel = new ConnectSessionModel(db);
  if (action === "deny") {
    sessionModel.updateSession(session.id, { status: "cancelled" });
    recordAuditEvent(db, {
      eventType: "connect.grant.denied",
      actorType: "connect_user",
      actorId: session.connectUserId,
      connectUserId: session.connectUserId,
      connectAppId: session.connectAppId,
      resourceType: "connect_session",
      resourceId: session.id,
      workspaceId: session.workspaceId,
    });
    return { url: appRedirectUrl(session, { error: "access_denied" }) };
  }

  const connection = new ConnectConnectionModel(db).findByUserProvider(
    session.connectUserId,
    session.provider ?? "",
  );
  if (!connection) {
    return { url: appRedirectUrl(session, { error: "connection_required" }) };
  }

  const grantWorkspaceId = session.workspaceId;
  if (!grantWorkspaceId) throw createError(400, "Connect session has no workspace");
  const grantId = await ensureGrant(db, {
    connectAppId: session.connectAppId,
    connectUserId: session.connectUserId,
    connectionId: connection.id,
    scopes: session.scopes.length > 0 ? session.scopes : [session.provider ?? ""],
    workspaceId: grantWorkspaceId,
  });
  completeSession(db, { ...session, connectUserId: session.connectUserId });
  recordAuditEvent(db, {
    eventType: "connect.grant.approved",
    actorType: "connect_user",
    actorId: session.connectUserId,
    connectUserId: session.connectUserId,
    connectAppId: session.connectAppId,
    resourceType: "connect_grant",
    resourceId: grantId,
    workspaceId: grantWorkspaceId,
  });
  const code = await issueConnectCode({
    session,
    connectUserId: session.connectUserId,
    grantId,
    connectionId: connection.id,
  });
  return { url: appRedirectUrl(session, { code }), connectUserId: session.connectUserId };
}

export interface TokenExchangeInput {
  code?: string | null;
  grantId?: string | null;
  taskId?: string | null;
  workflowRunId?: string | null;
  workspaceProjectId?: string | null;
  agentId?: string | null;
}

export async function exchangeConnectToken(
  db: Db,
  input: TokenExchangeInput,
  developerUserId: string,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  const app = ensureWorkspaceApp(db, workspaceId, developerUserId);
  const grantModel = new ConnectGrantModel(db);

  const result: Record<string, unknown> = {
    connect_user_id: null,
    external_user_id: null,
    session_id: null,
    grant_id: null,
    connection_id: null,
    mode: null,
    grant_access_token: null,
    grant_access_expires_in: null,
  };
  let grantId: string | null = null;

  if (input.code) {
    const payload = await parseConnectCode(input.code);
    if (payload.app_id !== app.id) {
      throw createError(400, "Connect code does not belong to this app");
    }
    const session = new ConnectSessionModel(db).findById(String(payload.session_id ?? ""));
    if (!session) throw createError(400, "Connect session not found");
    if (payload.workspace_id !== workspaceId || session.workspaceId !== workspaceId) {
      throw createError(400, "Connect code does not belong to this workspace");
    }
    if (session.status !== "completed") {
      throw createError(400, "Connect session is not completed");
    }
    if (session.connectUserId !== payload.connect_user_id) {
      throw createError(400, "Connect code does not match session");
    }
    result.connect_user_id = payload.connect_user_id ?? null;
    result.external_user_id = payload.external_user_id ?? null;
    result.session_id = payload.session_id ?? null;
    result.grant_id = payload.grant_id ?? null;
    result.connection_id = payload.connection_id ?? null;
    result.mode = session.mode;
    grantId = typeof payload.grant_id === "string" ? payload.grant_id : null;
  } else {
    const grant = input.grantId ? grantModel.findById(input.grantId) : null;
    if (!grant || grant.status !== "active") {
      throw createError(404, "Grant not found");
    }
    if (grant.workspaceId !== workspaceId) {
      throw createError(403, "Grant does not belong to this workspace");
    }
    result.connect_user_id = grant.connectUserId;
    result.grant_id = grant.id;
    result.connection_id = grant.connectionId;
    grantId = grant.id;
  }

  if (grantId) {
    const grant = grantModel.findById(grantId);
    if (!grant || grant.status !== "active") {
      throw createError(400, "Grant is not active");
    }
    if (grant.workspaceId !== workspaceId) {
      throw createError(400, "Grant does not belong to this workspace");
    }

    if (grant.approvalStatus === "denied") {
      bumpMetric("token_blocked_denied");
      throw createError(
        403,
        JSON.stringify({
          error: "grant_denied",
          message: "Grant has been denied and cannot be used",
          grant_id: grant.id,
        }),
      );
    }
    if (grant.approvalStatus !== "approved") {
      bumpMetric("token_blocked_pending");
      throw createError(
        403,
        JSON.stringify({
          error: "grant_pending_approval",
          message: "Grant is awaiting approval",
          grant_id: grant.id,
        }),
      );
    }

    if (grant.validFrom) {
      const validFrom = Date.parse(grant.validFrom);
      if (!Number.isNaN(validFrom) && Date.now() < validFrom) {
        bumpMetric("token_blocked_not_yet_valid");
        throw createError(
          403,
          JSON.stringify({
            error: "grant_not_yet_valid",
            message: "Grant is not yet valid",
            valid_from: grant.validFrom,
          }),
        );
      }
    }
    if (grant.validUntil) {
      const validUntil = Date.parse(grant.validUntil);
      if (!Number.isNaN(validUntil) && Date.now() > validUntil) {
        bumpMetric("token_blocked_expired");
        throw createError(
          403,
          JSON.stringify({
            error: "grant_expired",
            message: "Grant validity window has passed",
            grant_id: grant.id,
            valid_until: grant.validUntil,
          }),
        );
      }
    }
    if (grant.maxUses !== null && grant.maxUses !== undefined && grant.useCount >= grant.maxUses) {
      bumpMetric("token_blocked_exhausted");
      throw createError(
        403,
        JSON.stringify({
          error: "grant_exhausted",
          message: "Grant has reached max uses",
          grant_id: grant.id,
        }),
      );
    }
    // Resource filters are stored JSON: reject malformed shapes rather than guessing.
    if (grant.resourceFilters !== null && grant.resourceFilters !== undefined) {
      const filters = grant.resourceFilters;
      const github = (filters as Record<string, unknown>).github as
        | Record<string, unknown>
        | undefined;
      if (
        github !== undefined &&
        (typeof github !== "object" || github === null || !Array.isArray(github.repos))
      ) {
        bumpMetric("token_blocked_bad_filter");
        throw createError(
          400,
          JSON.stringify({ error: "invalid_resource_filters", grant_id: grant.id }),
        );
      }
    }

    const started = Date.now();
    result.grant_access_token = await buildGrantAccessToken({
      grant,
      taskId: input.taskId,
      workflowRunId: input.workflowRunId,
      workspaceProjectId: input.workspaceProjectId,
    });
    result.grant_access_expires_in = 60 * 60;
    if (grant.maxUses !== null && grant.maxUses !== undefined) {
      grantModel.updateGrant(grant.id, { useCount: grant.useCount + 1 });
    }
    bumpMetric("token_issued");
    recordLatency((Date.now() - started) / 1000);
    result.task_id = input.taskId ?? null;
    result.workflow_run_id = input.workflowRunId ?? null;
    result.agent_id = input.agentId ?? null;
    result.approval_status = grant.approvalStatus;
    result.valid_from = grant.validFrom;
    result.valid_until = grant.validUntil;
    result.seconds_until_expiration = secondsUntil(grant.validUntil);
    if (input.grantId) {
      result.scopes = grant.scopes;
    }
  }

  recordAuditEvent(db, {
    eventType: "connect.token.exchanged",
    actorType: "developer",
    actorId: developerUserId,
    connectAppId: app.id,
    resourceType: "connect_token",
    resourceId: typeof result.grant_id === "string" ? result.grant_id : null,
    workspaceId,
    metadata: {
      task_id: input.taskId ?? null,
      workflow_run_id: input.workflowRunId ?? null,
      workspace_project_id: input.workspaceProjectId ?? null,
      agent_id: input.agentId ?? null,
      grant_id: result.grant_id ?? null,
      connection_id: result.connection_id ?? null,
      connect_user_id: result.connect_user_id ?? null,
    },
  });

  return result;
}

export function listConnectProviders(): Array<{
  id: string;
  scopes: string[];
  oauth_enabled: boolean;
}> {
  return listProvidersCatalog();
}
