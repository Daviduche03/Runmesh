"""
Policy enforcement tests — evaluation at grant issuance, decision log, metrics.
Run: uv run --no-sync python tests/test_policy_enforcement.py
"""
import asyncio
import json
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
    cur.execute("INSERT INTO workspaces VALUES (?,?,?,?,?,?,?)", ("ws_1", "Acme", "u_1", "active", "{}", NOW, NOW))
    cur.execute("INSERT INTO workspace_members VALUES (?,?,?,?,?,?)", ("wsm_1", "ws_1", "u_1", "owner", NOW, NOW))
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


def make_rule(name="Rule", action="deny", field="action", value="github",
              mode="enforce", enabled=True):
    from utils.types import PolicyConditionInput, PolicyRuleCreateRequest

    return PolicyRuleCreateRequest(
        name=name,
        conditions=[PolicyConditionInput(field=field, operator="is", value=value)],
        action=action,
        mode=mode,
        enabled=enabled,
    )


def grant_models(db):
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


async def test_01_no_policy_allows():
    from services import connect_grants as grants
    from utils.types import GrantCreateRequest

    db = make_env()
    grant_model, conn_model, user_model, audit_model = grant_models(db)
    body = await grants.create_grant(
        grant_model, conn_model, user_model, audit_model, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", agent_id="ag_1", scopes=["repo"],
                           approval_status="pending_approval"),
    )
    assert body["data"]["status"] == "pending", body["data"]
    decisions = await grant_model.find_many("policy_decisions", "workspace_id = ?", "ws_1")
    assert len(decisions) == 1 and decisions[0]["enforced"] == 0, decisions
    assert decisions[0]["decision"] == "allow" and decisions[0]["mode"] == "none"
    assert decisions[0]["action"] == "github", decisions[0]
    report("01 no policy configured allows", True, decisions[0]["id"])


async def test_02_enforce_deny_blocks():
    from services import connect_grants as grants
    from services import policies as policies_service
    from utils.types import GrantCreateRequest

    db = make_env()
    await policies_service.create_rule(db, "u_1", "ws_1", make_rule(name="No GitHub", action="deny"))
    grant_model, conn_model, user_model, audit_model = grant_models(db)

    blocked, exc = await run_expect(
        grants.create_grant(
            grant_model, conn_model, user_model, audit_model, "u_1", "ws_1",
            GrantCreateRequest(connection_id="conn_1", scopes=["repo"]),
        ),
        403,
    )
    assert blocked, "enforced deny must block issuance"
    assert "No GitHub" in exc.detail and "denies" in exc.detail, exc.detail

    grants_count = await grant_model.find_many("connect_grants", "workspace_id = ?", "ws_1")
    assert grants_count == [], "denied grant must not be created"

    decisions = await grant_model.find_many("policy_decisions", "workspace_id = ?", "ws_1")
    assert len(decisions) == 1 and decisions[0]["enforced"] == 1, decisions
    assert decisions[0]["decision"] == "deny" and decisions[0]["rule_id"].startswith("pol_")
    assert decisions[0]["grant_id"] is None

    audits = await audit_model.find_many(
        "connect_audit_events", "event_type = ? AND workspace_id = ?", "policy.decision", "ws_1"
    )
    assert len(audits) == 1 and audits[0]["result"] == "denied", audits
    report("02 enforced deny blocks + audits", True)


async def test_03_allow_and_escalate_mapping():
    from services import connect_grants as grants
    from services import policies as policies_service
    from utils.types import GrantCreateRequest

    db = make_env()
    await policies_service.create_rule(db, "u_1", "ws_1", make_rule(name="Auto", action="allow"))
    grant_model, conn_model, user_model, audit_model = grant_models(db)
    allowed = await grants.create_grant(
        grant_model, conn_model, user_model, audit_model, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", scopes=["repo"], approval_status="pending_approval"),
    )
    assert allowed["data"]["status"] == "active", allowed["data"]
    assert allowed["data"]["approval_status"] == "approved", allowed["data"]

    db2 = make_env()
    await policies_service.create_rule(db2, "u_1", "ws_1", make_rule(name="Ask", action="escalate"))
    g2, c2, u2, a2 = grant_models(db2)
    escalated = await grants.create_grant(
        g2, c2, u2, a2, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", scopes=["repo"], approval_status="approved"),
    )
    assert escalated["data"]["approval_status"] == "pending_approval", escalated["data"]
    report("03 allow auto-approves, escalate pends", True)


