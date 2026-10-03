"""D1-compatible surface over SQLite.

The app only ever calls ``db.prepare(sql).bind(...).run()/.first()/.all()``, so
shaping the connection to that exact protocol means the 33 existing call sites
and all 42 migrations stay untouched.
"""

import asyncio
import json
import sqlite3
from datetime import date, datetime
from types import SimpleNamespace
from typing import Any

import aiosqlite


class Row(dict):
    def to_py(self) -> dict:
        return dict(self)

    def as_py(self) -> dict:
        return dict(self)


class QueryResult(list):
    @property
    def results(self) -> "QueryResult":
        return self


class RunResult:
    def __init__(self, changes: int):
        self.success = True
        self.changes = changes
        self.meta = SimpleNamespace(changes=changes, rows_written=changes)


def _bind(value: Any) -> Any:
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, default=str)
    return value


class Statement:
    def __init__(self, db: "Database", sql: str, params: tuple = ()):
        self._db = db
        self._sql = sql
        self._params = tuple(_bind(p) for p in params)

    def bind(self, *params: Any) -> "Statement":
        return Statement(self._db, self._sql, params)

    async def run(self) -> RunResult:
        changes = await self._db._write(self._sql, self._params)
        return RunResult(changes)

    async def first(self) -> Row | None:
        row = await self._db._one(self._sql, self._params)
        return Row(dict(row)) if row is not None else None

    async def all(self) -> QueryResult:
        rows = await self._db._all(self._sql, self._params)
        return QueryResult(Row(dict(r)) for r in rows)


class Database:
    """A small pooled wrapper; one connection per pool slot, each with its own
    thread, so concurrent requests do not serialize on a single writer."""

    def __init__(self, path: str, size: int = 4):
        self.path = path
        self._size = size
        self._pool: asyncio.Queue | None = None

    async def open(self) -> "Database":
        if self._pool is not None:
            return self
        pool: asyncio.Queue = asyncio.Queue()
        for _ in range(self._size):
            conn = await aiosqlite.connect(self.path, isolation_level=None, timeout=30.0)
            conn.row_factory = sqlite3.Row
            await self._prepare_connection(conn)
            await pool.put(conn)
        self._pool = pool
        return self

    @staticmethod
    async def _prepare_connection(conn) -> None:
        for pragma in (
            "PRAGMA journal_mode=WAL",
            "PRAGMA busy_timeout=30000",
            "PRAGMA foreign_keys=ON",
        ):
            cur = await conn.execute(pragma)
            await cur.fetchall()
            await cur.close()

    def prepare(self, sql: str) -> Statement:
        if self._pool is None:
            raise RuntimeError("database is not open; await Database.open() first")
        return Statement(self, sql)

    async def close(self) -> None:
        if self._pool is None:
            return
        while not self._pool.empty():
            conn = await self._pool.get()
            await conn.close()
        self._pool = None

    async def _borrow(self):
        return await self._pool.get()

    async def _lend(self, conn) -> None:
        await self._pool.put(conn)

    async def _all(self, sql: str, params: tuple):
        conn = await self._borrow()
        try:
            cur = await conn.execute(sql, params)
            try:
                rows = await cur.fetchall()
            finally:
                await cur.close()
            return rows
        finally:
            await self._lend(conn)

    async def _one(self, sql: str, params: tuple):
        conn = await self._borrow()
        try:
            cur = await conn.execute(sql, params)
            try:
                rows = await cur.fetchone()
            finally:
                await cur.close()
            return rows
        finally:
            await self._lend(conn)

    async def _write(self, sql: str, params: tuple) -> int:
        conn = await self._borrow()
        try:
            cur = await conn.execute(sql, params)
            try:
                changes = cur.rowcount
            finally:
                await cur.close()
            return changes if changes and changes > 0 else 0
        finally:
            await self._lend(conn)
