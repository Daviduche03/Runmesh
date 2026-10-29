import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { createDb } from "../../src/core/db/client.js";
import type { DbHandle } from "../../src/core/db/client.js";
import { checkRateLimit, getClientIp } from "../../src/core/rate-limit.js";
import { applyMigrations } from "../../src/core/runtime/migrate.js";

const DB = "/tmp/opencode/test-rate-limit.db";
let handle: DbHandle;

function removeDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(DB + suffix)) rmSync(DB + suffix);
  }
}

describe("rate limiting", () => {
  beforeEach(() => {
    removeDb();
    applyMigrations(DB);
    handle = createDb(DB);
  });

  afterEach(() => {
    handle.close();
    removeDb();
  });

  test("allows up to the limit, then denies", async () => {
    const key = "login:1.2.3.4";
    expect(await checkRateLimit(handle.db, key, 2, 60)).toBe(true);
    expect(await checkRateLimit(handle.db, key, 2, 60)).toBe(true);
    expect(await checkRateLimit(handle.db, key, 2, 60)).toBe(false);
  });

  test("keys are independent", async () => {
    expect(await checkRateLimit(handle.db, "a", 1, 60)).toBe(true);
    expect(await checkRateLimit(handle.db, "b", 1, 60)).toBe(true);
    expect(await checkRateLimit(handle.db, "a", 1, 60)).toBe(false);
  });

  test("an expired window resets the counter", async () => {
    expect(await checkRateLimit(handle.db, "k", 1, 0)).toBe(true);
    // window of zero seconds is always expired, so the next hit starts fresh
    expect(await checkRateLimit(handle.db, "k", 1, 0)).toBe(true);
  });

  test("client ip prefers Cloudflare, then the first proxy hop", () => {
    expect(getClientIp({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" })).toBe("1.1.1.1");
    expect(getClientIp({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" })).toBe("2.2.2.2");
    expect(getClientIp({}, "127.0.0.1")).toBe("127.0.0.1");
    expect(getClientIp({})).toBe("unknown");
  });
});
