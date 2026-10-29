/**
 * Shared Connect plumbing: session/token helpers, lookups, and validation.
 *
 * Two short-lived JWTs circulate outside the normal auth tokens, both HS256 via the app
 * secret: connect codes (5 min, handed to the app after consent) and grant access tokens
 * (`rct_` prefix, 60 min, minted at token exchange). Types are checked on parse so a code
 * can never be mistaken for a grant token.
 */
import createError from "http-errors";
import { config } from "../../core/config.js";
import { signToken, verifyToken } from "../../core/auth/tokens.js";
import type { Db } from "../../core/db/client.js";
import {
  ConnectAppModel,
  ConnectAppUserModel,
  ConnectIdentityModel,
  ConnectSessionModel,
  ConnectUserModel,
} from "../../core/db/orm.js";
import type {
  ConnectAppRow,
  ConnectGrantRow,
  ConnectSessionRow,
  ConnectUserRow,
} from "../../core/db/orm.js";
import { hashConnectSecret } from "./crypto.js";
import { isValidEmail, normalizeEmail } from "./providers.js";

export const SESSION_TTL_MINUTES = 15;
export const CONNECT_CODE_TTL_MINUTES = 5;
export const GRANT_ACCESS_TTL_MINUTES = 60;
export const VALID_SESSION_MODES = new Set(["authenticate", "connect", "grant"]);
export const GRANT_ACCESS_PREFIX = "rct_";
export const OTP_ISSUE_MAX_PER_HOUR = 5;

/** In-memory counters/histograms, matching the Python module globals. */
export const CONNECT_METRICS: Record<string, number> = {};
export const CONNECT_LATENCY: number[] = [];

export function bumpMetric(name: string, by = 1): void {
  CONNECT_METRICS[name] = (CONNECT_METRICS[name] ?? 0) + by;
}

export function recordLatency(seconds: number): void {
  CONNECT_LATENCY.push(seconds);
  if (CONNECT_LATENCY.length > 1000) CONNECT_LATENCY.splice(0, CONNECT_LATENCY.length - 1000);
}

export interface ConnectRedirect {
  url: string;
  connectUserId?: string | null;
  accountToken?: string | null;
}

export function appRedirectUrl(
  session: Pick<ConnectSessionRow, "redirectUri" | "state">,
  options: { code?: string | null; error?: string | null } = {},
): string {
  const url = new URL(session.redirectUri);
  url.searchParams.set("state", session.state);
  if (options.code) url.searchParams.set("code", options.code);
  if (options.error) url.searchParams.set("error", options.error);
  return url.toString();
}

/** Attach the verified connect user to the session and link the app identity. */
export function attachSessionConnectUser(
  db: Db,
  session: ConnectSessionRow,
  connectUserId: string,
): ConnectSessionRow {
  const sessionModel = new ConnectSessionModel(db);
  if (session.connectUserId !== connectUserId) {
    sessionModel.updateSession(session.id, { connectUserId });
  }
  if (session.externalUserId) {
    new ConnectAppUserModel(db).linkUser(
      session.connectAppId,
      session.externalUserId,
      connectUserId,
    );
  }
  const refreshed = sessionModel.findById(session.id);
  if (!refreshed) throw createError(500, "Connect session update failed");
  return refreshed;
}

export interface GrantAccessTokenInput {
  grant: ConnectGrantRow;
  taskId?: string | null;
  workflowRunId?: string | null;
  workspaceProjectId?: string | null;
}

export async function buildGrantAccessToken(input: GrantAccessTokenInput): Promise<string> {
  const { grant } = input;
  const token = await signToken(
    {
      type: "connect_grant_access",
      grant_id: grant.id,
      app_id: grant.connectAppId,
      connect_user_id: grant.connectUserId,
      connection_id: grant.connectionId,
      scopes: grant.scopes,
      ...(input.taskId ? { task_id: input.taskId } : {}),
      ...(input.workflowRunId ? { workflow_run_id: input.workflowRunId } : {}),
      ...(input.workspaceProjectId ? { workspace_project_id: input.workspaceProjectId } : {}),
    },
    GRANT_ACCESS_TTL_MINUTES * 60,
  );
  return `${GRANT_ACCESS_PREFIX}${token}`;
}

export async function parseGrantAccessToken(token: string): Promise<Record<string, unknown>> {
  if (!token.startsWith(GRANT_ACCESS_PREFIX)) {
    throw createError(401, "Invalid grant access token");
  }
  const payload = await verifyToken(token.slice(GRANT_ACCESS_PREFIX.length));
  if (!payload || payload.type !== "connect_grant_access") {
    throw createError(401, "Invalid grant access token");
  }
  return payload;
}

