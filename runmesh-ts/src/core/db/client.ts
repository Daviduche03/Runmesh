import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { sql } from "drizzle-orm";

/**
 * `LIMIT -1` means "no upper bound" in SQLite. Drizzle omits the LIMIT clause entirely when
 * `.limit()` is not called, and SQLite rejects a bare `OFFSET` — so pagination that skips
 * rows without capping them must be written `.offset(n).limit(UNLIMITED)`.
 */
export const UNLIMITED = sql.raw("-1");

export type Db = BunSQLiteDatabase<Record<string, never>>;

export interface DbHandle {
  sqlite: Database;
  db: Db;
  close: () => void;
}

/**
 * Drizzle types `.run()` as `void` for the synchronous SQLite driver even though it returns
 * `{ changes, lastInsertRowid }` (verified at runtime). This is the single place that relies
 * on the runtime shape.
 */
export function changedRows(result: unknown): number {
  return (result as { changes?: number } | undefined)?.changes ?? 0;
}

export function now(): string {
  return new Date().toISOString();
}

export function createDb(path: string): DbHandle {
  const sqlite = new Database(path, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA busy_timeout = 30000");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA synchronous = NORMAL");
  const db = drizzle(sqlite);
  return {
    sqlite,
    db,
    close: () => sqlite.close(),
  };
}
