/**
 * Drift guard: `schema.ts` must describe the database that `schema.sql` + every migration
 * produces. The SQL files stay authoritative; this test fails when the TypeScript mirror
 * falls behind (a column added by a migration and not mirrored here).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { existsSync, rmSync } from "node:fs";
import * as schema from "../../src/core/db/schema.js";
import { applyMigrations } from "../../src/core/runtime/migrate.js";

const DB = "/tmp/opencode/test-drift.db";

interface PragmaColumn {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

const tables = (Object.values(schema) as unknown[]).filter((value) =>
  is(value, SQLiteTable),
) as SQLiteTable[];

let db: Database;

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(DB + suffix)) rmSync(DB + suffix);
  }
  applyMigrations(DB);
  db = new Database(DB);
});

afterAll(() => {
  db?.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(DB + suffix)) rmSync(DB + suffix);
  }
});

function pragma(tableName: string): PragmaColumn[] {
  return db.query(`PRAGMA table_info(${tableName})`).all() as PragmaColumn[];
}

describe("schema mirror", () => {
  test("the mirror is not empty", () => {
    expect(tables.length).toBeGreaterThan(30);
  });

  test("every mirrored table exists in the migrated database", () => {
    const missing = tables
      .map((table) => getTableConfig(table).name)
      .filter((name) => pragma(name).length === 0);
    expect(missing).toEqual([]);
  });

  test("every table in the database is mirrored", () => {
    const internal = new Set(["sqlite_sequence", "sqlite_stat1", "d1_migrations"]);
    const mirrored = new Set(tables.map((table) => getTableConfig(table).name));
    const actual = (
      db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    )
      .map((row) => row.name)
      .filter((name) => !name.startsWith("sqlite_") && !internal.has(name));
    expect(actual.filter((name) => !mirrored.has(name))).toEqual([]);
  });

  test("column names, types, nullability and primary keys match", () => {
    const problems: string[] = [];

    for (const table of tables) {
      const config = getTableConfig(table);
      const actual = pragma(config.name);
      const actualByName = new Map(actual.map((column) => [column.name, column]));

      // Composite keys live in `primaryKeys`, single-column keys on the column itself.
      const compositePk = new Map<string, number>();
      for (const key of config.primaryKeys) {
        key.columns.forEach((column, index) => compositePk.set(column.name, index + 1));
      }

      if (actual.length !== config.columns.length) {
        problems.push(
          `${config.name}: ${config.columns.length} mirrored columns vs ${actual.length} in DB`,
        );
      }

      for (const column of config.columns) {
        const dbColumn = actualByName.get(column.name);
        if (!dbColumn) {
          problems.push(`${config.name}.${column.name}: missing in DB`);
          continue;
        }

        const expectedType = column.getSQLType().toUpperCase();
        if (dbColumn.type.toUpperCase() !== expectedType) {
          problems.push(
            `${config.name}.${column.name}: type ${dbColumn.type} in DB, ${expectedType} mirrored`,
          );
        }

        const expectedNotNull = column.notNull ? 1 : 0;
        if (dbColumn.notnull !== expectedNotNull && !column.primary) {
          problems.push(
            `${config.name}.${column.name}: notnull ${dbColumn.notnull} in DB, ${expectedNotNull} mirrored`,
          );
        }

        const expectedPk = compositePk.get(column.name) ?? (column.primary ? 1 : 0);
        if (dbColumn.pk !== expectedPk) {
          problems.push(
            `${config.name}.${column.name}: pk ${dbColumn.pk} in DB, ${expectedPk} mirrored`,
          );
        }

        const mirroredDefault = column.default !== undefined;
        if (mirroredDefault !== (dbColumn.dflt_value !== null)) {
          problems.push(
            `${config.name}.${column.name}: default ${dbColumn.dflt_value ?? "none"} in DB, ${
              mirroredDefault ? "mirrored" : "not mirrored"
            }`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
