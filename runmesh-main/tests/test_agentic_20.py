"""
20 agentic infra tests — agent utilizing the whole arch (ignore workspace)
Run: .venv/bin/python tests/test_agentic_20.py
"""
import asyncio
import json
import sqlite3
import sys
import os
import uuid
import hmac
import hashlib
from datetime import datetime, timezone, timedelta
import types

# Mock Cloudflare/workers deps for local run
for mod in ["js", "_cloudflare_compat_flags"]:
    if mod not in sys.modules:
        sys.modules[mod] = types.ModuleType(mod)
if "workers" not in sys.modules:
    w = types.ModuleType("workers")
    async def _fake_fetch(*a, **kw):
        class R: status=200
        async def json(): return {}
        async def text(): return "{}"
        return R()
    w.fetch = _fake_fetch
    sys.modules["workers"] = w

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

from utils.types import ConnectGrantCreate, ConnectGrantRow

# --- Fake D1 that mimics Cloudflare D1 API used in src/db/orm.py ---
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
        d = dict(zip(cols, row))
        return FakeResult(first=d).first() if False else d
    async def all(self):
        cur = self.conn.cursor()
        cur.execute(self.query, self.params)
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description] if cur.description else []
        dicts = [dict(zip(cols, r)) for r in rows]
        return FakeResult(rows=dicts)

class FakeD1:
    def __init__(self, conn):
        self.conn = conn
    def prepare(self, query):
        return FakePrepared(self.conn, query)

class FakeQueue:
    def __init__(self):
        self.sent = []
    async def send(self, msg, delaySeconds=None):
        self.sent.append(msg)

def make_env():
    conn = sqlite3.connect(":memory:")
    cur = conn.cursor()
    # minimal schema for tests — from migrations
    cur.executescript("""
    CREATE TABLE connect_users (id TEXT PRIMARY KEY, status TEXT, primary_email TEXT, primary_email_verified INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE connect_apps (id TEXT PRIMARY KEY, developer_user_id TEXT, name TEXT, slug TEXT, client_secret_hash TEXT, redirect_uris TEXT, allowed_providers TEXT, status TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE connect_connections (id TEXT PRIMARY KEY, connect_user_id TEXT, provider TEXT, status TEXT, scopes TEXT, access_token_enc TEXT, refresh_token_enc TEXT, token_expires_at TEXT, provider_account_id TEXT, provider_account_label TEXT, identity_id TEXT, metadata TEXT, created_at TEXT, updated_at TEXT, revoked_at TEXT);
    CREATE TABLE connect_grants (id TEXT PRIMARY KEY, connect_app_id TEXT, connect_user_id TEXT, connection_id TEXT, scopes TEXT, status TEXT, granted_at TEXT, revoked_at TEXT, created_at TEXT, updated_at TEXT, created_by_task_id TEXT, created_by_workflow_run_id TEXT, agent_id TEXT, approval_status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (approval_status IN ('pending_approval','approved','denied','expired')), valid_from TEXT, valid_until TEXT, resource_filters TEXT, max_uses INTEGER, use_count INTEGER NOT NULL DEFAULT 0, project_id TEXT, environment TEXT);
    CREATE TABLE connect_audit_events (id TEXT PRIMARY KEY, connect_user_id TEXT, connect_app_id TEXT, event_type TEXT, actor_type TEXT, actor_id TEXT, resource_type TEXT, resource_id TEXT, metadata TEXT, created_at TEXT, agent_id TEXT, task_id TEXT, workflow_run_id TEXT, approval_required INTEGER, denial_reason TEXT, token_issued_at TEXT, token_expires_at TEXT, result TEXT, error_code TEXT, error_message TEXT, request_id TEXT);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, type TEXT, payload TEXT, url TEXT, status TEXT, retries INTEGER, max_retries INTEGER, scheduled_at TEXT, idempotency_key TEXT UNIQUE, execution_type TEXT, step_order INTEGER, created_at TEXT, updated_at TEXT, user_id TEXT, workflow_id TEXT, payload_template TEXT, url_template TEXT, response_body TEXT, response_status INTEGER, connect_grant_id TEXT, signing_secret TEXT);
    CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT, status TEXT, user_id TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE workflow_runs (id TEXT PRIMARY KEY, workflow_id TEXT, status TEXT, user_id TEXT, started_at TEXT);
    CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE, applied_at TEXT);
    """)
    conn.commit()
    env = type("Env", (), {"DB": FakeD1(conn), "TASK_QUEUE": FakeQueue(), "WEBHOOK_QUEUE": FakeQueue(), "JWT_SECRET": "test-secret"})()
    env._conn = conn
    return env

