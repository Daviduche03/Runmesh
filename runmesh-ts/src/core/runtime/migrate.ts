/**
 * Migration runner.
 *
 * A blank database is bootstrapped from `schema.sql` (a snapshot that already contains
 * migrations 0001-0042) and every migration inside the snapshot range is marked applied.
 * Replaying them instead would fail on table-rebuild migrations that select from `_new`
 * tables which only exist mid-rebuild. Afterwards, each remaining `migrations/*.sql` file is
 * applied in filename order and recorded in `d1_migrations`.
 */
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { log } from "../log.js";

const TRACKING_TABLE = `
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  applied_at TEXT NOT NULL
)`;

const SNAPSHOT_RANGE = /applied migrations \((\d{4})-(\d{4})\)/;
const MARKER_TABLE = "agent_versions";
const IDEMPOTENT_ERRORS = ["duplicate column name", "already exists"];

export function migrationsDir(): string {
  if (config.migrationsDir) return path.resolve(config.migrationsDir);
  return path.resolve(import.meta.dirname, "../../../migrations");
}

function schemaPath(dir: string): string {
  return path.join(path.dirname(dir), "schema.sql");
}

function snapshotRange(schemaSql: string): [number, number] {
  const match = SNAPSHOT_RANGE.exec(schemaSql);
  if (!match) {
    throw new Error(
      "schema.sql does not declare 'applied migrations (NNNN-NNNN)'; regenerate the snapshot " +
        "or fix its header so bootstrap can tell which migrations it already contains",
    );
  }
  return [Number(match[1]), Number(match[2])];
}

function migrationNumber(fileName: string): number {
  const match = /^(\d+)_/.exec(fileName);
  return match ? Number(match[1]) : 0;
}

function tableExists(db: Database, name: string): boolean {
  return db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== null;
}

export function applyMigrations(dbPath: string, dirOverride?: string): string[] {
  const dir = dirOverride ? path.resolve(dirOverride) : migrationsDir();
  if (!existsSync(dir)) throw new Error(`migrations directory not found: ${dir}`);

  const snapshotFile = schemaPath(dir);
  if (!existsSync(snapshotFile)) throw new Error(`schema.sql not found: ${snapshotFile}`);
  const snapshot = readFileSync(snapshotFile, "utf8");

  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  const applied: string[] = [];

  try {
    db.exec(TRACKING_TABLE);

    const seen = new Set(
      (db.query("SELECT name FROM d1_migrations").all() as Array<{ name: string }>).map((r) => r.name),
    );

    if (!tableExists(db, "tasks")) {
      db.exec(snapshot);
      log("info", "base_schema_loaded", { source: "schema.sql" });
    }

    if (seen.size === 0 && tableExists(db, MARKER_TABLE)) {
      const [, snapshotMax] = snapshotRange(snapshot);
      const record = db.prepare("INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)");
      for (const name of files) {
        if (migrationNumber(name) <= snapshotMax && !seen.has(name)) {
          record.run(name, new Date().toISOString());
          seen.add(name);
        }
      }
      log("info", "bootstrap_skipped_past_snapshot", { through: snapshotMax });
    }

    const record = db.prepare("INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)");
    for (const name of files) {
      if (seen.has(name)) continue;
      const script = readFileSync(path.join(dir, name), "utf8");
      try {
        db.exec(script);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!IDEMPOTENT_ERRORS.some((token) => message.includes(token))) throw err;
        log("warn", "migration_partially_present", { migration: name, error: message });
      }
      record.run(name, new Date().toISOString());
      applied.push(name);
    }
  } finally {
    db.close();
  }

  if (applied.length > 0) {
    log("info", "migrations_applied", { count: applied.length, migrations: applied });
  }
  return applied;
}
