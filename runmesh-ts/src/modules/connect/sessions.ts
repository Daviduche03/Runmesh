/**
 * Connect sessions: the end-user login that precedes OAuth.
 *
 * Three modes share one table. `authenticate` proves an email address with a one-time code
 * and completes inline; `connect`/`grant` require a previously authenticated app user and end
 * at the provider authorize redirect (the OAuth callback finishes them in `oauth.ts`).
 */
import createError from "http-errors";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../../core/config.js";
import type { Db } from "../../core/db/client.js";
import {
  ConnectAppModel,
  ConnectAppUserModel,
  ConnectConnectionModel,
  ConnectIdentityModel,
  ConnectOtpChallengeModel,
  ConnectSessionModel,
  ConnectUserModel,
} from "../../core/db/orm.js";
import type { ConnectSessionRow } from "../../core/db/orm.js";
import { log } from "../../core/log.js";
import { enforceRateLimit } from "../../core/rate-limit.js";
import { recordAuditEvent } from "./audit.js";
import { ensureWorkspaceApp } from "./apps.js";
import {
  attachSessionConnectUser,
  findConnectUserByVerifiedEmail,
  findOrCreateConnectUserByEmail,
  getOwnedApp,
  issueConnectCode,
  requireAuthenticatedAppUser,
  serializeSession,
} from "./common.js";
import { OTP_ISSUE_MAX_PER_HOUR, SESSION_TTL_MINUTES, VALID_SESSION_MODES } from "./common.js";
import { encryptConnectSecret, hashConnectSecret } from "./crypto.js";
import {
  OAUTH_ENABLED_PROVIDERS,
  generateOtpCode,
  isValidEmail,
  normalizeEmail,
  normalizeRequestedScopes,
  otpExpiresAt,
  parseConnectProvider,
  validateProviderAllowed,
} from "./providers.js";
import type { ConnectProviderId, ConnectSessionMode } from "./providers.js";

export interface OtpChallengeResult {
  challenge_id: string;
  expires_at: string;
}

export async function sendConnectOtpEmail(toEmail: string, code: string): Promise<void> {
  if (!config.resendApiKey) {
    // Dev fallback: never log the code itself, only that one was issued.
    log("info", "connect_otp_issued", { email: toEmail });
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.connectEmailFrom,
      to: [toEmail],
      subject: "Your Runmesh Connect code",
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status >= 400) {
    const text = await response.text().catch(() => "");
    throw createError(502, `Failed to send verification email: ${text.slice(0, 200)}`);
  }
}

export interface IssueOtpChallengeInput {
  connectAppId: string;
  externalUserId: string;
  email: string;
  connectSessionId?: string | null;
}

export async function issueOtpChallenge(
  db: Db,
  input: IssueOtpChallengeInput,
): Promise<OtpChallengeResult> {
  const normalizedEmail = normalizeEmail(input.email);
  if (!isValidEmail(normalizedEmail)) throw createError(400, "valid email is required");

  const connectUser = await findConnectUserByVerifiedEmail(db, normalizedEmail);

  const otpModel = new ConnectOtpChallengeModel(db);
  const recent = otpModel.countRecentForEmail(
    normalizedEmail,
    new Date(Date.now() - 60 * 60_1000).toISOString(),
  );
  if (recent >= OTP_ISSUE_MAX_PER_HOUR) {
    throw createError(429, "Too many verification codes requested. Try again later.");
  }

  const code = generateOtpCode();
  const challenge = otpModel.create({
    connectAppId: input.connectAppId,
    externalUserId: input.externalUserId,
    connectSessionId: input.connectSessionId ?? null,
    email: normalizedEmail,
    codeHash: hashConnectSecret(code, config.jwtSecret),
    connectUserId: connectUser ? connectUser.id : null,
    expiresAt: otpExpiresAt(),
  });
  await sendConnectOtpEmail(normalizedEmail, code);
  return { challenge_id: challenge.id, expires_at: challenge.expiresAt };
}