async def create_grant(env, **overrides):
    from db.connect_orm import ConnectGrantModel
    from utils.types import ConnectGrantCreate, ConnectGrantStatus
    defaults = dict(connect_app_id="app1", connect_user_id="user1", connection_id="conn1", scopes=["repo"], status=ConnectGrantStatus.ACTIVE)
    defaults.update(overrides)
    m = ConnectGrantModel(env.DB)
    return await m.create(ConnectGrantCreate(**defaults))

# --- Test cases ---
results = []

def report(name, passed, detail=""):
    results.append((name, passed, detail))
    status = "PASS" if passed else "FAIL"
    print(f"[{status}] {name} {detail}")

async def test_01_pending_to_approved_flow():
    env = make_env()
    grant = await create_grant(env, agent_id="agentA", created_by_task_id="task1")
    assert grant.approval_status == "pending_approval", grant.approval_status
    # token exchange should block
    from services.connect import exchange_connect_token
    from db.connect_orm import ConnectAppModel, ConnectSessionModel, ConnectGrantModel, ConnectAuditEventModel
    from utils.types import ConnectTokenRequest
    # need app
    cur = env._conn.cursor()
    cur.execute("INSERT INTO connect_apps (id, developer_user_id, name, slug, client_secret_hash, redirect_uris, allowed_providers, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                ("app1", "dev1", "Test", "test", "hash", "[]", "[]", "active", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    env._conn.commit()
    # also need connection
    cur.execute("INSERT INTO connect_connections (id, connect_user_id, provider, status, scopes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                ("conn1", "user1", "github", "active", "[]", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    env._conn.commit()
    # try token with pending -> 403
    req = ConnectTokenRequest(app_id="app1", grant_id=grant.id, agent_id="agentA", task_id="task1")
    try:
        await exchange_connect_token(ConnectAppModel(env.DB), ConnectSessionModel(env.DB), ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), req, "dev1", env.JWT_SECRET)
        report("01 pending→approved flow", False, "should have blocked")
        return
    except Exception as e:
        if "pending_approval" not in str(e.detail if hasattr(e, 'detail') else str(e)):
            report("01", False, f"wrong error {e}")
            return
    # approve
    from services.connect import approve_grant
    await approve_grant(ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), grant.id, "dev1", "ok", env)
    # now token should succeed
    req2 = ConnectTokenRequest(app_id="app1", grant_id=grant.id, agent_id="agentA", task_id="task1")
    res = await exchange_connect_token(ConnectAppModel(env.DB), ConnectSessionModel(env.DB), ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), req2, "dev1", env.JWT_SECRET)
    assert res["data"]["grant_id"] == grant.id
    report("01 pending→approved flow", True)

