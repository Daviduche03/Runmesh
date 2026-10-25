import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { applyMigrations } from "../../src/core/runtime/migrate.js";

const DB = "/tmp/opencode/test-migrate.db";

function removeDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(DB + suffix)) rmSync(DB + suffix);
  }
}

describe("migrations", () => {
  beforeEach(removeDb);
  afterEach(removeDb);

  test("bootstraps a blank database from schema.sql and applies the tail", () => {
    const applied = applyMigrations(DB);
    expect(applied).toContain("0043_triggers.sql");
    expect(applied).toContain("0044_queue_messages.sql");
  });

  test("is idempotent — a second run applies nothing", () => {
    applyMigrations(DB);
    const second = applyMigrations(DB);
    expect(second).toEqual([]);
  });

  test("records every migration in d1_migrations", async () => {
    applyMigrations(DB);
    const { Database } = await import("bun:sqlite");
    const db = new Database(DB);
    const rows = db.query("SELECT name FROM d1_migrations").all() as Array<{ name: string }>;
    expect(rows.length).toBe(43);
    db.close();
  });
});