export interface ConnectCodeInput {
  session: ConnectSessionRow;
  connectUserId: string;
  grantId?: string | null;
  connectionId?: string | null;
}

export async function issueConnectCode(input: ConnectCodeInput): Promise<string> {
  const { session } = input;
  return signToken(
    {
      type: "connect_code",
      session_id: session.id,
      app_id: session.connectAppId,
      workspace_id: session.workspaceId,
      connect_user_id: input.connectUserId,
      external_user_id: session.externalUserId,
      grant_id: input.grantId ?? null,
      connection_id: input.connectionId ?? null,
    },
    CONNECT_CODE_TTL_MINUTES * 60,
  );
}

export async function parseConnectCode(code: string): Promise<Record<string, unknown>> {
  const payload = await verifyToken(code);
  if (!payload || payload.type !== "connect_code") {
    throw createError(400, "Invalid connect code");
  }
  return payload;
}

export function getOwnedApp(db: Db, developerUserId: string, appId: string): ConnectAppRow {
  const app = new ConnectAppModel(db).findById(appId);
  if (!app || app.developerUserId !== developerUserId) {
    throw createError(404, "Connect app not found");
  }
  return app;
}

/** Load a live session by state; expired ones are flipped to `expired` with a 410. */
export function loadPendingSession(db: Db, state: string): ConnectSessionRow {
  const session = new ConnectSessionModel(db).findByState(state.trim());
  if (!session) throw createError(404, "Connect session not found");
  if (session.status !== "pending") {
    throw createError(409, "Connect session is no longer active");
  }
  if (Date.parse(session.expiresAt) <= Date.now()) {
    new ConnectSessionModel(db).updateSession(session.id, { status: "expired" });
    throw createError(410, "Connect session expired");
  }
  return session;
}

export function serializeSession(
  session: ConnectSessionRow,
  options: { authorizeUrl?: string | null; challengeId?: string | null; challengeExpiresAt?: string | null } = {},
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: session.id,
    app_id: session.connectAppId,
    external_user_id: session.externalUserId,
    mode: session.mode,
    provider: session.provider,
    scopes: session.scopes,
    redirect_uri: session.redirectUri,
    state: session.state,
    status: session.status,
    expires_at: session.expiresAt,
  };
  if (options.authorizeUrl != null) payload.authorize_url = options.authorizeUrl;
  if (options.challengeId != null) payload.challenge_id = options.challengeId;
  if (options.challengeExpiresAt != null) payload.challenge_expires_at = options.challengeExpiresAt;
  return payload;
}

export async function findConnectUserByVerifiedEmail(
  db: Db,
  email: string,
): Promise<ConnectUserRow | null> {
  const normalized = normalizeEmail(email);
  const direct = new ConnectUserModel(db).findByPrimaryEmail(normalized);
  if (direct) return direct;
  const identities = new ConnectIdentityModel(db).listVerifiedByEmail(normalized);
  if (identities.length === 0) return null;
  return new ConnectUserModel(db).findById(identities[0]!.connectUserId);
}

export async function findOrCreateConnectUserByEmail(
  db: Db,
  email: string,
): Promise<ConnectUserRow> {
  const existing = await findConnectUserByVerifiedEmail(db, email);
  if (existing) return existing;
  return new ConnectUserModel(db).create({
    primaryEmail: normalizeEmail(email),
    primaryEmailVerified: true,
  });
}

/** The external user must have completed the app's own login before connect/grant. */
export function requireAuthenticatedAppUser(
  db: Db,
  options: { connectAppId: string; externalUserId: string; connectUserId: string },
): ConnectUserRow {
  const connectUser = new ConnectUserModel(db).findById(options.connectUserId);
  if (!connectUser) throw createError(404, "Connect user not found");
  if (connectUser.status !== "active") throw createError(403, "Connect user is not active");
  if (!connectUser.primaryEmailVerified || !connectUser.primaryEmail) {
    throw createError(403, "User must authenticate before connect or grant");
  }
  const appUser = new ConnectAppUserModel(db).findByExternalUser(
    options.connectAppId,
    options.externalUserId,
  );
  if (!appUser || appUser.connectUserId !== options.connectUserId) {
    throw createError(403, "User must authenticate for this app before connect or grant");
  }
  return connectUser;
}

export function requireGoogleConnectConfig(): void {
  if (!config.google.clientId || !config.google.clientSecret) {
    throw createError(503, "Google Connect OAuth is not configured");
  }
}

export function secondsUntil(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const millis = Date.parse(timestamp);
  if (Number.isNaN(millis)) return null;
  return Math.max(0, Math.trunc((millis - Date.now()) / 1000));
}

export { hashConnectSecret, isValidEmail, normalizeEmail };