export async function resendConnectOtp(
  db: Db,
  challengeId: string,
  developerUserId: string,
): Promise<OtpChallengeResult> {
  const otpModel = new ConnectOtpChallengeModel(db);
  const challenge = otpModel.findById(challengeId.trim());
  if (!challenge) throw createError(404, "Verification challenge not found");

  getOwnedApp(db, developerUserId, challenge.connectAppId);

  if (!["pending", "expired", "failed"].includes(challenge.status)) {
    throw createError(400, "Verification challenge cannot be resent");
  }

  // Cooldown: at most one resend per challenge per minute.
  await enforceRateLimit(
    db,
    `connect-otp-resend:${challenge.id}`,
    1,
    60,
    "Verification code was just sent. Please wait before resending.",
  );

  const code = generateOtpCode();
  const expiresAt = otpExpiresAt();
  otpModel.updateChallenge(challenge.id, {
    codeHash: hashConnectSecret(code, config.jwtSecret),
    attempts: 0,
    expiresAt,
    status: "pending",
  });
  await sendConnectOtpEmail(challenge.email, code);
  return { challenge_id: challenge.id, expires_at: expiresAt };
}

export interface OtpVerifyResult {
  connect_user_id: string;
  external_user_id: string;
  email: string;
  session_id?: string;
  code?: string;
}

export async function verifyConnectOtp(
  db: Db,
  challengeId: string,
  code: string,
  developerUserId: string,
): Promise<OtpVerifyResult> {
  const otpModel = new ConnectOtpChallengeModel(db);
  const challenge = otpModel.findById(challengeId.trim());
  if (!challenge) throw createError(404, "Verification challenge not found");
  if (challenge.status !== "pending") {
    throw createError(400, "Verification challenge is not active");
  }

  getOwnedApp(db, developerUserId, challenge.connectAppId);

  if (Date.parse(challenge.expiresAt) <= Date.now()) {
    otpModel.updateChallenge(challenge.id, { status: "expired" });
    throw createError(400, "Verification code expired");
  }

  if (challenge.attempts >= 5) {
    otpModel.updateChallenge(challenge.id, { status: "failed" });
    throw createError(400, "Too many verification attempts");
  }

  const expected = hashConnectSecret(code.trim(), config.jwtSecret);
  const actual = Buffer.from(challenge.codeHash, "utf8");
  const candidate = Buffer.from(expected, "utf8");
  if (actual.length !== candidate.length || !timingSafeEqual(actual, candidate)) {
    otpModel.updateChallenge(challenge.id, { attempts: challenge.attempts + 1 });
    throw createError(400, "Invalid verification code");
  }

  let connectUserId = challenge.connectUserId;
  if (!connectUserId) {
    connectUserId = (await findOrCreateConnectUserByEmail(db, challenge.email)).id;
  }

  otpModel.updateChallenge(challenge.id, {
    status: "verified",
    verifiedAt: new Date().toISOString(),
    connectUserId,
  });
  new ConnectAppUserModel(db).linkUser(
    challenge.connectAppId,
    challenge.externalUserId,
    connectUserId,
  );

  const result: OtpVerifyResult = {
    connect_user_id: connectUserId,
    external_user_id: challenge.externalUserId,
    email: challenge.email,
  };

  if (challenge.connectSessionId) {
    const sessionModel = new ConnectSessionModel(db);
    let session = sessionModel.findById(challenge.connectSessionId);
    if (session && session.status === "pending" && session.mode === "authenticate") {
      session = attachSessionConnectUser(db, session, connectUserId);
      completeSession(db, session);
      result.session_id = session.id;
      result.code = await issueConnectCode({ session, connectUserId });
    }
  }

  return result;
}

export interface UpsertConnectionInput {
  connectUserId: string;
  provider: string;
  scopes: string[];
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  identityId: string;
  accountLabel?: string | null;
  workspaceId?: string | null;
}