async def test_04_log_only_is_shadow():
    from services import connect_grants as grants
    from services import policies as policies_service
    from utils.types import GrantCreateRequest

    db = make_env()
    await policies_service.create_rule(
        db, "u_1", "ws_1", make_rule(name="Watch", action="deny", mode="log-only")
    )
    grant_model, conn_model, user_model, audit_model = grant_models(db)
    body = await grants.create_grant(
        grant_model, conn_model, user_model, audit_model, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", scopes=["repo"], approval_status="approved"),
    )
    assert body["data"]["approval_status"] == "approved", "log-only must not block or change"
    decisions = await grant_model.find_many("policy_decisions", "workspace_id = ?", "ws_1")
    assert len(decisions) == 2, decisions
    shadow = [d for d in decisions if d["mode"] == "log-only"]
    effective = [d for d in decisions if d["mode"] != "log-only"]
    assert len(shadow) == 1 and shadow[0]["enforced"] == 0 and shadow[0]["decision"] == "deny"
    assert len(effective) == 1 and effective[0]["decision"] == "allow", effective
    report("04 log-only records shadow, never enforces", True)


async def test_05_default_deny_once_configured():
    from services import connect_grants as grants
    from services import policies as policies_service
    from utils.types import GrantCreateRequest

    db = make_env()
    await policies_service.create_rule(
        db, "u_1", "ws_1", make_rule(name="Stripe only", action="allow", value="stripe")
    )
    grant_model, conn_model, user_model, audit_model = grant_models(db)
    blocked, _ = await run_expect(
        grants.create_grant(
            grant_model, conn_model, user_model, audit_model, "u_1", "ws_1",
            GrantCreateRequest(connection_id="conn_1", scopes=["repo"]),
        ),
        403,
    )
    assert blocked, "unmatched action must hit default deny once policy is configured"
    decisions = await grant_model.find_many("policy_decisions", "workspace_id = ?", "ws_1")
    assert decisions[0]["default_applied"] == 1 and decisions[0]["rule_id"] is None, decisions
    report("05 default deny applies when configured", True)


async def test_06_consent_path_restrictive():
    from services import connect_grants as grants
    from services import policies as policies_service
    from db.connect_orm import ConnectGrantModel

    db = make_env()
    await policies_service.create_rule(db, "u_1", "ws_1", make_rule(name="No GitHub", action="deny"))
    grant_model = ConnectGrantModel(db)
    blocked, _ = await run_expect(
        grants._ensure_grant(
            grant_model, connect_app_id=None, connect_user_id="cu_1",
            connection_id="conn_1", scopes=["repo"], workspace_id="ws_1",
        ),
        403,
    )
    assert blocked, "restrictive mode must block an explicit enforced deny"

    db2 = make_env()
    await policies_service.create_rule(
        db2, "u_1", "ws_1", make_rule(name="Ask", action="escalate")
    )
    g2 = ConnectGrantModel(db2)
    grant_id = await grants._ensure_grant(
        g2, connect_app_id=None, connect_user_id="cu_1",
        connection_id="conn_1", scopes=["repo"], workspace_id="ws_1",
    )
    assert grant_id, "restrictive mode must not block non-deny decisions"
    decisions = await g2.find_many("policy_decisions", "workspace_id = ?", "ws_1")
    assert decisions[0]["grant_id"] == grant_id, decisions[0]
    report("06 consent path blocks deny only", True)


