"""
Collection API tests — resolve/upsert, runs lifecycle, ingest.
Run: uv run --no-sync python tests/test_collection.py
"""
import asyncio
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


NOW = "2026-01-01T00:00:00+00:00"


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
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      framework TEXT, external_key TEXT, fingerprint TEXT, model TEXT,
      system_prompt TEXT, tools TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_id TEXT NOT NULL,
      parent_run_id TEXT, thread_id TEXT, connect_user_id TEXT, status TEXT NOT NULL DEFAULT 'running',
      input TEXT, usage TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL, finished_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE connect_users (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active', primary_email TEXT, primary_email_verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE tools (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_id TEXT, name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'local', provider TEXT, action TEXT NOT NULL DEFAULT '',
      method TEXT NOT NULL DEFAULT 'POST', url TEXT, base_url TEXT,
      auth_scheme TEXT NOT NULL DEFAULT 'none', auth_header TEXT NOT NULL DEFAULT 'Authorization',
      auth_format TEXT NOT NULL DEFAULT 'Bearer {token}', resource_param TEXT,
      schema_hash TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, name)
    );
    CREATE TABLE agent_events (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, run_id TEXT NOT NULL,
      seq INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
      args TEXT NOT NULL DEFAULT '{}', result TEXT NOT NULL DEFAULT '{}',
      truncated INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER,
      created_at TEXT NOT NULL, UNIQUE (run_id, seq)
    );
    CREATE TABLE connect_audit_events (
      id TEXT PRIMARY KEY, connect_user_id TEXT, connect_app_id TEXT,
      event_type TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT,
      resource_type TEXT, resource_id TEXT, metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, agent_id TEXT, task_id TEXT, workflow_run_id TEXT,
      approval_required INTEGER DEFAULT 0, denial_reason TEXT,
      token_issued_at TEXT, token_expires_at TEXT, result TEXT DEFAULT 'success',
      error_code TEXT, error_message TEXT, request_id TEXT, workspace_id TEXT
    );
    """
    )
    cur.execute("INSERT INTO users VALUES (?,?,?,?,?)", ("u_1", "A", "a@x.dev", NOW, NOW))
    cur.execute("INSERT INTO users VALUES (?,?,?,?,?)", ("u_9", "Z", "z@x.dev", NOW, NOW))
    cur.execute("INSERT INTO workspaces VALUES (?,?,?,?,?,?,?)", ("ws_1", "Acme", "u_1", "active", "{}", NOW, NOW))
    cur.execute("INSERT INTO workspaces VALUES (?,?,?,?,?,?,?)", ("ws_2", "Other", "u_9", "active", "{}", NOW, NOW))
    cur.execute("INSERT INTO workspace_members VALUES (?,?,?,?,?,?)", ("wsm_1", "ws_1", "u_1", "owner", NOW, NOW))
    cur.execute("INSERT INTO workspace_members VALUES (?,?,?,?,?,?)", ("wsm_9", "ws_2", "u_9", "owner", NOW, NOW))
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


def resolve_req(**overrides):
    from utils.types import AgentResolveRequest

    fields = {"external_key": "atlas", "fingerprint": "fp_abc", "name": "Atlas",
              "framework": "vercel-ai-sdk", "model": "claude-sonnet-4-5"}
    fields.update(overrides)
    return AgentResolveRequest(**fields)


async def test_01_resolve_creates_and_versions():
    from services import collection as collection_service

    db = make_env()
    first = await collection_service.resolve_agent(db, "u_1", "ws_1", resolve_req())
    data = first["data"]
    assert data["is_new"] is True and data["version"] == 1, data
    assert data["framework"] == "vercel-ai-sdk" and data["model"] == "claude-sonnet-4-5"

    same = await collection_service.resolve_agent(db, "u_1", "ws_1", resolve_req())
    assert same["data"]["id"] == data["id"] and same["data"]["is_new"] is False
    assert same["data"]["is_new_version"] is False and same["data"]["version"] == 1

    evolved = await collection_service.resolve_agent(
        db, "u_1", "ws_1", resolve_req(fingerprint="fp_def", model="claude-opus-4-5"))
    assert evolved["data"]["id"] == data["id"], "same key must not fork identity"
    assert evolved["data"]["is_new_version"] is True and evolved["data"]["version"] == 2
    assert evolved["data"]["model"] == "claude-opus-4-5"
    report("01 resolve creates + versions", True, data["id"])


async def test_02_resolve_validation_isolation():
    from services import collection as collection_service
    from utils.types import AgentResolveRequest

    db = make_env()
    bad, _ = await run_expect(collection_service.resolve_agent(
        db, "u_1", "ws_1", AgentResolveRequest()), 400)
    assert bad, "neither key nor fingerprint must 400"
    bad, _ = await run_expect(collection_service.resolve_agent(
        db, "u_1", "ws_1", resolve_req(external_key="x" * 129)), 400)
    assert bad, "oversize key must 400"
    created = await collection_service.resolve_agent(db, "u_1", "ws_1", resolve_req())
    other = await collection_service.resolve_agent(db, "u_9", "ws_2", resolve_req())
    assert other["data"]["id"] != created["data"]["id"], "same key must not leak across workspaces"
    assert other["data"]["is_new"] is True
    report("02 resolve validation + isolation", True)


async def test_03_runs_lifecycle():
    from services import collection as collection_service
    from utils.types import RunFinishRequest, RunStartRequest

    db = make_env()
    agent = await collection_service.resolve_agent(db, "u_1", "ws_1", resolve_req())
    aid = agent["data"]["id"]

    bad, _ = await run_expect(collection_service.start_run(
        db, "u_1", "ws_1", RunStartRequest(agent_id="ag_nope")), 404)
    assert bad, "missing agent must 404"
    run = await collection_service.start_run(
        db, "u_1", "ws_1", RunStartRequest(agent_id=aid, input="triage inbox"))
    assert run["data"]["status"] == "running" and run["data"]["id"].startswith("run_")
    child = await collection_service.start_run(
        db, "u_1", "ws_1", RunStartRequest(agent_id=aid, parent_run_id=run["data"]["id"]))
    assert child["data"]["parent_run_id"] == run["data"]["id"]
    bad, _ = await run_expect(collection_service.start_run(
        db, "u_9", "ws_1", RunStartRequest(agent_id=aid, parent_run_id="run_nope")), 404)
    assert bad, "missing parent run must 404"

    bad, _ = await run_expect(collection_service.finish_run(
        db, "u_1", "ws_1", run["data"]["id"], RunFinishRequest(status="done")), 400)
    assert bad, "bad status must 400"
    done = await collection_service.finish_run(
        db, "u_1", "ws_1", run["data"]["id"],
        RunFinishRequest(status="completed", usage={"tokens": 42}))
    assert done["data"]["status"] == "completed" and done["data"]["finished_at"]
    again = await collection_service.finish_run(
        db, "u_1", "ws_1", run["data"]["id"], RunFinishRequest(status="completed"))
    assert again["data"]["status"] == "completed", "same-status refinish is idempotent"
    bad, _ = await run_expect(collection_service.finish_run(
        db, "u_1", "ws_1", run["data"]["id"], RunFinishRequest(status="failed")), 409)
    assert bad, "conflicting refinish must 409"

    from db.orm import Model
    audit = await Model(db).find_many(
        "connect_audit_events", "workspace_id = ? ORDER BY created_at ASC", "ws_1"
    )
    kinds = [(row["event_type"], row["resource_id"]) for row in audit]
    assert ("agent.run.started", run["data"]["id"]) in kinds, kinds
    assert ("agent.run.started", child["data"]["id"]) in kinds, kinds
    assert ("agent.run.finished", run["data"]["id"]) in kinds, kinds
    assert all(row["agent_id"] == aid for row in audit), "run audits carry the agent"
    report("03 runs lifecycle", True, run["data"]["id"])


async def test_04_ingest():
    import json
    from services import collection as collection_service
    from utils.types import IngestEventInput, IngestRequest, RunStartRequest

    db = make_env()
    agent = await collection_service.resolve_agent(db, "u_1", "ws_1", resolve_req())
    run = await collection_service.start_run(
        db, "u_1", "ws_1", RunStartRequest(agent_id=agent["data"]["id"]))
    rid = run["data"]["id"]

    bad, _ = await run_expect(collection_service.ingest_events(
        db, "u_1", "ws_1", IngestRequest(events=[])), 400)
    assert bad, "empty batch must 400"
    bad, _ = await run_expect(collection_service.ingest_events(
        db, "u_1", "ws_1", IngestRequest(events=[
            IngestEventInput(run_id=rid, kind="teleport")])), 400)
    assert bad, "bad kind must 400"
    bad, _ = await run_expect(collection_service.ingest_events(
        db, "u_1", "ws_1", IngestRequest(events=[
            IngestEventInput(run_id="run_nope", kind="log")])), 404)
    assert bad, "unknown run must 404"

    big = "x" * 9000
    body = await collection_service.ingest_events(
        db, "u_1", "ws_1", IngestRequest(events=[
            IngestEventInput(run_id=rid, kind="tool.call", name="github_issues_get",
                             args={"owner": "o", "api_key": "sk-live-123"}, duration_ms=120),
            IngestEventInput(run_id=rid, kind="tool.result", name="github_issues_get",
                             result={"blob": big}),
        ]))
    assert body["data"]["ingested"] == 2

    from db.orm import Model
    rows = await Model(db).find_many("agent_events", "run_id = ? ORDER BY seq ASC", rid)
    assert [r["seq"] for r in rows] == [0, 1], "seq must be dense per run"
    assert rows[0]["kind"] == "tool.call" and rows[0]["duration_ms"] == 120
    assert json.loads(rows[0]["args"])["api_key"] == "[REDACTED]", "secrets must be redacted"
    assert rows[1]["truncated"] == 1, "oversize payloads must be flagged"
    report("04 ingest seq + redact + truncate", True)


async def test_05_read_endpoints():
    from services import collection as collection_service
    from utils.types import IngestEventInput, IngestRequest, RunStartRequest

    db = make_env()
    agent = await collection_service.resolve_agent(db, "u_1", "ws_1", resolve_req())
    aid = agent["data"]["id"]
    run = await collection_service.start_run(
        db, "u_1", "ws_1", RunStartRequest(agent_id=aid))
    rid = run["data"]["id"]
    await collection_service.ingest_events(
        db, "u_1", "ws_1", IngestRequest(events=[
            IngestEventInput(run_id=rid, kind="tool.call", name="t", args={"q": 1}),
            IngestEventInput(run_id=rid, kind="tool.result", name="t", result={"ok": True}),
        ]))

    listed = await collection_service.list_agent_runs(db, "u_1", "ws_1", aid)
    assert listed["meta"]["total"] == 1, listed["meta"]
    assert listed["data"][0]["event_count"] == 2, listed["data"][0]
    assert listed["data"][0]["status"] == "running"

    bad, _ = await run_expect(collection_service.list_agent_runs(db, "u_1", "ws_1", "ag_nope"), 404)
    assert bad, "missing agent must 404"
    bad, _ = await run_expect(collection_service.list_agent_runs(db, "u_9", "ws_2", aid), 404)
    assert bad, "cross-workspace agent must 404"

    detail = await collection_service.get_run(db, "u_1", "ws_1", rid)
    assert detail["data"]["id"] == rid
    assert len(detail["data"]["events"]) == 2, detail["data"]
    assert detail["data"]["events"][0]["kind"] == "tool.call"
    assert detail["data"]["events"][0]["args"] == {"q": 1}
    bad, _ = await run_expect(collection_service.get_run(db, "u_9", "ws_2", rid), 404)
    assert bad, "cross-workspace run must 404"
    report("05 read endpoints + isolation", True)


async def test_06_run_threads_and_principals():
    from services import collection as collection_service
    from services import connect_audit as audit_service
    from db.connect_orm import ConnectAuditEventModel, ConnectUserModel
    from db.orm import Model, TaskModel, WorkflowRunModel
    from utils.types import RunStartRequest

    db = make_env()
    db.conn.execute(
        "INSERT INTO connect_users VALUES (?,?,?,?,?,?)",
        ("cu_1", "active", "maya@acme.dev", 1, NOW, NOW),
    )
    db.conn.commit()
    agent = await collection_service.resolve_agent(db, "u_1", "ws_1", resolve_req())
    aid = agent["data"]["id"]

    top = await collection_service.start_run(db, "u_1", "ws_1", RunStartRequest(agent_id=aid))
    thread = top["data"]["thread_id"]
    assert thread and thread.startswith("th_"), top["data"]

    child = await collection_service.start_run(
        db, "u_1", "ws_1", RunStartRequest(agent_id=aid, parent_run_id=top["data"]["id"]))
    assert child["data"]["thread_id"] == thread, "child must inherit the parent thread"

    other = await collection_service.start_run(db, "u_1", "ws_1", RunStartRequest(agent_id=aid))
    assert other["data"]["thread_id"] != thread, "a new top-level run must open a new thread"

    explicit = await collection_service.start_run(
        db, "u_1", "ws_1", RunStartRequest(agent_id=aid, thread_id="th_custom"))
    assert explicit["data"]["thread_id"] == "th_custom"

    mine = await collection_service.start_run(
        db, "u_1", "ws_1", RunStartRequest(agent_id=aid, connect_user_id="cu_1"))
    assert mine["data"]["connect_user_id"] == "cu_1"
    bad, _ = await run_expect(collection_service.start_run(
        db, "u_1", "ws_1", RunStartRequest(agent_id=aid, connect_user_id="cu_nope")), 404)
    assert bad, "unknown connect user must 404"

    audit_model = ConnectAuditEventModel(db)
    body = await audit_service.list_audit_events(
        audit_model, TaskModel(db), WorkflowRunModel(db),
        ConnectUserModel(db), Model(db), "ws_1")
    started = [e for e in body["data"] if e["event_type"] == "agent.run.started"]
    assert len(started) == 5, body["meta"]
    assert all(e["thread_id"] is not None for e in started), "run lifecycle must chain to a thread"
    assert all(e["trace_id"] and e["trace_id"].startswith("run_") for e in started), started
    mine_row = next(e for e in started if e["agent_id"] == aid and e["on_behalf_of"] == "maya@acme.dev")
    assert mine_row["thread_id"] is not None
    report("06 run threads + principals chain in audit", True, thread)


async def test_07_tool_registration_warnings():
    from services import collection as collection_service
    from utils.types import AgentResolveRequest

    db = make_env()
    data = (await collection_service.resolve_agent(db, "u_1", "ws_1", AgentResolveRequest(
        external_key="warn", tools=[
            {"name": "ok", "kind": "managed", "provider": "github", "url": "https://api.github.com/x"},
            {"name": "no_endpoint", "kind": "managed", "provider": "github"},
            {"name": "no_provider", "kind": "managed", "url": "https://x.test"},
            {"name": "x" * 80, "kind": "local"},
        ])))["data"]

    by_name = {t["name"]: t for t in data["tools"]}
    assert by_name["ok"]["kind"] == "managed", by_name["ok"]
    assert by_name["no_endpoint"]["kind"] == "local", "missing endpoint must demote"
    assert by_name["no_provider"]["kind"] == "local", "missing provider must demote"

    warnings = {(w["tool"], w["code"]) for w in data["tool_warnings"]}
    assert ("no_endpoint", "managed_missing_config") in warnings, warnings
    assert ("no_provider", "managed_missing_config") in warnings, warnings
    assert any(code == "invalid_name" for _, code in warnings), warnings
    message = next(w["message"] for w in data["tool_warnings"] if w["tool"] == "no_endpoint")
    assert "url or baseUrl" in message, message
    report("07 tool registration warnings surface, never silent", True)


async def main():
    await test_01_resolve_creates_and_versions()
    await test_02_resolve_validation_isolation()
    await test_03_runs_lifecycle()
    await test_04_ingest()
    await test_05_read_endpoints()
    await test_06_run_threads_and_principals()
    await test_07_tool_registration_warnings()
    failed = [name for name, passed, _ in results if not passed]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed:
        raise SystemExit(f"FAILED: {failed}")


if __name__ == "__main__":
    asyncio.run(main())
