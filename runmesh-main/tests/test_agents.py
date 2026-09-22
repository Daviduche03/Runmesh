"""
Agent identity tests — create/list service layer (workspace-scoped).
Run: uv run --no-sync python tests/test_agents.py
"""
import asyncio
import hashlib
import sqlite3
import sys
import os
import types

for mod in ["js", "_cloudflare_compat_flags"]:
    if mod not in sys.modules:
        sys.modules[mod] = types.ModuleType(mod)
if "workers" not in sys.modules:
    w = types.ModuleType("workers")

    async def _fake_fetch(*a, **kw):
        class R:
            status = 200

            async def json():
                return {}

            async def text():
                return "{}"

        return R()

    w.fetch = _fake_fetch
    sys.modules["workers"] = w

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))


class FakeResult:
    def __init__(self, rows=None, first=None, meta=None):
        self.results = rows or []
        self._first = first
        self.meta = meta or type("M", (), {"changes": 1})()

    def as_py(self):
        return self._first

    def to_py(self):
        return self._first


class FakePrepared:
    def __init__(self, conn, query):
        self.conn = conn
        self.query = query
        self.params = ()

    def bind(self, *params):
        self.params = params
        return self

    async def run(self):
        cur = self.conn.cursor()
        cur.execute(self.query, self.params)
        self.conn.commit()
        return FakeResult(meta=type("M", (), {"changes": cur.rowcount})())

    async def first(self):
        cur = self.conn.cursor()
        cur.execute(self.query, self.params)
        row = cur.fetchone()
        if row is None:
            return None
        cols = [d[0] for d in cur.description]
        return dict(zip(cols, row))

    async def all(self):
        cur = self.conn.cursor()
        cur.execute(self.query, self.params)
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description] if cur.description else []
        return FakeResult(rows=[dict(zip(cols, r)) for r in rows])


class FakeD1:
    def __init__(self, conn):
        self.conn = conn

    def prepare(self, query):
        return FakePrepared(self.conn, query)


def make_env():
    conn = sqlite3.connect(":memory:")
    cur = conn.cursor()
    cur.executescript(
        """
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', owner_user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE workspace_members (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE agents (
      id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
      parent_agent_id TEXT, project_id TEXT,
      environment TEXT CHECK (environment IN ('dev','staging','prod')),
      public_key TEXT, key_fingerprint TEXT, key_rotated_at TEXT,
      suspended_at TEXT, suspended_reason TEXT, suspended_by_user_id TEXT,
      last_seen_at TEXT, metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    """
    )
    now = "2026-01-01T00:00:00+00:00"
    cur.execute("INSERT INTO users VALUES (?,?,?,?,?)", ("u_1", "A", "a@x.dev", now, now))
    cur.execute("INSERT INTO users VALUES (?,?,?,?,?)", ("u_2", "B", "b@x.dev", now, now))
    cur.execute("INSERT INTO users VALUES (?,?,?,?,?)", ("u_9", "Z", "z@x.dev", now, now))
    cur.execute("INSERT INTO workspaces VALUES (?,?,?,?,?,?,?)", ("ws_1", "Acme", "u_1", "active", "{}", now, now))
    cur.execute("INSERT INTO workspaces VALUES (?,?,?,?,?,?,?)", ("ws_2", "Other", "u_9", "active", "{}", now, now))
    cur.execute("INSERT INTO workspace_members VALUES (?,?,?,?,?,?)", ("wsm_1", "ws_1", "u_1", "owner", now, now))
    cur.execute("INSERT INTO workspace_members VALUES (?,?,?,?,?,?)", ("wsm_9", "ws_2", "u_9", "owner", now, now))
    conn.commit()
    return FakeD1(conn)


results = []


def report(name, passed, detail=""):
    results.append((name, passed, detail))
    print(f"[{'PASS' if passed else 'FAIL'}] {name} {detail}")


async def run_expect(coro, status):
    from fastapi import HTTPException

    try:
        body = await coro
        return False, body
    except HTTPException as e:
        return (e.status_code == status), e


