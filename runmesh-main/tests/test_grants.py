"""
Workspace grants tests — list/mint/approve/deny/revoke service layer.
Run: uv run --no-sync python tests/test_grants.py
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
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE connect_users (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active', primary_email TEXT, primary_email_verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE connect_apps (
      id TEXT PRIMARY KEY, developer_user_id TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL,
      client_secret_hash TEXT NOT NULL, redirect_uris TEXT NOT NULL DEFAULT '[]',
      allowed_providers TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, workspace_id TEXT,
      UNIQUE (developer_user_id, slug)
    );
    CREATE TABLE connect_connections (
      id TEXT PRIMARY KEY, connect_user_id TEXT NOT NULL, provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', scopes TEXT NOT NULL DEFAULT '[]',
      access_token_enc TEXT, refresh_token_enc TEXT, token_expires_at TEXT,
      provider_account_id TEXT, provider_account_label TEXT, identity_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      revoked_at TEXT, workspace_id TEXT
    );
    CREATE TABLE connect_grants (
      id TEXT PRIMARY KEY, connect_app_id TEXT,
      connect_user_id TEXT NOT NULL, connection_id TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active',
      granted_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      created_by_task_id TEXT, created_by_workflow_run_id TEXT, agent_id TEXT,
      approval_status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (approval_status IN ('pending_approval','approved','denied','expired')),
      valid_from TEXT, valid_until TEXT, resource_filters TEXT,
      max_uses INTEGER, use_count INTEGER NOT NULL DEFAULT 0,
      project_id TEXT, environment TEXT CHECK (environment IN ('dev','staging','prod')),
      workspace_id TEXT
    );
    CREATE TABLE tasks (id TEXT PRIMARY KEY, thread_id TEXT);
    CREATE TABLE workflow_runs (id TEXT PRIMARY KEY, thread_id TEXT);
    CREATE TABLE connect_audit_events (
      id TEXT PRIMARY KEY, connect_user_id TEXT, connect_app_id TEXT,
      event_type TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT,
      resource_type TEXT, resource_id TEXT, metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, agent_id TEXT, task_id TEXT, workflow_run_id TEXT,
      approval_required INTEGER DEFAULT 0, denial_reason TEXT,
      token_issued_at TEXT, token_expires_at TEXT, result TEXT DEFAULT 'success',
      error_code TEXT, error_message TEXT, request_id TEXT, workspace_id TEXT
    );
    CREATE TABLE policy_rules (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
      priority INTEGER NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1, conditions TEXT NOT NULL DEFAULT '[]',
      action TEXT NOT NULL DEFAULT 'escalate' CHECK (action IN ('allow','escalate','consent','deny')),
      scope TEXT NOT NULL DEFAULT 'all scopes',
      mode TEXT NOT NULL DEFAULT 'log-only' CHECK (mode IN ('enforce','log-only')),
      caps TEXT NOT NULL DEFAULT '{}',
      reversibility TEXT NOT NULL DEFAULT 'reversible' CHECK (reversibility IN ('reversible','undoable','irreversible')),
      impact TEXT NOT NULL DEFAULT 'internal' CHECK (impact IN ('low','internal','external','consequential')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, priority)
    );
    CREATE TABLE policy_decisions (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, rule_id TEXT,
      decision TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'none',
      enforced INTEGER NOT NULL DEFAULT 0, default_applied INTEGER NOT NULL DEFAULT 0,
      action TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '',
      resource TEXT NOT NULL DEFAULT '', agent_id TEXT, agent_label TEXT NOT NULL DEFAULT '',
      connect_user_id TEXT, user_label TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'grant',
      grant_id TEXT, reason TEXT NOT NULL DEFAULT '', run_id TEXT, created_at TEXT NOT NULL,
      enforcement TEXT NOT NULL DEFAULT 'cooperative'
    );
    """
    )
    cur.execute("INSERT INTO users VALUES (?,?,?,?,?)", ("u_1", "A", "a@x.dev", NOW, NOW))
    cur.execute("INSERT INTO users VALUES (?,?,?,?,?)", ("u_9", "Z", "z@x.dev", NOW, NOW))
    cur.execute("INSERT INTO workspaces VALUES (?,?,?,?,?,?,?)", ("ws_1", "Acme", "u_1", "active", "{}", NOW, NOW))
    cur.execute("INSERT INTO workspaces VALUES (?,?,?,?,?,?,?)", ("ws_2", "Other", "u_9", "active", "{}", NOW, NOW))
    cur.execute("INSERT INTO workspace_members VALUES (?,?,?,?,?,?)", ("wsm_1", "ws_1", "u_1", "owner", NOW, NOW))
    cur.execute("INSERT INTO workspace_members VALUES (?,?,?,?,?,?)", ("wsm_9", "ws_2", "u_9", "owner", NOW, NOW))
    cur.execute("INSERT INTO connect_users VALUES (?,?,?,?,?,?)", ("cu_1", "active", "maya@acme.dev", 1, NOW, NOW))
    cur.execute(
        "INSERT INTO connect_connections VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("conn_1", "cu_1", "github", "active", '["repo"]', None, None, None,
         "123", "maya-dev", None, "{}", NOW, NOW, None, "ws_1"),
    )
    cur.execute(
        "INSERT INTO agents VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("ag_1", "ws_1", "u_1", "Atlas", "", "active", None, None, None,
         None, None, None, None, None, None, None, "{}", NOW, NOW),
    )
    cur.execute("INSERT INTO tasks VALUES (?,?)", ("task_1", "th_1"))
    conn.commit()
    return FakeD1(conn)


