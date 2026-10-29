import { and, eq } from "drizzle-orm";
import createError from "http-errors";
import { randomBytes, randomInt } from "node:crypto";
import type { Request } from "express";
import { CLI_TOKEN_TTL_SECONDS, SESSION_TOKEN_TTL_SECONDS, AUTH_CODE_TTL_SECONDS, signToken, verifyToken } from "../../core/auth/tokens.js";
import { config } from "../../core/config.js";
import type { Db } from "../../core/db/client.js";
import { UserModel } from "../../core/db/orm.js";
import { cliAuthCodes } from "../../core/db/schema.js";

export interface GithubUser {
  id: number | string;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
}

export function requestBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

export function githubCallbackRedirectUri(req: Request): string {
  const base = (config.publicUrl || requestBaseUrl(req)).replace(/\/+$/, "");
  return `${base}/auth/github/callback`;
}

export function frontendUrl(req: Request): string {
  return (config.frontendUrl || requestBaseUrl(req)).replace(/\/+$/, "");
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.github.clientId,
      client_secret: config.github.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const payload = (await readJson(response)) as
    | { access_token?: string; error?: string; error_description?: string }
    | null;

  const accessToken = payload?.access_token;
  if (!accessToken) {
    throw createError(
      400,
      `GitHub token exchange failed: ${payload?.error_description ?? payload?.error ?? "unknown"}`,
    );
  }
  return accessToken;
}

export async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "Runmesh",
    },
    signal: AbortSignal.timeout(15_000),
  });

  const data = await readJson(response);
  if (!data || typeof data !== "object" || !("id" in data)) {
    throw createError(400, "Failed to fetch GitHub user info");
  }
  return data as GithubUser;
}

/**
 * Return a verified GitHub email, or "" when there is none.
 *
 * Only verified emails may be used for account matching/linking — an unverified email would
 * let an attacker point their GitHub login at someone else's account.
 */
export async function fetchPrimaryEmail(accessToken: string): Promise<string> {
  const response = await fetch("https://api.github.com/user/emails", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "Runmesh",
    },
    signal: AbortSignal.timeout(15_000),
  });

  const emails = await readJson(response);
  if (!Array.isArray(emails)) return "";

  const verified = emails.filter(
    (entry): entry is { email?: string; primary?: boolean; verified?: boolean } =>
      Boolean(entry) && typeof entry === "object",
  );

  const primary = verified.find((entry) => entry.primary && entry.verified && entry.email);
  if (primary?.email) return primary.email;

  const anyVerified = verified.find((entry) => entry.verified && entry.email);
  return anyVerified?.email ?? "";
}

export function findOrCreateUser(
  db: Db,
  input: {
    githubId: string;
    name: string;
    avatarUrl: string;
    githubEmail: string;
    login: string;
  },
): string {
  const model = new UserModel(db);
  const existing = model.findByGithubId(input.githubId);

  if (existing) {
    model.update(existing.id, { name: input.name, avatarUrl: input.avatarUrl });
    return existing.id;
  }

  const email =
    input.githubEmail || `${input.githubId}+${input.login}@users.noreply.github.com`;

  const byEmail = model.findByEmail(email);
  if (byEmail) {
    model.update(byEmail.id, {
      name: input.name,
      avatarUrl: input.avatarUrl,
      githubId: input.githubId,
    });
    return byEmail.id;
  }

  return model.create({
    name: input.name,
    email,
    password: "github_oauth:no_password",
    githubId: input.githubId,
    avatarUrl: input.avatarUrl,
  });
}

export function authCodeFor(userId: string): Promise<string> {
  return signToken({ type: "auth_code", sub: userId }, AUTH_CODE_TTL_SECONDS);
}

// ---------------------------------------------------------------------------
// CLI device-code flow
// ---------------------------------------------------------------------------

const USER_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CLI_CODE_TTL_SECONDS = 600;

function newUserCode(): string {
  let raw = "";
  for (let i = 0; i < 8; i += 1) raw += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function startCliAuth(db: Db, baseUrl: string): Record<string, unknown> {
  const deviceCode = randomBytes(32).toString("base64url");
  const userCode = newUserCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CLI_CODE_TTL_SECONDS * 1000);

  db.insert(cliAuthCodes)
    .values({
      id: crypto.randomUUID(),
      deviceCode,
      userCode,
      status: "pending",
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
    })
    .run();

  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${baseUrl}/cli/verify?code=${encodeURIComponent(userCode)}`,
    expires_in: CLI_CODE_TTL_SECONDS,
  };
}

export function confirmCliAuth(db: Db, userId: string, userCode: string): void {
  const row = db
    .select()
    .from(cliAuthCodes)
    .where(and(eq(cliAuthCodes.userCode, userCode), eq(cliAuthCodes.status, "pending")))
    .limit(1)
    .get();

  if (!row) throw createError(404, "Invalid or expired code");
  if (new Date(row.expiresAt).getTime() <= Date.now()) throw createError(400, "Code expired");

  db.update(cliAuthCodes)
    .set({ status: "confirmed", userId, confirmedAt: new Date().toISOString() })
    .where(eq(cliAuthCodes.userCode, userCode))
    .run();
}

export async function pollCliAuth(
  db: Db,
  deviceCode: string,
): Promise<Record<string, unknown>> {
  const row = db
    .select()
    .from(cliAuthCodes)
    .where(eq(cliAuthCodes.deviceCode, deviceCode))
    .limit(1)
    .get();

  if (!row) throw createError(404, "Invalid device code");

  if (row.status === "pending") {
    if (new Date(row.expiresAt).getTime() <= Date.now()) return { status: "expired" };
    return { status: "pending" };
  }

  if (row.status === "confirmed") {
    const user = row.userId ? new UserModel(db).findById(row.userId) : null;
    if (!user) throw createError(404, "User not found");

    // `id` mirrors `sub`: the dashboard decodes the session payload directly,
    // so the claim set is part of the contract with frontend/src/lib/stores/auth-store.ts.
    const token = await signToken(
      { sub: user.id, id: user.id, email: user.email, name: user.name },
      CLI_TOKEN_TTL_SECONDS,
    );
    db.delete(cliAuthCodes).where(eq(cliAuthCodes.deviceCode, deviceCode)).run();

    return {
      status: "confirmed",
      token,
      user: { id: user.id, email: user.email, name: user.name },
    };
  }

  throw createError(400, "Invalid state");
}

export async function exchangeAuthCode(
  db: Db,
  code: string,
): Promise<Record<string, unknown>> {
  const payload = await verifyToken(code);
  if (!payload || payload.type !== "auth_code") {
    throw createError(401, "Invalid or expired auth code");
  }

  const userId = String(payload.sub ?? payload.id ?? "");
  const user = userId ? new UserModel(db).findById(userId) : null;
  if (!user) throw createError(401, "User not found");

  const token = await signToken(
    { sub: user.id, id: user.id, email: user.email, name: user.name },
    SESSION_TOKEN_TTL_SECONDS,
  );

  return {
    token,
    user: { id: user.id, email: user.email, name: user.name },
  };
}
