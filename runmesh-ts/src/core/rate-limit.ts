/**
 * Fixed-window rate limiting backed by the `rate_limits` table.
 * Fails open: a missing table or a query error must not take the API down.
 */
import { eq, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { rateLimits } from "./db/schema.js";
import { createError } from "./http/errors.js";
import { log } from "./log.js";

export async function checkRateLimit(
  db: Db,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const now = new Date();
  const nowIso = now.toISOString();
  const windowStart = new Date(now.getTime() - windowSeconds * 1000).toISOString();

  try {
    const row =
      db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1).get() ?? null;

    if (!row) {
      db.insert(rateLimits).values({ key, count: 1, windowStart: nowIso }).run();
      return true;
    }

    const started = new Date(row.windowStart);
    if (Number.isNaN(started.getTime()) || started.toISOString() <= windowStart) {
      db.update(rateLimits)
        .set({ count: 1, windowStart: nowIso })
        .where(eq(rateLimits.key, key))
        .run();
      return true;
    }

    if (row.count >= limit) return false;

    db.update(rateLimits)
      .set({ count: sql`${rateLimits.count} + 1` })
      .where(eq(rateLimits.key, key))
      .run();
    return true;
  } catch (err) {
    log("warn", "rate_limit_check_failed", { key, error: String(err) });
    return true;
  }
}

export async function enforceRateLimit(
  db: Db,
  key: string,
  limit: number,
  windowSeconds: number,
  detail = "Too many requests",
): Promise<void> {
  if (!(await checkRateLimit(db, key, limit, windowSeconds))) {
    throw createError(429, detail);
  }
}

type HeaderBag = Record<string, string | string[] | undefined>;

function header(headers: HeaderBag, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Client IP: Cloudflare header first, then the first proxy hop, then the socket address. */
export function getClientIp(headers: HeaderBag, socketAddress?: string): string {
  const cloudflare = header(headers, "cf-connecting-ip");
  if (cloudflare) return cloudflare.trim();
  const forwarded = header(headers, "x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return socketAddress ?? "unknown";
}
