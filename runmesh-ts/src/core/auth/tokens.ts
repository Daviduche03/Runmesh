import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";

const ALGORITHM = "HS256";

export const SESSION_TOKEN_TTL_SECONDS = 24 * 60 * 60;
export const CLI_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const AUTH_CODE_TTL_SECONDS = 120;
export const OAUTH_STATE_TTL_SECONDS = 600;

export interface TokenClaims {
  sub?: string;
  type?: string;
  nonce?: string;
  redirect_to?: string;
  [claim: string]: unknown;
}

const key = new TextEncoder().encode(config.jwtSecret);

export async function signToken(
  claims: TokenClaims,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT(claims as Record<string, unknown>)
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(key);
}

export async function verifyToken<T extends TokenClaims = TokenClaims>(
  token: string,
): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: [ALGORITHM] });
    return payload as T;
  } catch {
    return null;
  }
}

/** Only in-app relative paths may be used as post-login redirects (prevents open redirects). */
export function sanitizeRedirect(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "";
  for (const ch of trimmed) {
    if (ch.charCodeAt(0) < 32) return "";
  }
  return trimmed;
}

export async function createOAuthState(redirectTo = ""): Promise<string> {
  return signToken(
    {
      type: "oauth_state",
      nonce: crypto.randomUUID(),
      redirect_to: sanitizeRedirect(redirectTo),
    },
    OAUTH_STATE_TTL_SECONDS,
  );
}

export async function readOAuthState(state: string | null | undefined): Promise<TokenClaims | null> {
  if (!state) return null;
  const claims = await verifyToken(state);
  if (!claims || claims.type !== "oauth_state") return null;
  claims.redirect_to = sanitizeRedirect(claims.redirect_to);
  return claims;
}