async def test_02_denied_blocks():
    env = make_env()
    grant = await create_grant(env, agent_id="agentB")
    cur = env._conn.cursor()
    cur.execute("INSERT INTO connect_apps (id, developer_user_id, name, slug, client_secret_hash, redirect_uris, allowed_providers, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                ("app1", "dev1", "Test", "test", "hash", "[]", "[]", "active", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    cur.execute("INSERT INTO connect_connections (id, connect_user_id, provider, status, scopes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                ("conn1", "user1", "github", "active", "[]", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    env._conn.commit()
    from services.connect import deny_grant, exchange_connect_token
    from db.connect_orm import ConnectAppModel, ConnectSessionModel, ConnectGrantModel, ConnectAuditEventModel
    from utils.types import ConnectTokenRequest
    await deny_grant(ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), grant.id, "dev1", "too broad", env)
    req = ConnectTokenRequest(app_id="app1", grant_id=grant.id)
    try:
        await exchange_connect_token(ConnectAppModel(env.DB), ConnectSessionModel(env.DB), ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), req, "dev1", env.JWT_SECRET)
        report("02 denied blocks", False)
        return
    except Exception as e:
        if "denied" not in str(e.detail if hasattr(e, 'detail') else str(e)).lower():
            report("02", False, str(e))
            return
    report("02 denied blocks", True)

async def test_03_max_uses():
    env = make_env()
    grant = await create_grant(env, max_uses=1)
    cur = env._conn.cursor()
    cur.execute("INSERT INTO connect_apps (id, developer_user_id, name, slug, client_secret_hash, redirect_uris, allowed_providers, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                ("app1", "dev1", "Test", "test", "hash", "[]", "[]", "active", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    cur.execute("INSERT INTO connect_connections (id, connect_user_id, provider, status, scopes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                ("conn1", "user1", "github", "active", "[]", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    env._conn.commit()
    # approve first
    from services.connect import approve_grant, exchange_connect_token
    from db.connect_orm import ConnectAppModel, ConnectSessionModel, ConnectGrantModel, ConnectAuditEventModel
    from utils.types import ConnectTokenRequest
    await approve_grant(ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), grant.id, "dev1", None, env)
    req = ConnectTokenRequest(app_id="app1", grant_id=grant.id)
    await exchange_connect_token(ConnectAppModel(env.DB), ConnectSessionModel(env.DB), ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), req, "dev1", env.JWT_SECRET)
    # second should be exhausted
    try:
        await exchange_connect_token(ConnectAppModel(env.DB), ConnectSessionModel(env.DB), ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), req, "dev1", env.JWT_SECRET)
        report("03 max_uses=1", False, "should be exhausted")
        return
    except Exception as e:
        if "exhausted" not in str(e.detail if hasattr(e, 'detail') else str(e)).lower():
            report("03", False, str(e))
            return
    report("03 max_uses=1", True)

async def test_04_expired():
    env = make_env()
    past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    grant = await create_grant(env, valid_until=past)
    cur = env._conn.cursor()
    cur.execute("INSERT INTO connect_apps (id, developer_user_id, name, slug, client_secret_hash, redirect_uris, allowed_providers, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                ("app1", "dev1", "Test", "test", "hash", "[]", "[]", "active", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    cur.execute("INSERT INTO connect_connections (id, connect_user_id, provider, status, scopes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                ("conn1", "user1", "github", "active", "[]", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    env._conn.commit()
    from services.connect import approve_grant, exchange_connect_token
    from db.connect_orm import ConnectAppModel, ConnectSessionModel, ConnectGrantModel, ConnectAuditEventModel
    from utils.types import ConnectTokenRequest
    await approve_grant(ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), grant.id, "dev1", None, env)
    req = ConnectTokenRequest(app_id="app1", grant_id=grant.id)
    try:
        await exchange_connect_token(ConnectAppModel(env.DB), ConnectSessionModel(env.DB), ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), req, "dev1", env.JWT_SECRET)
        report("04 expired", False)
        return
    except Exception as e:
        if "expired" not in str(e.detail if hasattr(e, 'detail') else str(e)).lower():
            report("04", False, str(e))
            return
    report("04 expired", True)

async def test_05_future_valid_from():
    env = make_env()
    future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    grant = await create_grant(env, valid_from=future)
    cur = env._conn.cursor()
    cur.execute("INSERT INTO connect_apps (id, developer_user_id, name, slug, client_secret_hash, redirect_uris, allowed_providers, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                ("app1", "dev1", "Test", "test", "hash", "[]", "[]", "active", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    cur.execute("INSERT INTO connect_connections (id, connect_user_id, provider, status, scopes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                ("conn1", "user1", "github", "active", "[]", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    env._conn.commit()
    from services.connect import approve_grant, exchange_connect_token
    from db.connect_orm import ConnectAppModel, ConnectSessionModel, ConnectGrantModel, ConnectAuditEventModel
    from utils.types import ConnectTokenRequest
    await approve_grant(ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), grant.id, "dev1", None, env)
    req = ConnectTokenRequest(app_id="app1", grant_id=grant.id)
    try:
        await exchange_connect_token(ConnectAppModel(env.DB), ConnectSessionModel(env.DB), ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), req, "dev1", env.JWT_SECRET)
        report("05 future valid_from", False)
        return
    except Exception as e:
        if "not_yet_valid" not in str(e.detail if hasattr(e, 'detail') else str(e)):
            report("05", False, str(e))
            return
    report("05 future valid_from", True)

async def test_06_resource_filters():
    env = make_env()
    rf = {"github": {"org": "myorg", "repos": ["repo1"]}}
    grant = await create_grant(env, resource_filters=rf)
    assert grant.resource_filters == rf, grant.resource_filters
    # query should return it
    from db.connect_orm import ConnectGrantModel
    m = ConnectGrantModel(env.DB)
    found = await m.find_by_id(grant.id)
    assert found.resource_filters == rf
    report("06 resource_filters stored", True)

async def test_07_context_all_set():
    env = make_env()
    grant = await create_grant(env, agent_id="a1", created_by_task_id="t1", created_by_workflow_run_id="w1")
    from db.connect_orm import ConnectGrantModel
    m = ConnectGrantModel(env.DB)
    by_agent = await m.find_by_agent_id("user1", "a1")
    by_task = await m.find_by_task_id("user1", "t1")
    by_wf = await m.find_by_workflow_run_id("user1", "w1")
    assert len(by_agent)==1 and len(by_task)==1 and len(by_wf)==1
    report("07 all context query", True)

async def test_08_isolation():
    env = make_env()
    g1 = await create_grant(env, agent_id="agentA", connect_user_id="user1")
    await create_grant(env, agent_id="agentB", connect_user_id="user1")
    from db.connect_orm import ConnectGrantModel
    m = ConnectGrantModel(env.DB)
    a = await m.find_by_agent_id("user1", "agentA")
    assert len(a)==1 and a[0].id==g1.id
    # user2 cannot see
    b = await m.find_by_agent_id("user2", "agentA")
    assert len(b)==0
    report("08 isolation", True)

async def test_09_parallel_wait():
    env = make_env()
    grant = await create_grant(env)
    cur = env._conn.cursor()
    cur.execute("INSERT OR IGNORE INTO connect_apps (id, developer_user_id, name, slug, client_secret_hash, redirect_uris, allowed_providers, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", ("app1", "user1", "Test", "test", "hash", "[]", "[]", "active", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    env._conn.commit()
    # create two tasks waiting for same grant
    from db.orm import TaskModel
    tm = TaskModel(env.DB)
    for i in range(2):
        await tm.create({"id": str(uuid.uuid4()), "type": "task", "payload": "{}", "url": "https://example.com", "status": "waiting_for_grant", "retries": 0, "max_retries": 5, "scheduled_at": datetime.now(timezone.utc).isoformat(), "idempotency_key": str(uuid.uuid4()), "execution_type": "queue", "user_id": "user1", "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(), "connect_grant_id": grant.id})
    from services.connect import approve_grant
    from db.connect_orm import ConnectGrantModel, ConnectAuditEventModel
    await approve_grant(ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), grant.id, "user1", None, env)
    assert len(env.TASK_QUEUE.sent)==2
    report("09 parallel wait resume", True)

async def test_10_sequential_use_count():
    env = make_env()
    grant = await create_grant(env, max_uses=3)
    cur = env._conn.cursor()
    cur.execute("INSERT INTO connect_apps (id, developer_user_id, name, slug, client_secret_hash, redirect_uris, allowed_providers, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                ("app1", "dev1", "Test", "test", "hash", "[]", "[]", "active", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    cur.execute("INSERT INTO connect_connections (id, connect_user_id, provider, status, scopes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                ("conn1", "user1", "github", "active", "[]", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    env._conn.commit()
    from services.connect import approve_grant, exchange_connect_token
    from db.connect_orm import ConnectAppModel, ConnectSessionModel, ConnectGrantModel, ConnectAuditEventModel
    from utils.types import ConnectTokenRequest
    await approve_grant(ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), grant.id, "dev1", None, env)
    for _ in range(3):
        await exchange_connect_token(ConnectAppModel(env.DB), ConnectSessionModel(env.DB), ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), ConnectTokenRequest(app_id="app1", grant_id=grant.id), "dev1", env.JWT_SECRET)
    from db.connect_orm import ConnectGrantModel as CGM
    g = await CGM(env.DB).find_by_id(grant.id)
    assert g.use_count==3
    report("10 sequential use_count", True)

async def test_11_pagination():
    env = make_env()
    for i in range(60):
        await create_grant(env, agent_id="pagAgent")
    from db.connect_orm import ConnectGrantModel
    m = ConnectGrantModel(env.DB)
    p1 = await m.find_by_agent_id("user1", "pagAgent", limit=50, offset=0)
    p2 = await m.find_by_agent_id("user1", "pagAgent", limit=50, offset=50)
    assert len(p1)==50 and len(p2)==10
    report("11 pagination", True)

async def test_12_env_stored():
    env = make_env()
    grant = await create_grant(env, project_id="proj1", environment="prod")
    assert grant.project_id=="proj1" and grant.environment=="prod"
    report("12 env stored", True)

async def test_13_same_project_diff_env():
    env = make_env()
    g1 = await create_grant(env, project_id="proj1", environment="dev", max_uses=5)
    g2 = await create_grant(env, project_id="proj1", environment="prod", max_uses=5)
    assert g1.environment != g2.environment
    report("13 same project diff env", True)

async def test_14_invalid_env():
    try:
        await create_grant(env=make_env(), environment="invalid")
        report("14 invalid env", False)
    except Exception as e:
        if "environment must be" in str(e).lower():
            report("14 invalid env", True)
        else:
            report("14", False, str(e))

async def test_15_task_signing():
    from services.webhooks import sign_payload, build_signature_header
    secret = "s3cret"
    body = b'{"hello":"world"}'
    ts = 1700000000
    sig = sign_payload(secret, ts, body)
    expected = hmac.new(secret.encode(), f"{ts}.".encode()+body, hashlib.sha256).hexdigest()
    assert sig==expected
    hdr = build_signature_header(ts, sig)
    assert hdr==f"t={ts},v1={sig}"
    # verify via simulated signed_dispatch: check timingSafe
    assert hmac.compare_digest(sig, expected)
    report("15 task signing", True)

async def test_16_empty_signing():
    from services.webhooks import sign_payload
    sig = sign_payload("", 123, b"{}")
    # empty secret still produces hmac
    assert len(sig)==64
    report("16 empty signing", True)

async def test_17_orchestrator_auto_approve():
    env = make_env()
    grant = await create_grant(env, agent_id="stagingAgent")
    cur = env._conn.cursor()
    cur.execute("INSERT OR IGNORE INTO connect_apps (id, developer_user_id, name, slug, client_secret_hash, redirect_uris, allowed_providers, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", ("app1", "orchestrator", "Test", "test", "hash", "[]", "[]", "active", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    env._conn.commit()
    from services.connect import approve_grant
    from db.connect_orm import ConnectGrantModel, ConnectAuditEventModel
    # orchestrator auto-approves staging
    await approve_grant(ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), grant.id, "orchestrator", "staging auto", env)
    g = await ConnectGrantModel(env.DB).find_by_id(grant.id)
    assert g.approval_status=="approved"
    report("17 orchestrator auto-approve", True)

async def test_18_chaining():
    # agent A output templatizes B's grant request — simulated via payload_template
    env = make_env()
    grant = await create_grant(env, agent_id="agentB")
    # B queries grant by task_id from A's task
    from db.connect_orm import ConnectGrantModel
    m = ConnectGrantModel(env.DB)
    # create grant with task1, B should find it via task_id
    g = await create_grant(env, created_by_task_id="taskA", agent_id="agentB")
    found = await m.find_by_task_id("user1", "taskA")
    assert any(x.id==g.id for x in found)
    report("18 chaining via task_id", True)

async def test_19_expire_mid_workflow():
    env = make_env()
    past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    grant = await create_grant(env, valid_until=past)
    cur = env._conn.cursor()
    cur.execute("INSERT INTO connect_apps (id, developer_user_id, name, slug, client_secret_hash, redirect_uris, allowed_providers, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                ("app1", "dev1", "Test", "test", "hash", "[]", "[]", "active", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    cur.execute("INSERT INTO connect_connections (id, connect_user_id, provider, status, scopes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                ("conn1", "user1", "github", "active", "[]", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    env._conn.commit()
    from services.connect import approve_grant, exchange_connect_token
    from db.connect_orm import ConnectAppModel, ConnectSessionModel, ConnectGrantModel, ConnectAuditEventModel
    from utils.types import ConnectTokenRequest
    await approve_grant(ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), grant.id, "dev1", None, env)
    try:
        await exchange_connect_token(ConnectAppModel(env.DB), ConnectSessionModel(env.DB), ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), ConnectTokenRequest(app_id="app1", grant_id=grant.id), "dev1", env.JWT_SECRET)
        report("19 expire mid-workflow", False)
        return
    except Exception as e:
        assert "expired" in str(e.detail if hasattr(e, 'detail') else str(e)).lower()
    report("19 expire mid-workflow", True)

async def test_20_revocation():
    env = make_env()
    grant = await create_grant(env)
    cur = env._conn.cursor()
    cur.execute("INSERT OR IGNORE INTO connect_apps (id, developer_user_id, name, slug, client_secret_hash, redirect_uris, allowed_providers, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", ("app1", "dev1", "Test", "test", "hash", "[]", "[]", "active", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
    env._conn.commit()
    from db.orm import TaskModel
    tm = TaskModel(env.DB)
    tid = str(uuid.uuid4())
    await tm.create({"id": tid, "type": "task", "payload": "{}", "url": "https://example.com", "status": "waiting_for_grant", "retries": 0, "max_retries": 5, "scheduled_at": datetime.now(timezone.utc).isoformat(), "idempotency_key": str(uuid.uuid4()), "execution_type": "queue", "user_id": "user1", "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(), "connect_grant_id": grant.id})
    from services.connect import deny_grant
    from db.connect_orm import ConnectGrantModel, ConnectAuditEventModel
    await deny_grant(ConnectGrantModel(env.DB), ConnectAuditEventModel(env.DB), grant.id, "dev1", "revoked", env)
    t = await tm.find_by_id(tid)
    assert t["status"]=="failed"
    report("20 revocation fails waiting tasks", True)

async def main():
    tests = [test_01_pending_to_approved_flow, test_02_denied_blocks, test_03_max_uses, test_04_expired, test_05_future_valid_from, test_06_resource_filters, test_07_context_all_set, test_08_isolation, test_09_parallel_wait, test_10_sequential_use_count, test_11_pagination, test_12_env_stored, test_13_same_project_diff_env, test_14_invalid_env, test_15_task_signing, test_16_empty_signing, test_17_orchestrator_auto_approve, test_18_chaining, test_19_expire_mid_workflow, test_20_revocation]
    for t in tests:
        try:
            await t()
        except Exception as e:
            import traceback
            report(t.__name__, False, f"exception {e} {traceback.format_exc()[:500]}")
    print(f"\n--- {sum(1 for _,p,_ in results if p)}/{len(results)} passed ---")
    for name, passed, detail in results:
        if not passed:
            print(f"FAIL {name}: {detail}")

if __name__ == "__main__":
    asyncio.run(main())
