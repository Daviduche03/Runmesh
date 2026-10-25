/**
 * Provider registry and account helpers for Connect: the OAuth provider enum, scope
 * alias tables (canonical label ↔ provider remote value), and the email/OTP primitives
 * the session flow builds on.
 */
import createError from "http-errors";
import { randomInt } from "node:crypto";

export type ConnectProviderId = "google" | "slack" | "meta" | "intercom";
export type ConnectSessionMode = "authenticate" | "connect" | "grant";

export const CONNECT_PROVIDERS: ConnectProviderId[] = ["google", "slack", "meta", "intercom"];

/** Canonical scope label → provider remote value (Google uses URLs, others plain labels). */
export const CONNECT_PROVIDER_SCOPES: Record<ConnectProviderId, Record<string, string>> = {
  google: {
    "gmail.readonly": "https://www.googleapis.com/auth/gmail.readonly",
    "gmail.send": "https://www.googleapis.com/auth/gmail.send",
    "gmail.modify": "https://www.googleapis.com/auth/gmail.modify",
    "gmail.compose": "https://www.googleapis.com/auth/gmail.compose",
    "gmail.labels": "https://www.googleapis.com/auth/gmail.labels",
    "youtube.readonly": "https://www.googleapis.com/auth/youtube.readonly",
    "youtube.upload": "https://www.googleapis.com/auth/youtube.upload",
    "drive.readonly": "https://www.googleapis.com/auth/drive.readonly",
    "drive.file": "https://www.googleapis.com/auth/drive.file",
    "drive.metadata.readonly": "https://www.googleapis.com/auth/drive.metadata.readonly",
  },
  slack: {
    "channels:read": "channels:read",
    "channels:history": "channels:history",
    "chat:write": "chat:write",
    "users:read": "users:read",
    "users:read.email": "users:read.email",
  },
  meta: {
    pages_show_list: "pages_show_list",
    pages_read_engagement: "pages_read_engagement",
    pages_manage_posts: "pages_manage_posts",
    instagram_basic: "instagram_basic",
    instagram_content_publish: "instagram_content_publish",
  },
  intercom: {
    "users.read": "Read and list users and companies",
    "users.write": "Read and write users",
    "companies.write": "Write users and companies",
    "conversations.read": "Read conversations",
    "conversations.write": "Write conversations",
    "conversations.delete": "Delete conversations and metrics",
    "tags.read": "Read tags",
    "tags.write": "Write tags",
    "events.read": "Read events",
    "events.write": "Write events",
    "articles.read": "Read and List articles",
    "articles.write": "Read and Write Articles",
    "ai_content.write": "Read and write AI content",
    "admins.read": "Read admins",
  },
};

export const OAUTH_ENABLED_PROVIDERS: ReadonlySet<ConnectProviderId> = new Set(["google"]);

export function parseConnectProvider(value: string | null | undefined): ConnectProviderId {
  if (!value || !value.trim()) throw createError(400, "provider is required");
  const normalized = value.trim().toLowerCase();
  if ((CONNECT_PROVIDERS as string[]).includes(normalized)) {
    return normalized as ConnectProviderId;
  }
  throw createError(400, `unsupported provider; allowed: ${CONNECT_PROVIDERS.join(", ")}`);
}

export function providerScopeAliases(provider: ConnectProviderId): Record<string, string> {
  return CONNECT_PROVIDER_SCOPES[provider] ?? {};
}

export function validateProviderAllowed(provider: ConnectProviderId, allowedProviders: string[]): void {
  if (!allowedProviders || allowedProviders.length === 0) return;
  const allowed = new Set(allowedProviders.map((item) => item.trim().toLowerCase()).filter(Boolean));
  if (!allowed.has(provider)) {
    throw createError(400, "provider is not allowed for this app");
  }
}

/** Accept canonical labels or remote values; dedupe while preserving order. */
export function normalizeRequestedScopes(provider: ConnectProviderId, scopes: string[]): string[] {
  const aliases = providerScopeAliases(provider);
  if (Object.keys(aliases).length === 0) {
    throw createError(400, `no scopes configured for provider ${provider}`);
  }
  const cleaned: string[] = [];
  for (const scope of scopes) {
    const value = scope.trim();
    if (!value) continue;
    if (value in aliases) {
      cleaned.push(value);
      continue;
    }
    const match = Object.entries(aliases).find(([, remote]) => remote === value);
    if (match) {
      cleaned.push(match[0]);
      continue;
    }
    throw createError(400, `unknown scope '${value}' for provider ${provider}`);
  }
  return [...new Set(cleaned)];
}

/** Canonical labels → provider remote values for the authorize redirect. */
export function resolveOauthScopes(
  provider: ConnectProviderId,
  mode: ConnectSessionMode,
  requestedScopes: string[],
): string[] {
  if (!OAUTH_ENABLED_PROVIDERS.has(provider)) {
    throw createError(501, `OAuth not enabled for provider ${provider}`);
  }
  if (provider === "google") {
    const aliases = providerScopeAliases(provider);
    const resolved = requestedScopes.map((scope) => aliases[scope]);
    if (resolved.length === 0 || resolved.some((scope) => scope === undefined)) {
      throw createError(400, "at least one scope is required");
    }
    return [...new Set(resolved as string[])];
  }
  throw createError(501, `OAuth scope resolution not implemented for provider ${provider}`);
}

export function oauthNeedsOfflineAccess(
  provider: ConnectProviderId,
  mode: ConnectSessionMode,
): boolean {
  return mode === "connect" && provider === "google";
}

export function listProvidersCatalog(): Array<{
  id: ConnectProviderId;
  scopes: string[];
  oauth_enabled: boolean;
}> {
  return CONNECT_PROVIDERS.map((id) => ({
    id,
    scopes: Object.keys(providerScopeAliases(id)).sort(),
    oauth_enabled: OAUTH_ENABLED_PROVIDERS.has(id),
  }));
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(normalizeEmail(email));
}

export const OTP_TTL_MINUTES = 10;
export const OTP_LENGTH = 6;
export const OTP_MAX_ATTEMPTS = 5;

export function generateOtpCode(): string {
  return Array.from({ length: OTP_LENGTH }, () => String(randomInt(0, 10))).join("");
}

export function otpExpiresAt(): string {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString();
}