async def test_07_metrics_from_decisions():
    from services import connect_grants as grants
    from services import policies as policies_service

    db = make_env()
    created = await policies_service.create_rule(db, "u_1", "ws_1", make_rule(name="Ask", action="escalate"))
    rule_id = created["data"]["id"]
    grant_model, conn_model, user_model, audit_model = grant_models(db)
    from utils.types import GrantCreateRequest

    granted = await grants.create_grant(
        grant_model, conn_model, user_model, audit_model, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", agent_id="ag_1", scopes=["repo"]),
    )
    await grants.approve_grant(
        grant_model, audit_model, granted["data"]["id"], "u_1", "looks fine"
    )
    body = await policies_service.list_rules(db, "u_1", "ws_1")
    rule = body["data"][0]
    assert rule["decided"] == 1, rule
    assert rule["escalated"] == 1, rule
    assert rule["approvals"] == 1, rule
    assert rule["medianReviewMs"] >= 0, rule
    report("07 oversight metrics from real decisions", True,
           f"decided={rule['decided']} escalated={rule['escalated']} approvals={rule['approvals']}")


async def test_08_action_identity_is_server_derived():
    from services.policy_engine import build_action_identity, build_grant_context
    from utils.types import GrantCreateRequest

    assert "action" not in GrantCreateRequest.model_fields, "requests must not name their action"
    context = build_grant_context(provider="GitHub", scopes=["Repo", "repo", "Issues"])
    assert context["action"] == "github", context
    assert context["scope"] == "issues, repo", context
    assert build_action_identity(None) == ""
    report("08 action identity derived, not supplied", True)


async def test_09_scope_rule_fires_at_issuance():
    from services import connect_grants as grants
    from services import policies as policies_service
    from utils.types import GrantCreateRequest, PolicyConditionInput, PolicyRuleCreateRequest

    def rule(name, value, action):
        return PolicyRuleCreateRequest(
            name=name,
            conditions=[PolicyConditionInput(field="action", operator="is", value=value)],
            action=action, mode="enforce", enabled=True,
        )

    # A provider-level allow plus a *qualified* capability deny. The
    # capability rule must win.
    db = make_env()
    await policies_service.create_rule(db, "u_1", "ws_1", rule("Allow github", "github", "allow"))
    await policies_service.create_rule(db, "u_1", "ws_1", rule("No repo capability", "github.repo", "deny"))
    g, c, u, a = grant_models(db)
    blocked, _ = await run_expect(grants.create_grant(
        g, c, u, a, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", scopes=["repo"])), 403)
    assert blocked, "a qualified capability rule must fire at issuance"

    # Bare scopes remain valid aliases for rules written before qualification.
    db_alias = make_env()
    await policies_service.create_rule(db_alias, "u_1", "ws_1", rule("Allow github", "github", "allow"))
    await policies_service.create_rule(db_alias, "u_1", "ws_1", rule("No bare repo", "repo", "deny"))
    ga, ca, ua, aa = grant_models(db_alias)
    blocked_alias, _ = await run_expect(grants.create_grant(
        ga, ca, ua, aa, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", scopes=["repo"])), 403)
    assert blocked_alias, "a bare scope rule must still match"

    # A capability with no matching rule leaves the provider rule to govern.
    db2 = make_env()
    await policies_service.create_rule(db2, "u_1", "ws_1", rule("Allow github", "github", "allow"))
    await policies_service.create_rule(db2, "u_1", "ws_1", rule("No repo capability", "github.repo", "deny"))
    g2, c2, u2, a2 = grant_models(db2)
    allowed = await grants.create_grant(
        g2, c2, u2, a2, "u_1", "ws_1",
        GrantCreateRequest(connection_id="conn_1", scopes=["issues"]))
    assert allowed["data"]["approval_status"] == "approved", allowed["data"]
    report("09 qualified capability rules fire at issuance", True)


async def main():
    await test_01_no_policy_allows()
    await test_02_enforce_deny_blocks()
    await test_03_allow_and_escalate_mapping()
    await test_04_log_only_is_shadow()
    await test_05_default_deny_once_configured()
    await test_06_consent_path_restrictive()
    await test_07_metrics_from_decisions()
    await test_08_action_identity_is_server_derived()
    await test_09_scope_rule_fires_at_issuance()
    failed = [name for name, passed, _ in results if not passed]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed:
        raise SystemExit(f"FAILED: {failed}")


if __name__ == "__main__":
    asyncio.run(main())
