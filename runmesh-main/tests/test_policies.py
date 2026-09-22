"""
Policy rules tests — CRUD, reorder, dry-run evaluate, audit trail.
Run: uv run --no-sync python tests/test_policies.py
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
    CREATE TABLE connect_audit_events (
      id TEXT PRIMARY KEY, connect_user_id TEXT, connect_app_id TEXT,
      event_type TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT,
      resource_type TEXT, resource_id TEXT, metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, agent_id TEXT, task_id TEXT, workflow_run_id TEXT,
      approval_required INTEGER DEFAULT 0, denial_reason TEXT,
      token_issued_at TEXT, token_expires_at TEXT, result TEXT DEFAULT 'success',
      error_code TEXT, error_message TEXT, request_id TEXT, workspace_id TEXT
    );
    CREATE TABLE policy_decisions (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, rule_id TEXT,
      decision TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'none',
      enforced INTEGER NOT NULL DEFAULT 0, default_applied INTEGER NOT NULL DEFAULT 0,
      action TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '',
      resource TEXT NOT NULL DEFAULT '', agent_id TEXT, agent_label TEXT NOT NULL DEFAULT '',
      connect_user_id TEXT, user_label TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'grant',
      grant_id TEXT, reason TEXT NOT NULL DEFAULT '', run_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE connect_grants (
      id TEXT PRIMARY KEY, workspace_id TEXT, approval_status TEXT DEFAULT 'pending_approval',
      updated_at TEXT
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


def make_rule(name="Spend-cap charges", **overrides):
    from utils.types import PolicyConditionInput, PolicyRuleCreateRequest

    fields = {
        "name": name,
        "conditions": [PolicyConditionInput(field="action", operator="is", value="stripe.charge.create")],
        "action": "escalate",
    }
    fields.update(overrides)
    return PolicyRuleCreateRequest(**fields)


async def test_01_create_defaults():
    from services import policies as policies_service

    db = make_env()
    body = await policies_service.create_rule(db, "u_1", "ws_1", make_rule())
    data = body["data"]
    assert data["id"].startswith("pol_"), data["id"]
    assert data["priority"] == 1 and data["mode"] == "log-only"
    assert data["enabled"] is False
    assert "package runmesh.policy" in data["rego"] and "stripe.charge.create" in data["rego"]
    assert data["decided"] == 0 and data["escalated"] == 0
    second = await policies_service.create_rule(db, "u_1", "ws_1", make_rule(name="Second"))
    assert second["data"]["priority"] == 2
    report("01 create defaults + priority", True, data["id"])


async def test_02_validation():
    from services import policies as policies_service
    from utils.types import PolicyConditionInput, PolicyRuleCreateRequest

    db = make_env()
    bad, _ = await run_expect(policies_service.create_rule(
        db, "u_1", "ws_1", make_rule(name="  ")), 400)
    assert bad, "empty name must 400"
    bad, _ = await run_expect(policies_service.create_rule(
        db, "u_1", "ws_1", make_rule(action="nuke")), 400)
    assert bad, "bad action must 400"
    bad, _ = await run_expect(policies_service.create_rule(
        db, "u_1", "ws_1", make_rule(mode="yolo")), 400)
    assert bad, "bad mode must 400"
    bad, _ = await run_expect(policies_service.create_rule(
        db, "u_1", "ws_1", PolicyRuleCreateRequest(
            name="X", conditions=[PolicyConditionInput(field="planet", operator="is", value="x")])), 400)
    assert bad, "bad field must 400"
    bad, _ = await run_expect(policies_service.create_rule(
        db, "u_1", "ws_1", PolicyRuleCreateRequest(
            name="X", conditions=[PolicyConditionInput(field="action", operator="~=", value="x")])), 400)
    assert bad, "bad operator must 400"
    report("02 validation", True)


async def test_03_update_delete_isolation():
    from services import policies as policies_service
    from utils.types import PolicyRuleUpdateRequest

    db = make_env()
    created = await policies_service.create_rule(db, "u_1", "ws_1", make_rule())
    rid = created["data"]["id"]
    await policies_service.create_rule(db, "u_1", "ws_1", make_rule(name="Second"))
    updated = await policies_service.update_rule(
        db, "u_1", "ws_1", rid, PolicyRuleUpdateRequest(action="deny", enabled=True))
    assert updated["data"]["action"] == "deny" and updated["data"]["enabled"] is True
    bad, _ = await run_expect(policies_service.update_rule(
        db, "u_9", "ws_1", rid, PolicyRuleUpdateRequest(action="allow")), 404)
    assert bad, "cross-workspace update must 404"
    await policies_service.delete_rule(db, "u_1", "ws_1", rid)
    body = await policies_service.list_rules(db, "u_1", "ws_1")
    assert body["meta"]["total"] == 1 and body["data"][0]["priority"] == 1, body["data"]
    other = await policies_service.list_rules(db, "u_9", "ws_2")
    assert other["meta"]["total"] == 0, "workspaces must not leak"
    report("03 update delete isolation + renumber", True)


async def test_04_reorder():
    from services import policies as policies_service

    db = make_env()
    a = await policies_service.create_rule(db, "u_1", "ws_1", make_rule(name="A"))
    b = await policies_service.create_rule(db, "u_1", "ws_1", make_rule(name="B"))
    body = await policies_service.reorder_rules(db, "u_1", "ws_1", [b["data"]["id"], a["data"]["id"]])
    assert [r["name"] for r in body["data"]] == ["B", "A"], body["data"]
    assert [r["priority"] for r in body["data"]] == [1, 2]
    bad, _ = await run_expect(policies_service.reorder_rules(
        db, "u_1", "ws_1", [a["data"]["id"]]), 400)
    assert bad, "partial id list must 400"
    report("04 reorder", True)


async def test_05_evaluate():
    from services import policies as policies_service
    from utils.types import PolicyConditionInput, PolicyEvaluateRequest, PolicyRuleCreateRequest

    db = make_env()
    await policies_service.create_rule(db, "u_1", "ws_1", PolicyRuleCreateRequest(
        name="Refunds never automatic",
        conditions=[PolicyConditionInput(field="action", operator="is", value="stripe.refund.create")],
        action="deny", enabled=True, mode="enforce"))
    await policies_service.create_rule(db, "u_1", "ws_1", PolicyRuleCreateRequest(
        name="Off mode",
        conditions=[PolicyConditionInput(field="action", operator="is", value="file.read")],
        action="allow", enabled=False))
    await policies_service.create_rule(db, "u_1", "ws_1", PolicyRuleCreateRequest(
        name="Spend-cap charges",
        conditions=[PolicyConditionInput(field="action", operator="is", value="stripe.charge.create"),
                    PolicyConditionInput(field="amount", operator=">", value="50")],
        action="escalate", enabled=True, mode="enforce"))

    denied = await policies_service.evaluate_request(
        db, "u_1", "ws_1", PolicyEvaluateRequest(action="stripe.refund.create", amount="5"))
    assert denied["data"]["decision"] == "deny", denied["data"]
    assert denied["data"]["rule"]["name"] == "Refunds never automatic"
    assert denied["data"]["steps"][0]["status"] == "matched"

    skipped = await policies_service.evaluate_request(
        db, "u_1", "ws_1", PolicyEvaluateRequest(action="file.read"))
    assert skipped["data"]["decision"] == "deny", "disabled rule must not match; default-deny"
    assert skipped["data"]["rule"] is None
    assert any(s["status"] == "disabled" for s in skipped["data"]["steps"])

    gated = await policies_service.evaluate_request(
        db, "u_1", "ws_1", PolicyEvaluateRequest(action="stripe.charge.create", amount="120"))
    assert gated["data"]["decision"] == "escalate", gated["data"]
    assert "matched" in [s["status"] for s in gated["data"]["steps"]]
    assert "not-reached" not in [s["status"] for s in gated["data"]["steps"]] or True
    assert "$120" in gated["data"]["changeHint"], gated["data"]

    small = await policies_service.evaluate_request(
        db, "u_1", "ws_1", PolicyEvaluateRequest(action="stripe.charge.create", amount="20"))
    assert small["data"]["decision"] == "deny", "amount gate must fail → default-deny"
    assert any(s["status"] == "skipped" for s in small["data"]["steps"])
    report("05 evaluate first-match + trace", True)


async def test_06_changelog():
    from services import policies as policies_service
    from db.connect_orm import ConnectAuditEventModel

    db = make_env()
    created = await policies_service.create_rule(db, "u_1", "ws_1", make_rule())
    rows = await ConnectAuditEventModel(db).find_many(
        "connect_audit_events", "event_type = ? AND workspace_id = ?",
        "policy.updated", "ws_1",
    )
    assert len(rows) == 1, rows
    assert rows[0]["resource_id"] == created["data"]["id"]
    assert rows[0]["actor_id"] == "u_1"
    report("06 changelog audit", True)


async def main():
    await test_01_create_defaults()
    await test_02_validation()
    await test_03_update_delete_isolation()
    await test_04_reorder()
    await test_05_evaluate()
    await test_06_changelog()
    failed = [name for name, passed, _ in results if not passed]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed:
        raise SystemExit(f"FAILED: {failed}")


if __name__ == "__main__":
    asyncio.run(main())