def models(db):
    from db.connect_orm import (
        ConnectAuditEventModel,
        ConnectConnectionModel,
        ConnectGrantModel,
        ConnectUserModel,
    )

    return (
        ConnectGrantModel(db),
        ConnectConnectionModel(db),
        ConnectUserModel(db),
        ConnectAuditEventModel(db),
    )


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


async def test_01_mint_pending_by_default():
    from services import connect_grants as grants_service
    from utils.types import GrantCreateRequest

    db = make_env()
    grant_model, connection_model, user_model, audit_model = models(db)
    body = await grants_service.create_grant(
        grant_model, connection_model, user_model, audit_model,
        "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", agent_id="ag_1", scopes=["github.issue.create"],
                           resource_filters={"github": {"repos": ["org/payments"]}},
                           max_uses=10, environment="prod"),
    )
    data = body["data"]
    assert data["approval_status"] == "pending_approval", data
    assert data["status"] == "pending", data
    assert data["provider"] == "github" and data["user"] == "maya@acme.dev", data
    assert data["resource"] == "github:org/payments", data
    assert data["connect_app_id"] if "connect_app_id" in data else True
    report("01 mint pending by default", True, data["id"])


async def test_02_mint_validation():
    from services import connect_grants as grants_service
    from utils.types import GrantCreateRequest

    db = make_env()
    grant_model, connection_model, user_model, audit_model = models(db)
    bad, _ = await run_expect(grants_service.create_grant(
        grant_model, connection_model, user_model, audit_model, "u_1", "ws_1",
        GrantCreateRequest(connection_id="nope", scopes=["x"])), 404)
    assert bad, "missing connection must 404"
    bad, _ = await run_expect(grants_service.create_grant(
        grant_model, connection_model, user_model, audit_model, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", scopes=[])), 400)
    assert bad, "empty scopes must 400"
    bad, _ = await run_expect(grants_service.create_grant(
        grant_model, connection_model, user_model, audit_model, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", scopes=["x"], environment="live")), 400)
    assert bad, "bad environment must 400"
    bad, _ = await run_expect(grants_service.create_grant(
        grant_model, connection_model, user_model, audit_model, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", agent_id="ag_nope", scopes=["x"])), 404)
    assert bad, "cross-workspace/missing agent must 404"
    bad, _ = await run_expect(grants_service.create_grant(
        grant_model, connection_model, user_model, audit_model, "u_9", "ws_1",
        GrantCreateRequest(connection_id="conn_1", scopes=["x"])), 404)
    assert bad, "non-member mint must 404"
    report("02 mint validation", True)


async def test_03_list_filters():
    from services import connect_grants as grants_service
    from utils.types import GrantCreateRequest

    db = make_env()
    grant_model, connection_model, user_model, audit_model = models(db)
    await grants_service.create_grant(
        grant_model, connection_model, user_model, audit_model, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", scopes=["a"]))
    await grants_service.create_grant(
        grant_model, connection_model, user_model, audit_model, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", scopes=["b"], approval_status="approved"))
    body = await grants_service.list_workspace_grants(
        grant_model, connection_model, user_model, "ws_1")
    assert body["meta"]["total"] == 2, body["meta"]
    pending = await grants_service.list_workspace_grants(
        grant_model, connection_model, user_model, "ws_1", status="pending")
    assert pending["meta"]["total"] == 1, pending["meta"]
    active = await grants_service.list_workspace_grants(
        grant_model, connection_model, user_model, "ws_1", status="active")
    assert active["meta"]["total"] == 1 and active["data"][0]["status"] == "active"
    other = await grants_service.list_workspace_grants(
        grant_model, connection_model, user_model, "ws_2")
    assert other["meta"]["total"] == 0, "workspaces must not leak"
    bad, _ = await run_expect(grants_service.list_workspace_grants(
        grant_model, connection_model, user_model, "ws_1", status="bogus"), 400)
    assert bad, "bad status must 400"
    report("03 list filters + isolation", True)


async def test_04_approve_deny_revoke():
    import types as pytypes
    from services import connect_grants as grants_service
    from utils.types import GrantCreateRequest

    db = make_env()
    grant_model, connection_model, user_model, audit_model = models(db)
    env = pytypes.SimpleNamespace(DB=db)
    created = await grants_service.create_grant(
        grant_model, connection_model, user_model, audit_model, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", scopes=["a"]))
    gid = created["data"]["id"]

    bad, _ = await run_expect(
        grants_service.approve_grant(grant_model, audit_model, gid, "u_9", None, env), 404)
    assert bad, "non-member approve must 404"
    approved = await grants_service.approve_grant(grant_model, audit_model, gid, "u_1", "ok", env)
    assert approved["data"]["approval_status"] == "approved"
    bad, _ = await run_expect(
        grants_service.approve_grant(grant_model, audit_model, gid, "u_1", None, env), 409)
    assert bad, "double approve must 409"

    created2 = await grants_service.create_grant(
        grant_model, connection_model, user_model, audit_model, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", scopes=["b"]))
    gid2 = created2["data"]["id"]
    denied = await grants_service.deny_grant(grant_model, audit_model, gid2, "u_1", "nope", env)
    assert denied["data"]["approval_status"] == "denied"

    revoked = await grants_service.revoke_grant(
        grant_model, connection_model, user_model, audit_model, gid, "u_1", "rotating", env)
    assert revoked["data"]["status"] == "revoked", revoked["data"]
    bad, _ = await run_expect(grants_service.revoke_grant(
        grant_model, connection_model, user_model, audit_model, gid, "u_1", None, env), 409)
    assert bad, "double revoke must 409"
    report("04 approve deny revoke", True)


async def test_05_connections_list():
    from db.connect_orm import ConnectConnectionModel, ConnectUserModel
    from services import connect_sessions as sessions_service

    db = make_env()
    body = await sessions_service.list_workspace_connections(
        ConnectConnectionModel(db), ConnectUserModel(db), "ws_1")
    assert body["meta"]["total"] == 1, body["meta"]
    item = body["data"][0]
    assert item["provider"] == "github" and item["user"] == "maya@acme.dev", item
    assert item["account"] == "maya-dev" and item["scopes"] == ["repo"], item
    filtered = await sessions_service.list_workspace_connections(
        ConnectConnectionModel(db), ConnectUserModel(db), "ws_1", provider="slack")
    assert filtered["meta"]["total"] == 0
    other = await sessions_service.list_workspace_connections(
        ConnectConnectionModel(db), ConnectUserModel(db), "ws_2")
    assert other["meta"]["total"] == 0, "workspaces must not leak"
    report("05 connections list + isolation", True)


async def test_06_workspace_app_singleton():
    from db.connect_orm import ConnectAppModel
    from services.connect_apps import ensure_workspace_app

    db = make_env()
    first = await ensure_workspace_app(ConnectAppModel(db), "ws_1", "u_1")
    second = await ensure_workspace_app(ConnectAppModel(db), "ws_1", "u_1")
    assert first.id == second.id, "must be a singleton per workspace"
    assert first.workspace_id == "ws_1" and first.status.value == "active"
    other = await ensure_workspace_app(ConnectAppModel(db), "ws_2", "u_9")
    assert other.id != first.id, "different workspaces get different clients"
    report("06 workspace app singleton", True, first.id)


async def test_07_exchange_is_workspace_bound():
    from db.connect_orm import ConnectAppModel
    from services import connect_oauth as oauth_service
    from utils.types import GrantCreateRequest

    db = make_env()
    grant_model, connection_model, user_model, audit_model = models(db)
    created = await grants_service_create(
        grant_model, connection_model, user_model, audit_model)
    gid = created["data"]["id"]

    class Req:
        code = None
        grant_id = gid
        task_id = None
        workflow_run_id = None
        workspace_project_id = None
        agent_id = None

    bad, _ = await run_expect(oauth_service.exchange_connect_token(
        ConnectAppModel(db), None, grant_model, audit_model,
        Req(), "u_9", "test-secret", "ws_2"), 403)
    assert bad, "cross-workspace grant exchange must 403"
    report("07 exchange is workspace-bound", True)


async def test_08_code_embeds_workspace():
    import types as pytypes
    from services.connect_common import _issue_connect_code, _parse_connect_code

    session = pytypes.SimpleNamespace(
        id="sess_1", connect_app_id="app_1", workspace_id="ws_1",
        external_user_id="ext_1",
    )
    code = _issue_connect_code("test-secret", session, "cu_1")
    payload = _parse_connect_code(code, "test-secret")
    assert payload["workspace_id"] == "ws_1", payload
    assert payload["session_id"] == "sess_1"
    report("08 code embeds workspace", True)


async def grants_service_create(grant_model, connection_model, user_model, audit_model):
    from services import connect_grants as grants_service
    from utils.types import GrantCreateRequest

    return await grants_service.create_grant(
        grant_model, connection_model, user_model, audit_model, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", scopes=["a"], approval_status="approved"))


async def test_09_audit_is_workspace_scoped():
    import types as pytypes
    from db.connect_orm import ConnectConnectionModel, ConnectUserModel
    from db.orm import Model, TaskModel, WorkflowRunModel
    from services import connect_grants as grants_service
    from services import connect_audit as audit_service
    from utils.types import GrantCreateRequest

    db = make_env()
    grant_model, connection_model, user_model, audit_model = models(db)
    env = pytypes.SimpleNamespace(DB=db)
    created = await grants_service.create_grant(
        grant_model, connection_model, user_model, audit_model, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", scopes=["a"]))
    gid = created["data"]["id"]
    await grants_service.approve_grant(grant_model, audit_model, gid, "u_1", None, env)

    async def listing(ws):
        return await audit_service.list_audit_events(
            audit_model, TaskModel(db), WorkflowRunModel(db),
            ConnectUserModel(db), Model(db), ws)

    body = await listing("ws_1")
    assert body["meta"]["total"] == 2, body["meta"]
    assert all(e["authority"] == gid[:8] for e in body["data"]), body["data"]
    other = await listing("ws_2")
    assert other["meta"]["total"] == 0, "audit must not leak across workspaces"

    metrics = await audit_service.get_connect_metrics(env, "u_1", "ws_1")
    assert metrics["data"]["pending_approvals"] == 0, metrics["data"]
    metrics2 = await audit_service.get_connect_metrics(env, "u_9", "ws_2")
    assert metrics2["data"]["pending_approvals"] == 0
    report("09 audit + metrics workspace-scoped", True)


async def test_10_audit_enrichment():
    from db.connect_orm import ConnectAuditEventModel
    from db.orm import Model, TaskModel, WorkflowRunModel
    from db.connect_orm import ConnectConnectionModel, ConnectUserModel
    from services import connect_audit as audit_service
    from utils.types import ConnectAuditEventCreate, ConnectAuditActorType

    db = make_env()
    audit_model = ConnectAuditEventModel(db)
    await audit_model.create(ConnectAuditEventCreate(
        event_type="connect.token.exchanged",
        actor_type=ConnectAuditActorType.SYSTEM,
        resource_type="connect_token",
        resource_id="tok_1",
        agent_id="ag_1",
        task_id="task_1",
        workspace_id="ws_1",
    ))
    body = await audit_service.list_audit_events(
        audit_model, TaskModel(db), WorkflowRunModel(db),
        ConnectUserModel(db), Model(db), "ws_1")
    assert body["meta"]["total"] == 1, body["meta"]
    item = body["data"][0]
    assert item["actor"] == "Atlas" and item["actor_type"] == "agent", item
    assert item["thread_id"] == "th_1" and item["trace_id"] == "task_1", item
    assert item["type"] == "token" and item["outcome"] == "success", item
    assert item["mode"] == "autonomous" and item["on_behalf_of"] == "—", item
    report("10 audit enrichment", True)


async def main():
    await test_01_mint_pending_by_default()
    await test_02_mint_validation()
    await test_03_list_filters()
    await test_04_approve_deny_revoke()
    await test_05_connections_list()
    await test_06_workspace_app_singleton()
    await test_07_exchange_is_workspace_bound()
    await test_08_code_embeds_workspace()
    await test_09_audit_is_workspace_scoped()
    await test_10_audit_enrichment()
    failed = [name for name, passed, _ in results if not passed]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed:
        raise SystemExit(f"FAILED: {failed}")


if __name__ == "__main__":
    asyncio.run(main())
