"""
Managed tool invocation tests — registry, policy, credential injection, scrub.
Run: uv run --no-sync python tests/test_tool_invoke.py
"""
import asyncio
import json
import sqlite3
import sys
import os
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

FETCH_CALLS = []
FETCH_RESPONSE = {"status": 200, "text": "{}"}


async def _fake_fetch(url, method="GET", headers=None, body=None, **kw):
    FETCH_CALLS.append({"url": url, "method": method, "headers": headers or {}, "body": body})

    class R:
        status = FETCH_RESPONSE["status"]

        async def text(self):
            return FETCH_RESPONSE["text"]

        async def json(self):
            return json.loads(FETCH_RESPONSE["text"])

    return R()


for mod in ["js", "_cloudflare_compat_flags"]:
    if mod not in sys.modules:
        sys.modules[mod] = types.ModuleType(mod)
if "workers" not in sys.modules:
    w = types.ModuleType("workers")
    w.fetch = _fake_fetch
    sys.modules["workers"] = w
else:
    sys.modules["workers"].fetch = _fake_fetch


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
JWT_SECRET = "test-vault-secret"


class FakeEnv:
    def __init__(self, db):
        self.DB = db
        self.JWT_SECRET = JWT_SECRET


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
      status TEXT NOT NULL DEFAULT 'active',
      framework TEXT, external_key TEXT, fingerprint TEXT, model TEXT, system_prompt TEXT,
      tools TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1,
      last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE tools (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_id TEXT, name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'local', provider TEXT, action TEXT NOT NULL DEFAULT '',
      method TEXT NOT NULL DEFAULT 'POST', url TEXT, base_url TEXT,
      auth_scheme TEXT NOT NULL DEFAULT 'none', auth_header TEXT NOT NULL DEFAULT 'Authorization',
      auth_format TEXT NOT NULL DEFAULT 'Bearer {token}', resource_param TEXT,
      schema_hash TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, name)
    );
    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_id TEXT NOT NULL,
      parent_run_id TEXT, thread_id TEXT, connect_user_id TEXT, status TEXT NOT NULL DEFAULT 'running', input TEXT,
      usage TEXT NOT NULL DEFAULT '{}', started_at TEXT, finished_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE agent_events (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, run_id TEXT NOT NULL, seq INTEGER NOT NULL,
      kind TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', args TEXT NOT NULL DEFAULT '{}',
      result TEXT NOT NULL DEFAULT '{}', truncated INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER, created_at TEXT NOT NULL, UNIQUE (run_id, seq)
    );
    CREATE TABLE connect_users (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active', primary_email TEXT, primary_email_verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
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
      approval_status TEXT NOT NULL DEFAULT 'pending_approval',
      valid_from TEXT, valid_until TEXT, resource_filters TEXT,
      max_uses INTEGER, use_count INTEGER NOT NULL DEFAULT 0,
      project_id TEXT, environment TEXT, workspace_id TEXT
    );
    CREATE TABLE policy_rules (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
      priority INTEGER NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1, conditions TEXT NOT NULL DEFAULT '[]',
      action TEXT NOT NULL DEFAULT 'escalate', scope TEXT NOT NULL DEFAULT 'all scopes',
      mode TEXT NOT NULL DEFAULT 'log-only', caps TEXT NOT NULL DEFAULT '{}',
      reversibility TEXT NOT NULL DEFAULT 'reversible', impact TEXT NOT NULL DEFAULT 'internal',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (workspace_id, priority)
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
    CREATE TABLE connect_audit_events (
      id TEXT PRIMARY KEY, connect_user_id TEXT, connect_app_id TEXT,
      event_type TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT,
      resource_type TEXT, resource_id TEXT, metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, agent_id TEXT, task_id TEXT, workflow_run_id TEXT,
      approval_required INTEGER DEFAULT 0, denial_reason TEXT,
      token_issued_at TEXT, token_expires_at TEXT, result TEXT DEFAULT 'success',
      error_code TEXT, error_message TEXT, request_id TEXT, workspace_id TEXT
    );
    CREATE TABLE idempotency_keys (
      workspace_id TEXT NOT NULL, key TEXT NOT NULL, status INTEGER NOT NULL,
      response TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, key)
    );
    """
    )
    cur.execute("INSERT INTO users VALUES (?,?,?,?,?)", ("u_1", "A", "a@x.dev", NOW, NOW))
    cur.execute("INSERT INTO workspaces VALUES (?,?,?,?,?,?,?)", ("ws_1", "Acme", "u_1", "active", "{}", NOW, NOW))
    cur.execute("INSERT INTO workspace_members VALUES (?,?,?,?,?,?)", ("wsm_1", "ws_1", "u_1", "owner", NOW, NOW))
    cur.execute("INSERT INTO connect_users VALUES (?,?,?,?,?,?)", ("cu_1", "active", "maya@acme.dev", 1, NOW, NOW))
    conn.commit()
    return FakeD1(conn)


results = []


def report(name, passed, detail=""):
    results.append((name, passed, detail))
    print(f"[{'PASS' if passed else 'FAIL'}] {name} {detail}")


async def run_expect(coro, status):
    from fastapi import HTTPException

    try:
        await coro
        return False, None
    except HTTPException as e:
        return (e.status_code == status), e


def managed_tool(name="charge", provider="http", url="https://api.example.test/charge"):
    return {
        "name": name, "kind": "managed", "provider": provider, "action": f"{provider}.charge",
        "method": "POST", "url": url, "authScheme": "bearer", "resourceParam": "account",
    }


def local_tool(name="get_weather"):
    return {"name": name, "kind": "local"}


async def seed_agent(db, tools):
    from services import collection
    from utils.types import AgentResolveRequest

    body = await collection.resolve_agent(db, "u_1", "ws_1", AgentResolveRequest(
        external_key="billing", name="Billing", framework="vercel-ai-sdk", tools=tools))
    return body["data"]


def add_connection(db, token="tok_secret_123", provider="http", scopes='["charge"]'):
    from utils.connect_crypto import encrypt_connect_secret

    db.conn.execute(
        "INSERT INTO connect_connections (id, connect_user_id, provider, status, scopes, "
        "access_token_enc, metadata, created_at, updated_at, workspace_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
        ("conn_1", "cu_1", provider, "active", scopes,
         encrypt_connect_secret(token, JWT_SECRET), "{}", NOW, NOW, "ws_1"),
    )
    db.conn.commit()


async def start_run(db, agent_id):
    from services import collection
    from utils.types import RunStartRequest

    body = await collection.start_run(db, "u_1", "ws_1", RunStartRequest(agent_id=agent_id, input="go"))
    return body["data"]["id"]


def add_grant(db, *, agent_id=None, valid_until=None, max_uses=None, use_count=0,
              resource_filters=None, approval_status="approved", status="active", scopes='["echo"]'):
    db.conn.execute(
        "INSERT INTO connect_grants (id, connect_user_id, connection_id, scopes, status, "
        "granted_at, created_at, updated_at, agent_id, approval_status, valid_until, "
        "resource_filters, max_uses, use_count, workspace_id) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("grant_1", "cu_1", "conn_1", scopes, status, NOW, NOW, NOW, agent_id,
         approval_status, valid_until, resource_filters, max_uses, use_count, "ws_1"),
    )
    db.conn.commit()


def grant_use_count(db):
    row = db.conn.execute("SELECT use_count FROM connect_grants WHERE id='grant_1'").fetchone()
    return row[0] if row else None


async def test_01_registry_classifies():
    db = make_env()
    data = await seed_agent(db, [managed_tool(), local_tool()])
    by_name = {t["name"]: t for t in data["tools"]}
    assert by_name["charge"]["kind"] == "managed" and by_name["charge"]["ref"].startswith("tool_")
    assert by_name["get_weather"]["kind"] == "local"
    # managed without a provider+url degrades to local (never proxied)
    data2 = await seed_agent(make_env(), [{"name": "x", "kind": "managed"}])
    assert data2["tools"][0]["kind"] == "local"
    report("01 registry classifies managed vs local", True, by_name["charge"]["ref"])


async def test_02_invoke_allows_and_injects():
    global FETCH_CALLS, FETCH_RESPONSE
    db = make_env()
    add_connection(db)
    add_grant(db)
    data = await seed_agent(db, [managed_tool()])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])

    FETCH_CALLS = []
    FETCH_RESPONSE = {"status": 200, "text": json.dumps({"ok": True, "echo": "tok_secret_123"})}

    from services import tool_invoke
    from utils.types import ToolInvokeRequest

    body = await tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", ref,
        ToolInvokeRequest(run_id=run_id, args={"amount": 20, "account": "acct_1"}),
    )
    out = body["data"]
    assert out["decision"] == "allow" and out["status"] == 200, out
    assert len(FETCH_CALLS) == 1, FETCH_CALLS
    call = FETCH_CALLS[0]
    assert call["headers"]["Authorization"] == "Bearer tok_secret_123", call["headers"]
    assert call["url"] == "https://api.example.test/charge", call
    # response scrubbed: the injected token never reaches the agent
    assert "tok_secret_123" not in json.dumps(out["result"]), out["result"]
    assert out["result"]["echo"] == "[REDACTED]", out["result"]
    report("02 allow injects credential + scrubs response", True)


async def test_03_enforced_deny_blocks_call():
    global FETCH_CALLS
    db = make_env()
    add_connection(db)
    add_grant(db)
    from services import policies as policies_service
    from utils.types import PolicyConditionInput, PolicyRuleCreateRequest

    await policies_service.create_rule(db, "u_1", "ws_1", PolicyRuleCreateRequest(
        name="No charges",
        conditions=[PolicyConditionInput(field="action", operator="is", value="http.charge")],
        action="deny", mode="enforce", enabled=True))
    data = await seed_agent(db, [managed_tool()])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])

    FETCH_CALLS = []
    from services import tool_invoke
    from utils.types import ToolInvokeRequest

    body = await tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", ref,
        ToolInvokeRequest(run_id=run_id, args={"amount": 20}),
    )
    assert body["data"]["decision"] == "deny", body["data"]
    assert FETCH_CALLS == [], "denied call must not reach upstream"
    decisions = db.conn.execute("SELECT enforcement, source, decision FROM policy_decisions").fetchall()
    assert decisions and decisions[0][0] == "proxied" and decisions[0][1] == "call", decisions
    report("03 enforced deny blocks before upstream", True)


async def test_04_no_connection_is_consent():
    global FETCH_CALLS
    db = make_env()
    data = await seed_agent(db, [managed_tool()])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])
    FETCH_CALLS = []
    from services import tool_invoke
    from utils.types import ToolInvokeRequest

    body = await tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", ref, ToolInvokeRequest(run_id=run_id, args={}))
    assert body["data"]["decision"] == "consent", body["data"]
    assert body["data"]["provider"] == "http"
    assert FETCH_CALLS == []
    report("04 missing connection asks for consent", True)


async def test_05_rejects_local_and_unknown():
    db = make_env()
    data = await seed_agent(db, [local_tool(), managed_tool()])
    by_name = {t["name"]: t for t in data["tools"]}
    run_id = await start_run(db, data["id"])
    from services import tool_invoke
    from utils.types import ToolInvokeRequest

    bad, _ = await run_expect(tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", by_name["get_weather"]["ref"],
        ToolInvokeRequest(run_id=run_id, args={})), 400)
    assert bad, "local tool must not be invokable"
    missing, _ = await run_expect(tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", "tool_deadbeef0000",
        ToolInvokeRequest(run_id=run_id, args={})), 404)
    assert missing, "unknown ref must 404"
    report("05 local + unknown rejected", True)


async def test_06_escalate_returns_pending():
    db = make_env()
    add_connection(db)
    add_grant(db)
    from services import policies as policies_service
    from utils.types import PolicyConditionInput, PolicyRuleCreateRequest

    await policies_service.create_rule(db, "u_1", "ws_1", PolicyRuleCreateRequest(
        name="Big charges need a human",
        conditions=[PolicyConditionInput(field="action", operator="is", value="http.charge")],
        action="escalate", mode="enforce", enabled=True))
    data = await seed_agent(db, [managed_tool()])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])
    from services import tool_invoke
    from utils.types import ToolInvokeRequest

    body = await tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", ref, ToolInvokeRequest(run_id=run_id, args={"amount": 500}))
    assert body["data"]["decision"] == "escalate", body["data"]
    report("06 escalate returns pending", True)


async def test_07_upstream_timeout_is_an_error_not_a_hang():
    import time
    import services.tool_invoke as invoke_mod

    async def _hang(url, method="GET", headers=None, body=None, **kw):
        await asyncio.sleep(60)

    old_fetch = invoke_mod.fetch
    invoke_mod.fetch = _hang
    old_timeout = invoke_mod.UPSTREAM_TIMEOUT_S
    invoke_mod.UPSTREAM_TIMEOUT_S = 0.05
    try:
        db = make_env()
        add_connection(db)
        add_grant(db)
        data = await seed_agent(db, [managed_tool()])
        ref = data["tools"][0]["ref"]
        run_id = await start_run(db, data["id"])
        from services import tool_invoke
        from utils.types import ToolInvokeRequest

        started = time.monotonic()
        body = await tool_invoke.invoke_tool(
            FakeEnv(db), "u_1", "ws_1", ref, ToolInvokeRequest(run_id=run_id, args={}))
        elapsed = time.monotonic() - started
        assert elapsed < 10, f"must not hang ({elapsed:.1f}s)"
        assert body["data"]["upstream_error"] is True and body["data"]["status"] == 502
    finally:
        invoke_mod.UPSTREAM_TIMEOUT_S = old_timeout
        invoke_mod.fetch = old_fetch
    report("07 upstream timeout returns error, never hangs", True)


async def test_08_broken_policy_fails_closed_not_500():
    global FETCH_CALLS
    db = make_env()
    add_connection(db)
    add_grant(db)
    db.conn.execute(
        "INSERT INTO policy_rules (id, workspace_id, priority, name, enabled, conditions, action, mode, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?)",
        ("pol_broken", "ws_1", 1, "Broken", 1, "not-json{", "deny", "enforce", NOW, NOW),
    )
    db.conn.commit()
    data = await seed_agent(db, [managed_tool()])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])
    FETCH_CALLS = []
    from services import tool_invoke
    from utils.types import ToolInvokeRequest

    body = await tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", ref, ToolInvokeRequest(run_id=run_id, args={}))
    assert body["data"]["decision"] == "deny", body["data"]
    assert "failing closed" in body["data"]["reason"]
    assert FETCH_CALLS == [], "a broken rule must still stop the call"
    report("08 corrupt rule fails closed with a clean deny", True)


async def test_09_missing_ledger_table_does_not_block():
    global FETCH_CALLS, FETCH_RESPONSE
    db = make_env()
    add_connection(db)
    add_grant(db)
    db.conn.execute("DROP TABLE policy_decisions")
    db.conn.commit()
    data = await seed_agent(db, [managed_tool()])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])
    FETCH_CALLS = []
    FETCH_RESPONSE = {"status": 200, "text": "{}"}
    from services import tool_invoke
    from utils.types import ToolInvokeRequest

    body = await tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", ref, ToolInvokeRequest(run_id=run_id, args={}))
    assert body["data"]["decision"] == "allow", body["data"]
    assert body["data"]["ledger_ok"] is False
    assert len(FETCH_CALLS) == 1, "execution must proceed without the ledger"
    report("09 ledger outage degrades, never vetoes", True)


async def test_10_idempotent_replay():
    global FETCH_CALLS, FETCH_RESPONSE
    db = make_env()
    add_connection(db)
    add_grant(db)
    data = await seed_agent(db, [managed_tool()])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])
    FETCH_CALLS = []
    FETCH_RESPONSE = {"status": 200, "text": '{"id":"ch_1"}'}
    from services import tool_invoke
    from utils.types import ToolInvokeRequest

    first = await tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", ref,
        ToolInvokeRequest(run_id=run_id, args={"amount": 5}, idempotency_key="idem_1"))
    second = await tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", ref,
        ToolInvokeRequest(run_id=run_id, args={"amount": 5}, idempotency_key="idem_1"))
    assert len(FETCH_CALLS) == 1, "retry must not re-execute upstream"
    assert second["data"].get("idempotent_replay") is True
    assert second["data"]["result"] == first["data"]["result"]
    report("10 idempotent retry replays cached response", True)


async def test_11_ambiguous_connection_needs_a_user():
    db = make_env()
    add_connection(db)
    add_grant(db)
    db.conn.execute(
        "INSERT INTO connect_users VALUES (?,?,?,?,?,?)", ("cu_2", "active", "sam@acme.dev", 1, NOW, NOW))
    db.conn.execute(
        "INSERT INTO connect_connections (id, connect_user_id, provider, status, scopes, "
        "access_token_enc, metadata, created_at, updated_at, workspace_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
        ("conn_2", "cu_2", "http", "active", '["echo"]', "e2Vyd2hhdA", "{}", NOW, NOW, "ws_1"),
    )
    db.conn.commit()
    data = await seed_agent(db, [managed_tool()])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])
    from services import tool_invoke
    from utils.types import ToolInvokeRequest

    bad, exc = await run_expect(tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", ref, ToolInvokeRequest(run_id=run_id, args={})), 400)
    assert bad, "ambiguous principal must be rejected, not guessed"
    assert "connect_user_id" in exc.detail
    global FETCH_CALLS, FETCH_RESPONSE
    FETCH_CALLS = []
    FETCH_RESPONSE = {"status": 200, "text": "{}"}
    body = await tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", ref,
        ToolInvokeRequest(run_id=run_id, args={}, connect_user_id="cu_1"))
    assert body["data"]["decision"] == "allow", body["data"]
    report("11 ambiguous connection rejected, explicit user works", True)


async def test_12_forward_allows_and_injects():
    global FETCH_CALLS, FETCH_RESPONSE
    db = make_env()
    add_connection(db)
    add_grant(db)
    data = await seed_agent(db, [{
        "name": "github_list", "kind": "managed", "provider": "http", "action": "http.list",
        "method": "GET", "url": "https://api.example.test/", "baseUrl": "https://api.example.test",
    }])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])
    FETCH_CALLS = []
    FETCH_RESPONSE = {"status": 200, "text": '{"items":[],"echo":"tok_secret_123"}'}
    from services import tool_invoke

    body = await tool_invoke.forward_tool(
        FakeEnv(db), "u_1", "ws_1", ref,
        method="GET", path="/repos/org/x/issues", query={"page": 2},
        headers={"Accept": "application/vnd.github+json"}, run_id=run_id,
    )
    out = body["data"]
    assert out["decision"] == "allow" and out["status"] == 200, out
    assert len(FETCH_CALLS) == 1, FETCH_CALLS
    call = FETCH_CALLS[0]
    assert call["url"] == "https://api.example.test/repos/org/x/issues?page=2", call["url"]
    assert call["headers"]["Authorization"] == "Bearer tok_secret_123"
    assert call["headers"]["Accept"] == "application/vnd.github+json"
    assert "tok_secret_123" not in json.dumps(out["result"]), out["result"]
    report("12 forward builds path, injects, scrubs", True)


async def test_13_forward_host_is_fixed():
    db = make_env()
    add_connection(db)
    add_grant(db)
    data = await seed_agent(db, [{
        "name": "github_list", "kind": "managed", "provider": "http", "action": "http.list",
        "url": "https://api.example.test/", "baseUrl": "https://api.example.test",
    }])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])
    from services import tool_invoke

    for bad in ("//evil.test/x", "https://evil.test/x", "relative/path", "/x\nHost: evil"):
        blocked, _ = await run_expect(tool_invoke.forward_tool(
            FakeEnv(db), "u_1", "ws_1", ref, method="GET", path=bad, run_id=run_id), 400)
        assert blocked, f"path {bad!r} must be rejected"
    report("13 forward cannot escape its base host", True)


async def test_14_forward_cannot_override_credential():
    global FETCH_CALLS, FETCH_RESPONSE
    db = make_env()
    add_connection(db)
    add_grant(db)
    data = await seed_agent(db, [{
        "name": "github_list", "kind": "managed", "provider": "http", "action": "http.list",
        "url": "https://api.example.test/", "baseUrl": "https://api.example.test",
    }])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])
    FETCH_CALLS = []
    FETCH_RESPONSE = {"status": 200, "text": "{}"}
    from services import tool_invoke

    await tool_invoke.forward_tool(
        FakeEnv(db), "u_1", "ws_1", ref, method="GET", path="/x", run_id=run_id,
        headers={"Authorization": "Bearer attacker", "Host": "evil.test", "X-Keep": "1"},
    )
    sent = FETCH_CALLS[0]["headers"]
    assert sent["Authorization"] == "Bearer tok_secret_123", sent
    assert "Host" not in sent and "host" not in sent
    assert sent.get("X-Keep") == "1"
    report("14 caller cannot override the injected credential", True)


async def test_15_forward_policy_denies():
    global FETCH_CALLS
    db = make_env()
    add_connection(db)
    add_grant(db)
    from services import policies as policies_service
    from utils.types import PolicyConditionInput, PolicyRuleCreateRequest

    await policies_service.create_rule(db, "u_1", "ws_1", PolicyRuleCreateRequest(
        name="No listing",
        conditions=[PolicyConditionInput(field="action", operator="is", value="http.list")],
        action="deny", mode="enforce", enabled=True))
    data = await seed_agent(db, [{
        "name": "github_list", "kind": "managed", "provider": "http", "action": "http.list",
        "url": "https://api.example.test/", "baseUrl": "https://api.example.test",
    }])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])
    FETCH_CALLS = []
    from services import tool_invoke

    body = await tool_invoke.forward_tool(
        FakeEnv(db), "u_1", "ws_1", ref, method="GET", path="/x", run_id=run_id)
    assert body["data"]["decision"] == "deny", body["data"]
    assert FETCH_CALLS == [], "denied forward must not reach upstream"
    report("15 forward policy deny blocks before upstream", True)


async def test_16_forward_idempotent_replay():
    global FETCH_CALLS, FETCH_RESPONSE
    db = make_env()
    add_connection(db)
    add_grant(db)
    data = await seed_agent(db, [{
        "name": "github_list", "kind": "managed", "provider": "http", "action": "http.list",
        "url": "https://api.example.test/", "baseUrl": "https://api.example.test",
    }])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])
    FETCH_CALLS = []
    FETCH_RESPONSE = {"status": 200, "text": '{"n":1}'}
    from services import tool_invoke

    first = await tool_invoke.forward_tool(
        FakeEnv(db), "u_1", "ws_1", ref, method="GET", path="/x", run_id=run_id,
        idempotency_key="fwd-1")
    second = await tool_invoke.forward_tool(
        FakeEnv(db), "u_1", "ws_1", ref, method="GET", path="/x", run_id=run_id,
        idempotency_key="fwd-1")
    assert len(FETCH_CALLS) == 1, "forward retry must not re-execute"
    assert second["data"].get("idempotent_replay") is True
    assert second["data"]["result"] == first["data"]["result"]
    report("16 forward idempotent replay", True)


async def test_17_no_grant_is_consent():
    db = make_env()
    add_connection(db)  # connection exists, but no grant
    data = await seed_agent(db, [managed_tool()])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])
    from services import tool_invoke
    from utils.types import ToolInvokeRequest

    body = await tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", ref, ToolInvokeRequest(run_id=run_id, args={}))
    assert body["data"]["decision"] == "consent", body["data"]
    assert "grant" in body["data"]["reason"].lower(), body["data"]
    report("17 no grant -> consent", True)


async def test_18_expired_grant_denied():
    global FETCH_CALLS
    db = make_env()
    add_connection(db)
    add_grant(db, valid_until="2020-01-01T00:00:00+00:00")
    data = await seed_agent(db, [managed_tool()])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])
    FETCH_CALLS = []
    from services import tool_invoke
    from utils.types import ToolInvokeRequest

    body = await tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", ref, ToolInvokeRequest(run_id=run_id, args={}))
    assert body["data"]["decision"] == "deny", body["data"]
    assert "expired" in body["data"]["reason"], body["data"]
    assert FETCH_CALLS == [], "expired grant must not reach upstream"
    report("18 expired grant denied", True)


async def test_19_exhausted_grant_denied():
    db = make_env()
    add_connection(db)
    add_grant(db, max_uses=1, use_count=1)
    data = await seed_agent(db, [managed_tool()])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])
    from services import tool_invoke
    from utils.types import ToolInvokeRequest

    body = await tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", ref, ToolInvokeRequest(run_id=run_id, args={}))
    assert body["data"]["decision"] == "deny", body["data"]
    assert "uses" in body["data"]["reason"], body["data"]
    report("19 exhausted grant denied", True)


async def test_20_use_count_increments_on_allow():
    global FETCH_RESPONSE
    db = make_env()
    add_connection(db)
    add_grant(db, max_uses=5, use_count=0)
    data = await seed_agent(db, [managed_tool()])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])
    FETCH_RESPONSE = {"status": 200, "text": "{}"}
    from services import tool_invoke
    from utils.types import ToolInvokeRequest

    body = await tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", ref, ToolInvokeRequest(run_id=run_id, args={}))
    assert body["data"]["decision"] == "allow", body["data"]
    assert grant_use_count(db) == 1, grant_use_count(db)
    report("20 grant use reserved on allow", True)


async def test_21_resource_restricted_grant():
    global FETCH_RESPONSE
    db = make_env()
    add_connection(db)
    add_grant(db, resource_filters='{"repo": {"repos": ["org/x"]}}')
    tool = managed_tool()
    tool["resourceParam"] = "account"
    data = await seed_agent(db, [tool])
    ref = data["tools"][0]["ref"]
    run_id = await start_run(db, data["id"])
    FETCH_RESPONSE = {"status": 200, "text": "{}"}
    from services import tool_invoke
    from utils.types import ToolInvokeRequest

    outside = await tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", ref,
        ToolInvokeRequest(run_id=run_id, args={"account": "org/y"}))
    assert outside["data"]["decision"] == "deny", outside["data"]
    assert "resource" in outside["data"]["reason"], outside["data"]

    inside = await tool_invoke.invoke_tool(
        FakeEnv(db), "u_1", "ws_1", ref,
        ToolInvokeRequest(run_id=run_id, args={"account": "org/x"}))
    assert inside["data"]["decision"] == "allow", inside["data"]
    report("21 resource-restricted grant enforced", True)


async def main():
    await test_01_registry_classifies()
    await test_02_invoke_allows_and_injects()
    await test_03_enforced_deny_blocks_call()
    await test_04_no_connection_is_consent()
    await test_05_rejects_local_and_unknown()
    await test_06_escalate_returns_pending()
    await test_07_upstream_timeout_is_an_error_not_a_hang()
    await test_08_broken_policy_fails_closed_not_500()
    await test_09_missing_ledger_table_does_not_block()
    await test_10_idempotent_replay()
    await test_11_ambiguous_connection_needs_a_user()
    await test_12_forward_allows_and_injects()
    await test_13_forward_host_is_fixed()
    await test_14_forward_cannot_override_credential()
    await test_15_forward_policy_denies()
    await test_16_forward_idempotent_replay()
    await test_17_no_grant_is_consent()
    await test_18_expired_grant_denied()
    await test_19_exhausted_grant_denied()
    await test_20_use_count_increments_on_allow()
    await test_21_resource_restricted_grant()
    failed = [name for name, passed, _ in results if not passed]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed:
        raise SystemExit(f"FAILED: {failed}")


if __name__ == "__main__":
    asyncio.run(main())