async def test_01_create_happy_path():
    from services import agents as agents_service
    from utils.types import AgentCreateRequest

    env = make_env()
    req = AgentCreateRequest(
        name="Atlas",
        description="files issues",
        project_id="proj_1",
        environment="prod",
        public_key="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDemo",
    )
    body = await agents_service.create_agent(env, "u_1", "ws_1", req)
    data = body["data"]
    assert data["id"].startswith("ag_"), data["id"]
    assert data["status"] == "active"
    assert data["workspace_id"] == "ws_1"
    assert data["project_id"] == "proj_1" and data["environment"] == "prod"
    assert "public_key" not in data, "public key must never leave the server"
    assert data["key_fingerprint"] == hashlib.sha256("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDemo".encode()).hexdigest()
    report("01 create happy path", True, data["id"])


async def test_02_name_validation():
    from services import agents as agents_service
    from utils.types import AgentCreateRequest

    env = make_env()
    bad, _ = await run_expect(agents_service.create_agent(env, "u_1", "ws_1", AgentCreateRequest(name="  ")), 400)
    assert bad, "empty name must 400"
    bad, _ = await run_expect(agents_service.create_agent(env, "u_1", "ws_1", AgentCreateRequest(name="x" * 65)), 400)
    assert bad, "long name must 400"
    report("02 name validation", True)


async def test_03_bad_environment_is_400_not_500():
    from services import agents as agents_service
    from utils.types import AgentCreateRequest

    env = make_env()
    bad, exc = await run_expect(
        agents_service.create_agent(env, "u_1", "ws_1", AgentCreateRequest(name="X", environment="test")), 400
    )
    assert bad, f"bad env must 400, got {exc}"
    report("03 bad environment is 400", True)


async def test_04_parent_must_exist_in_workspace():
    from services import agents as agents_service
    from utils.types import AgentCreateRequest

    env = make_env()
    # parent in another workspace u_1 can't see
    other = await agents_service.create_agent(env, "u_9", "ws_2", AgentCreateRequest(name="Other"))
    # seed membership for u_9 in ws_2 so the create above works
    missing, _ = await run_expect(
        agents_service.create_agent(
            env, "u_1", "ws_1", AgentCreateRequest(name="Child", parent_agent_id="nope")
        ),
        404,
    )
    assert missing, "missing parent must 404"
    cross, _ = await run_expect(
        agents_service.create_agent(
            env, "u_1", "ws_1", AgentCreateRequest(name="Child", parent_agent_id=other["data"]["id"])
        ),
        404,
    )
    assert cross, "cross-workspace parent must 404 (no existence leak)"
    ok = await agents_service.create_agent(
        env, "u_1", "ws_1", AgentCreateRequest(name="Parent")
    )
    child = await agents_service.create_agent(
        env, "u_1", "ws_1", AgentCreateRequest(name="Child", parent_agent_id=ok["data"]["id"])
    )
    assert child["data"]["parent_agent_id"] == ok["data"]["id"]
    report("04 parent scoping", True)


async def test_05_list_isolation_and_meta():
    from services import agents as agents_service
    from utils.types import AgentCreateRequest

    env = make_env()
    await agents_service.create_agent(env, "u_1", "ws_1", AgentCreateRequest(name="A1"))
    await agents_service.create_agent(env, "u_1", "ws_1", AgentCreateRequest(name="A2"))
    body = await agents_service.list_agents(env, "u_1", "ws_1")
    assert body["meta"]["total"] == 2 and len(body["data"]) == 2
    assert all(a["workspace_id"] == "ws_1" for a in body["data"])
    assert all("public_key" not in a for a in body["data"])
    report("05 list isolation + meta", True)


async def test_06_personal_autoprovision():
    from services import agents as agents_service
    from utils.types import AgentCreateRequest

    env = make_env()
    body = await agents_service.create_agent(env, "u_2", None, AgentCreateRequest(name="Solo"))
    assert body["data"]["workspace_id"].startswith("ws_"), body["data"]
    report("06 personal workspace autoprovision", True, body["data"]["workspace_id"])


async def main():
    tests = [
        test_01_create_happy_path,
        test_02_name_validation,
        test_03_bad_environment_is_400_not_500,
        test_04_parent_must_exist_in_workspace,
        test_05_list_isolation_and_meta,
        test_06_personal_autoprovision,
    ]
    for t in tests:
        try:
            await t()
        except Exception as e:
            import traceback

            report(t.__name__, False, f"exception {e} {traceback.format_exc()[:600]}")
    print(f"\n--- {sum(1 for _, p, _ in results if p)}/{len(results)} passed ---")
    for name, passed, detail in results:
        if not passed:
            print(f"FAIL {name}: {detail}")


if __name__ == "__main__":
    asyncio.run(main())
