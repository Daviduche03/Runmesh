"""Applies `migrations/*.sql` to a SQLite file in filename order.

Bootstrap note: migration `0001` was never committed, so a blank database has
no `tasks` table. `schema.sql` is a generated snapshot of the schema *after*
migrations 0001-0042 (the header records that range), so on a blank database we
load it and mark every migration inside that range as already applied instead of
replaying them -- replaying would fail on table-rebuild migrations such as
`0012`, which select from `_new` tables that only exist mid-rebuild.
"""

import glob
import os
import re
import sqlite3
from datetime import datetime, timezone

import aiosqlite

from utils.log import log_info, log_warn

_TRACKING_TABLE = """
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  applied_at TEXT NOT NULL
)
"""

_SNAPSHOT_RANGE = re.compile(r"applied migrations \((\d{4})-(\d{4})\)")

_MARKER_TABLE = "agent_versions"

_IDEMPOTENT = ("duplicate column name", "already exists")


def migrations_dir() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(os.path.dirname(here)), "migrations")


def schema_path(migrations_dir_: str) -> str:
    return os.path.join(os.path.dirname(migrations_dir_), "schema.sql")


def _snapshot_range(schema_sql: str) -> tuple[int, int]:
    match = _SNAPSHOT_RANGE.search(schema_sql)
    if not match:
        raise RuntimeError(
            "schema.sql does not declare 'applied migrations (NNNN-NNNN)'; "
            "regenerate the snapshot or fix its header so bootstrap can tell "
            "which migrations it already contains"
        )
    return int(match.group(1)), int(match.group(2))


def _number(file_name: str) -> int:
    digits = re.match(r"^(\d+)_", file_name)
    return int(digits.group(1)) if digits else 0


async def _table_exists(conn, name: str) -> bool:
    cur = await conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    )
    row = await cur.fetchone()
    await cur.close()
    return row is not None


async def _record(conn, name: str) -> None:
    await conn.execute(
        "INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)",
        (name, datetime.now(timezone.utc).isoformat()),
    )


async def apply(path: str, migrations_dir_: str | None = None) -> list[str]:
    migrations_dir_ = migrations_dir_ or migrations_dir()
    files = sorted(glob.glob(os.path.join(migrations_dir_, "*.sql")))
    applied: list[str] = []

    async with aiosqlite.connect(path, isolation_level=None, timeout=30.0) as conn:
        await conn.execute(_TRACKING_TABLE)
        cur = await conn.execute("SELECT name FROM d1_migrations")
        seen = {row[0] for row in await cur.fetchall()}
        await cur.close()

        with open(schema_path(migrations_dir_), encoding="utf-8") as handle:
            snapshot = handle.read()

        if not await _table_exists(conn, "tasks"):
            await conn.executescript(snapshot)
            log_info("base_schema_loaded", source="schema.sql")

        if not seen and await _table_exists(conn, _MARKER_TABLE):
            _, snapshot_max = _snapshot_range(snapshot)
            for file_path in files:
                name = os.path.basename(file_path)
                if _number(name) <= snapshot_max and name not in seen:
                    await _record(conn, name)
                    seen.add(name)
            log_info("bootstrap_skipped_past_snapshot", through=snapshot_max)

        for file_path in files:
            name = os.path.basename(file_path)
            if name in seen:
                continue
            with open(file_path, encoding="utf-8") as handle:
                script = handle.read()
            try:
                await conn.executescript(script)
            except sqlite3.OperationalError as exc:
                if not any(token in str(exc) for token in _IDEMPOTENT):
                    raise
                log_warn("migration_partially_present", migration=name, error=str(exc))
            await _record(conn, name)
            applied.append(name)

    if applied:
        log_info("migrations_applied", count=len(applied), migrations=applied)
    return applied