export function upsertConnection(db: Db, input: UpsertConnectionInput): string {
  const connectionModel = new ConnectConnectionModel(db);
  const tokenExpiresAt = input.expiresIn
    ? new Date(Date.now() + Number(input.expiresIn) * 1000).toISOString()
    : null;

  const existing = connectionModel.findByUserProvider(input.connectUserId, input.provider);
  if (existing) {
    connectionModel.updateConnection(existing.id, {
      status: "active",
      scopes: input.scopes,
      accessTokenEnc: encryptConnectSecret(input.accessToken, config.jwtSecret),
      refreshTokenEnc: input.refreshToken
        ? encryptConnectSecret(input.refreshToken, config.jwtSecret)
        : null,
      tokenExpiresAt,
      providerAccountLabel: input.accountLabel ?? null,
      identityId: input.identityId,
      revokedAt: null,
      workspaceId: input.workspaceId ?? existing.workspaceId,
    });
    return existing.id;
  }

  const connection = connectionModel.create({
    connectUserId: input.connectUserId,
    provider: input.provider,
    status: "active",
    scopes: input.scopes,
    accessTokenEnc: encryptConnectSecret(input.accessToken, config.jwtSecret),
    refreshTokenEnc: input.refreshToken
      ? encryptConnectSecret(input.refreshToken, config.jwtSecret)
      : null,
    tokenExpiresAt,
    providerAccountLabel: input.accountLabel ?? null,
    identityId: input.identityId,
    workspaceId: input.workspaceId ?? null,
  });
  return connection.id;
}

export function completeSession(db: Db, session: ConnectSessionRow): void {
  new ConnectSessionModel(db).complete(session.id, session.connectUserId!);
}

export interface AttachIdentityInput {
  connectUserId: string;
  provider: string;
  providerSubject: string;
  email?: string | null;
  emailVerified: boolean;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export function attachProviderIdentity(db: Db, input: AttachIdentityInput) {
  const identityModel = new ConnectIdentityModel(db);
  const existing = identityModel.findByProviderSubject(input.provider, input.providerSubject);
  if (existing) {
    if (existing.connectUserId !== input.connectUserId) {
      throw createError(400, "provider account is linked to another user");
    }
    return existing;
  }
  return identityModel.create({
    connectUserId: input.connectUserId,
    provider: input.provider,
    providerSubject: input.providerSubject,
    email: input.email ?? null,
    emailVerified: input.emailVerified,
    displayName: input.displayName ?? null,
    avatarUrl: input.avatarUrl ?? null,
  });
}

export interface ConnectSessionCreateInput {
  mode: string;
  redirectUri: string;
  externalUserId: string;
  connectUserId?: string | null;
  provider?: string | null;
  scopes?: string[];
  email?: string | null;
}

export async function createConnectSession(
  db: Db,
  input: ConnectSessionCreateInput,
  developerUserId: string,
  publicBaseUrl: string,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  const modeValue = input.mode.trim().toLowerCase();
  if (!VALID_SESSION_MODES.has(modeValue)) {
    throw createError(400, "invalid connect session mode");
  }
  const mode = modeValue as ConnectSessionMode;

  const app = ensureWorkspaceApp(db, workspaceId, developerUserId);
  if (app.status !== "active") {
    throw createError(403, "Connect is disabled for this workspace");
  }

  // No per-app allowlist anymore (the app is auto-provisioned config).
  // Require https (or localhost for dev) so codes can't leak to plain http.
  const redirectUri = input.redirectUri.trim();
  const lowered = redirectUri.toLowerCase();
  if (
    !lowered.startsWith("https://") &&
    !lowered.startsWith("http://localhost") &&
    !lowered.startsWith("http://127.0.0.1")
  ) {
    throw createError(400, "redirect_uri must be https (or localhost)");
  }

  const externalUserId = input.externalUserId.trim();
  if (!externalUserId) throw createError(400, "external_user_id is required");

  const connectUserId = (input.connectUserId ?? "").trim() || null;
  let providerValue: string | null = null;
  let scopes: string[] = [];
  let challenge: OtpChallengeResult | null = null;

  if (mode === "authenticate") {
    if (connectUserId) {
      throw createError(400, "connect_user_id is not used for authenticate mode");
    }
    if (!input.email || !input.email.trim()) {
      throw createError(400, "email is required for authenticate mode");
    }
  } else {
    if (!connectUserId) throw createError(400, "connect_user_id is required");
    requireAuthenticatedAppUser(db, {
      connectAppId: app.id,
      externalUserId,
      connectUserId,
    });
    if (!input.provider || !input.provider.trim()) {
      throw createError(400, "provider is required for this session mode");
    }
    const provider = parseConnectProvider(input.provider);
    validateProviderAllowed(provider, app.allowedProviders);
    if (!OAUTH_ENABLED_PROVIDERS.has(provider)) {
      throw createError(501, `OAuth not enabled for provider ${provider}`);
    }
    providerValue = provider;
    scopes = normalizeRequestedScopes(provider, input.scopes ?? []);
    if (mode === "connect" && scopes.length === 0) {
      throw createError(400, "at least one scope is required for connect mode");
    }
  }

  const session = new ConnectSessionModel(db).create({
    connectAppId: app.id,
    externalUserId,
    mode,
    provider: providerValue,
    scopes,
    redirectUri,
    state: randomBytes(32).toString("base64url"),
    connectUserId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MINUTES * 60_1000).toISOString(),
    workspaceId,
  });

