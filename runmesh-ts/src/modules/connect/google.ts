/**
 * Google provider calls for Connect: authorize URL, code exchange, and account lookup.
 *
 * Only this provider has OAuth wired up; the provider table in `providers.ts` lists the
 * others as catalog entries until their flows land.
 */
import { config } from "../../core/config.js";
import type { FetchLike } from "../webhooks/index.js";
import { resolveOauthScopes } from "./providers.js";
import type { ConnectSessionMode } from "./providers.js";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

const fetchImplDefault: FetchLike = (url, init) => fetch(url, init);

export function connectCallbackUri(publicBaseUrl: string): string {
  return `${publicBaseUrl.replace(/\/+$/, "")}/connect/callback`;
}

export function buildGoogleAuthorizeUrl(
  publicBaseUrl: string,
  sessionState: string,
  mode: ConnectSessionMode,
  requestedScopes: string[],
): string {
  const googleScopes = resolveOauthScopes("google", mode, requestedScopes);
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: connectCallbackUri(publicBaseUrl),
    response_type: "code",
    scope: googleScopes.join(" "),
    state: sessionState,
    include_granted_scopes: "true",
  });
  if (mode === "connect") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface GoogleTokenData {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  [key: string]: unknown;
}

export async function exchangeGoogleCode(
  code: string,
  publicBaseUrl: string,
  fetchImpl: FetchLike = fetchImplDefault,
): Promise<GoogleTokenData> {
  const body = new URLSearchParams({
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: connectCallbackUri(publicBaseUrl),
    grant_type: "authorization_code",
  });
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data || typeof data.access_token !== "string") {
    const detail =
      (data && typeof data.error_description === "string" && data.error_description) ||
      (data && typeof data.error === "string" && data.error) ||
      "unknown";
    throw new Error(`Google token exchange failed: ${detail}`);
  }
  return data as GoogleTokenData;
}

export interface GoogleProviderAccount {
  sub: string;
  email?: string;
  email_verified?: boolean;
}

export async function fetchGoogleProviderAccount(
  accessToken: string,
  fetchImpl: FetchLike = fetchImplDefault,
): Promise<GoogleProviderAccount> {
  const response = await fetchImpl(
    `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data) throw new Error("Failed to parse Google token info");
  if (response.status !== 200) {
    const detail =
      (typeof data.error_description === "string" && data.error_description) ||
      (typeof data.error === "string" && data.error) ||
      "invalid_token";
    throw new Error(`Google token info failed: ${detail}`);
  }
  const subject = String(data.user_id ?? "").trim();
  if (!subject) throw new Error("Google token info is missing user_id");
  return {
    sub: subject,
    email: typeof data.email === "string" ? data.email : undefined,
    email_verified: Boolean(data.verified_email),
  };
}

export async function fetchGoogleUserinfo(
  accessToken: string,
  fetchImpl: FetchLike = fetchImplDefault,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data) throw new Error("Failed to fetch Google user info");
  return data;
}