  let authorizeUrl: string | null = null;
  if (mode === "authenticate") {
    challenge = await issueOtpChallenge(db, {
      connectAppId: app.id,
      externalUserId,
      email: input.email ?? "",
      connectSessionId: session.id,
    });
  } else {
    authorizeUrl = `${publicBaseUrl.replace(/\/+$/, "")}/connect/authorize?state=${session.state}`;
  }

  recordAuditEvent(db, {
    eventType: "connect.session.created",
    actorType: "app",
    actorId: app.id,
    connectAppId: app.id,
    resourceType: "connect_session",
    resourceId: session.id,
    workspaceId,
    metadata: {
      mode,
      provider: providerValue,
      external_user_id: session.externalUserId,
      connect_user_id: connectUserId,
    },
  });

  return serializeSession(session, {
    authorizeUrl,
    challengeId: challenge ? challenge.challenge_id : null,
    challengeExpiresAt: challenge ? challenge.expires_at : null,
  });
}

export function listWorkspaceConnections(
  db: Db,
  workspaceId: string,
  filter: { provider?: string | null; status?: string | null; page?: number; limit?: number } = {},
): { items: Record<string, unknown>[]; total: number; page: number; limit: number } {
  const page = filter.page ?? 1;
  const limit = filter.limit ?? 50;
  const connectionModel = new ConnectConnectionModel(db);
  const userModel = new ConnectUserModel(db);
  const connections = connectionModel.listByWorkspace(workspaceId, {
    provider: filter.provider,
    status: filter.status,
    limit,
    offset: (page - 1) * limit,
  });
  const total = connectionModel.countByWorkspace(workspaceId, {
    provider: filter.provider,
    status: filter.status,
  });
  const labels = new Map<string, string>();
  for (const connection of connections) {
    if (!labels.has(connection.connectUserId)) {
      const user = userModel.findById(connection.connectUserId);
      if (user?.primaryEmail) labels.set(connection.connectUserId, user.primaryEmail);
    }
  }
  const items = connections.map((connection) => ({
    id: connection.id,
    connect_user_id: connection.connectUserId,
    user:
      labels.get(connection.connectUserId) ??
      connection.providerAccountLabel ??
      connection.connectUserId.slice(0, 8),
    provider: connection.provider,
    account: connection.providerAccountLabel,
    scopes: connection.scopes,
    status: connection.status,
    created_at: connection.createdAt,
  }));
  return { items, total, page, limit };
}
