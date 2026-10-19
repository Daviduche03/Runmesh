"""Seed a Runmesh instance with realistic demo data.

    uv run python scripts/seed_demo.py [path/to/runmesh.db]

Fills users, workspaces, agents, connect apps/users/connections, grants,
policy rules, policy decisions, agent runs, agent events, audit events and
tasks — enough that every dashboard screen has something real in it. Used to
capture product screenshots for the landing page.
"""

import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timedelta, timezone

DB = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DB_PATH", "runmesh.db")
HERE = os.path.dirname(os.path.abspath(__file__))

USER_ID = "usr_demo_0000000000000001"
WORKSPACE_ID = "wsp_demo_000000000000001"
APP_ID = "app_demo_00000000000001"
NOW = datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def ago(**kw) -> str:
    return iso(NOW - timedelta(**kw))


def ahead(**kw) -> str:
    return iso(NOW + timedelta(**kw))


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def main() -> None:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # Idempotent: clear the demo tables first so re-runs don't accumulate.
    for t in ["agent_events", "agent_runs", "connect_audit_events", "connect_grants",
              "policy_decisions", "policy_rules", "tasks", "agents", "connect_app_users",
              "connect_identities", "connect_connections", "connect_users", "connect_apps",
              "workspace_members", "workspaces", "users"]:
        c.execute(f"DELETE FROM {t}")

    c.execute("INSERT OR REPLACE INTO users (id, name, email, password, created_at, updated_at) VALUES (?,?,?,?,?,?)",
              (USER_ID, "Ada Okonkwo", "ada@acme.dev", "!", ago(days=200), ago(days=1)))

    c.execute(
        "INSERT OR REPLACE INTO workspaces (id, name, owner_user_id, status, created_at, updated_at, type, slug, plan, seats)"
        " VALUES (?,?,?,?,?,?,?,?,?,?)",
        (WORKSPACE_ID, "Acme", USER_ID, "active", ago(days=200), ago(days=1), "work", "acme", "pro", 12),
    )
    c.execute("INSERT OR REPLACE INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)",
              (uid("wsm"), WORKSPACE_ID, USER_ID, "owner", ago(days=200), ago(days=1)))

    # ── connect app + end users ─────────────────────────────────────────
    c.execute(
        "INSERT OR REPLACE INTO connect_apps (id, developer_user_id, name, slug, client_secret_hash, redirect_uris,"
        " allowed_providers, status, created_at, updated_at, workspace_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (APP_ID, USER_ID, "Acme Support", "acme-support", "hash", json.dumps(["http://localhost:5173/connect/callback"]),
         json.dumps(["github", "google", "slack", "notion", "gmail"]), "active", ago(days=180), ago(days=2), WORKSPACE_ID),
    )

    people = [
        ("Maya Lindqvist", "maya@northwind.io", "Northwind", "github"),
        ("Dev Patel", "dev@helios.dev", "Helios", "google"),
        ("Sara Okonkwo", "sara@meridian.co", "Meridian", "slack"),
        ("Jonas Weber", "jonas@vela.app", "Vela", "notion"),
        ("Ruth Adeyemi", "ruth@brightlabs.ai", "Brightlabs", "github"),
        ("Tomás Ferreira", "tomas@crestline.io", "Crestline", "google"),
        ("Ingrid Halvorsen", "ingrid@northgate.se", "Northgate", "github"),
        ("Priyanka Rao", "priyanka@quillhq.in", "Quill", "notion"),
    ]
    connect_users = []
    for name, email, account, provider in people:
        cu = uid("cus")
        conn_id = uid("con")
        connect_users.append((cu, name, email, account, provider, conn_id))
        c.execute(
            "INSERT OR REPLACE INTO connect_users (id, status, created_at, updated_at, primary_email, primary_email_verified)"
            " VALUES (?,?,?,?,?,?)",
            (cu, "active", ago(days=150), ago(days=1), email, 1),
        )
        c.execute(
            "INSERT OR REPLACE INTO connect_identities (id, connect_user_id, provider, provider_subject, email, email_verified,"
            " display_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (uid("cid"), cu, provider, f"{provider}:{account}", email, 1, name, ago(days=150), ago(days=1)),
        )
        c.execute(
            "INSERT OR REPLACE INTO connect_connections (id, connect_user_id, provider, status, scopes, access_token_enc,"
            " refresh_token_enc, token_expires_at, provider_account_id, provider_account_label, metadata, created_at, updated_at, workspace_id)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (conn_id, cu, provider, "active", json.dumps(["read", "write"]), "enc", "enc",
             ahead(days=45), f"{provider}-acct-{account.lower()}", account, json.dumps({"tier": "team"}),
             ago(days=150), ago(days=1), WORKSPACE_ID),
        )
        c.execute(
            "INSERT OR REPLACE INTO connect_app_users (id, connect_app_id, external_user_id, connect_user_id, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?)",
            (uid("cau"), APP_ID, f"ext_{account.lower()}", cu, ago(days=150), ago(days=1)),
        )

    # ── agents ─────────────────────────────────────────────────────────
    agents = [
        ("support-copilot", "Answers billing questions and drafts refunds", "active", "claude-sonnet-5", None),
        ("release-notes", "Turns merged PRs into customer-facing notes", "active", "gpt-5", None),
        ("triage-bot", "Triages inbound issues by severity", "active", "claude-haiku-4", None),
        ("cfo-approver", "Approves spend above $500", "active", "claude-opus-5", None),
        ("repo-watch", "Watches CI and opens issues on failure", "active", "gpt-5", None),
        ("docs-indexer", "Keeps the docs search index fresh", "suspended", "claude-sonnet-5", "Quarantined by policy: outside repo scope"),
    ]
    agent_ids = {}
    for name, desc, status, model, suspended_reason in agents:
        aid = uid("agt")
        agent_ids[name] = aid
        c.execute(
            "INSERT OR REPLACE INTO agents (id, workspace_id, user_id, name, description, status, project_id, environment,"
            " public_key, key_fingerprint, last_seen_at, metadata, created_at, updated_at, framework, model, version)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (aid, WORKSPACE_ID, USER_ID, name, desc, status, "acme", "prod" if status == "active" else "dev",
             f"ssh-ed25519 AAAAC3Nza{uid('k').replace('_', '')}", f"SHA256:{uuid.uuid4().hex[:43]}",
             ago(minutes=4) if status == "active" else ago(days=3),
             json.dumps({"runtime": "opencode", "region": "eu-west"}), ago(days=120), ago(minutes=4), "opencode", model, 3),
        )
        if suspended_reason:
            c.execute("UPDATE agents SET suspended_at = ?, suspended_reason = ? WHERE id = ?",
                      (ago(days=2), suspended_reason, aid))

    # ── policy rules ───────────────────────────────────────────────────
    rules = [
        ("Auto-approve read-only actions", "Any scope that cannot mutate state is allowed without a human.",
         "allow", "all scopes", "enforce", "reversible",
         [{"field": "action", "operator": "is", "value": "repo.read"}]),
        ("Escalate refunds over $100", "Refunds above $100 need a person in the loop.",
         "escalate", "payments.write", "enforce", "reversible",
         [{"field": "action", "operator": "contains", "value": "refund"}]),
        ("Require consent for new providers", "A connection to a provider the user has not linked before needs explicit consent.",
         "consent", "all scopes", "enforce", "reversible",
         [{"field": "scope", "operator": "contains", "value": "write"}]),
        ("Block production deletes", "Destructive production operations are denied outright.",
         "deny", "prod.*", "enforce", "irreversible",
         [{"field": "action", "operator": "contains", "value": "delete"}]),
        ("Watch spend on the CFO agent", "The CFO approver is logged for review but not auto-approved.",
         "escalate", "payments.write", "log-only", "reversible",
         [{"field": "agent", "operator": "is", "value": "cfo-approver"}]),
    ]
    rule_ids = []
    for i, (name, desc, action, scope, mode, rev, conditions) in enumerate(rules):
        rid = uid("pol")
        rule_ids.append(rid)
        c.execute(
            "INSERT OR REPLACE INTO policy_rules (id, workspace_id, priority, name, description, enabled, conditions,"
            " action, scope, mode, caps, reversibility, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (rid, WORKSPACE_ID, i + 1, name, desc, 1, json.dumps(conditions), action, scope, mode,
             json.dumps({"max_uses": 25, "ttl_minutes": 60}), rev, ago(days=60), ago(days=3)),
        )

    # ── grants ─────────────────────────────────────────────────────────
    grant_specs = [
        ("support-copilot", 0, ["repo.read", "issues.write"], "approved", "active", 12, 50, 45, "dev"),
        ("support-copilot", 1, ["calendar.read"], "approved", "active", 3, 20, 180, "prod"),
        ("triage-bot", 2, ["issues.write", "labels.write"], "pending_approval", "pending", 0, 10, 0, "prod"),
        ("release-notes", 3, ["repo.read", "pr.read"], "approved", "active", 41, 100, 12, "prod"),
        ("repo-watch", 4, ["repo.read", "actions.read"], "approved", "active", 88, 100, 6, "prod"),
        ("cfo-approver", 5, ["payments.write"], "pending_approval", "pending", 0, 5, 0, "prod"),
        ("docs-indexer", 6, ["notion.write"], "denied", "denied", 0, 5, 0, "dev"),
        ("support-copilot", 7, ["slack.write"], "approved", "expired", 25, 25, -30, "dev"),
    ]
    grant_ids = []
    for agent_name, person_idx, scopes, approval, status, uses, max_uses, ttl_days, env in grant_specs:
        cu, name, email, account, provider, conn_id = connect_users[person_idx]
        gid = uid("grn")
        grant_ids.append(gid)
        # `status` is the lifecycle (active|revoked); the UI status is derived
        # from approval_status + valid_until.
        c.execute(
            "INSERT OR REPLACE INTO connect_grants (id, connect_app_id, connect_user_id, connection_id, scopes, status,"
            " granted_at, created_at, updated_at, agent_id, approval_status, valid_from, valid_until, resource_filters,"
            " max_uses, use_count, project_id, environment, workspace_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (gid, APP_ID, cu, conn_id, json.dumps(scopes), "revoked" if status == "revoked" else "active",
             ago(days=20), ago(days=20), ago(hours=3), agent_ids[agent_name], approval,
             ago(days=20), ahead(days=ttl_days) if ttl_days else None,
             json.dumps({"repos": ["acme/platform"]}), max_uses, uses, "acme", env, WORKSPACE_ID),
        )

    # ── agent runs + events ────────────────────────────────────────────
    # Threads group an agent session; runs and tasks hang off them so the
    # audit ledger can chain every event back to a human.
    THREADS = ["th_9f2ac4", "th_7c11be", "th_4b83d2", "th_2e04a7"]
    run_specs = [
        ("support-copilot", "completed", THREADS[0], "Answer billing question for Northwind", 1),
        ("release-notes", "completed", THREADS[1], "Draft release notes for v2.4", 2),
        ("triage-bot", "running", THREADS[2], "Triage 12 new issues", 3),
        ("repo-watch", "failed", THREADS[3], "Watch CI on acme/platform", 4),
        ("support-copilot", "completed", THREADS[0], "Draft a refund for order #A-1183", 6),
    ]
    run_ids = []
    for i, (agent_name, status, thread, inp, hours) in enumerate(run_specs):
        rid = uid("run")
        run_ids.append(rid)
        c.execute(
            "INSERT OR REPLACE INTO agent_runs (id, workspace_id, agent_id, status, input, usage, started_at, finished_at,"
            " created_at, updated_at, thread_id, connect_user_id, mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (rid, WORKSPACE_ID, agent_ids[agent_name], status, inp,
             json.dumps({"input_tokens": 4200 + i * 900, "output_tokens": 800 + i * 210}),
             ago(hours=hours), ago(hours=hours) if status != "running" else None,
             ago(hours=hours), ago(hours=hours - 1), thread, connect_users[i % len(connect_users)][0], "delegated"),
        )
        events = [
            ("tool.call", "github.list_issues", json.dumps({"repo": "acme/platform", "state": "open"}), json.dumps({"count": 12})),
            ("tool.result", "github.list_issues", json.dumps({"repo": "acme/platform"}), json.dumps({"count": 12})),
            ("tool.call", "github.create_comment", json.dumps({"repo": "acme/platform", "body": "Drafted reply"}), json.dumps({"id": 99121})),
            ("tool.result", "github.create_comment", json.dumps({"repo": "acme/platform"}), json.dumps({"id": 99121})),
        ]
        for seq, (kind, name, args, result) in enumerate(events):
            c.execute(
                "INSERT OR REPLACE INTO agent_events (id, workspace_id, run_id, seq, kind, name, args, result, truncated,"
                " duration_ms, created_at, connect_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (uid("evt"), WORKSPACE_ID, rid, seq, kind, name, args, result or "{}", 0,
                 120 + seq * 45, ago(hours=hours, minutes=-seq), connect_users[i % len(connect_users)][0]),
            )

    # ── tasks ──────────────────────────────────────────────────────────
    task_specs = [
        ("Post weekly changelog to #general", "completed", "slack.chat.postMessage", THREADS[0], 0),
        ("Open issue for failing build #4417", "completed", "github.createIssue", THREADS[3], 1),
        ("Refund order #A-1183", "pending", "stripe.refunds.create", THREADS[0], 2),
        ("Sync docs index", "queued", "notion.pages.update", THREADS[2], 3),
        ("Post release notes for v2.4", "completed", "github.createRelease", THREADS[1], 4),
        ("Escalate Q3 spend report", "running", "policy.evaluate", THREADS[2], 5),
        ("Rotate signing secret", "failed", "runmesh.webhooks.rotate", THREADS[3], 6),
        ("Archive stale issues", "completed", "github.lockIssue", THREADS[1], 7),
    ]
    task_ids = []
    for i, (name, status, tool, thread, agent_idx) in enumerate(task_specs):
        tid = uid("tsk")
        task_ids.append(tid)
        c.execute(
            "INSERT OR REPLACE INTO tasks (id, type, payload, url, status, retries, max_retries, scheduled_at,"
            " idempotency_key, execution_type, created_at, updated_at, user_id, action_kind, action_name, agent_id,"
            " thread_id, tool_name, actor_user_id, approval_status, connect_app_id, connect_grant_id, workspace_id, metadata)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (tid, "http", json.dumps({"name": name, "tool": tool}),
             "https://api.github.com/repos/acme/platform/issues", status, 0, 3,
             ago(hours=i * 3 + 1), f"idem_{uid('k')}", "http", ago(hours=i * 3 + 1), ago(hours=i * 3), USER_ID,
             "tool_call" if tool != "policy.evaluate" else "policy",
             name, agent_ids[["support-copilot", "release-notes", "support-copilot", "docs-indexer",
                              "release-notes", "cfo-approver", "repo-watch", "triage-bot"][i]],
             thread, tool, USER_ID,
             "pending" if status == "pending" else "not_required",
             APP_ID, grant_ids[i % len(grant_ids)], WORKSPACE_ID, json.dumps({"duration_ms": 240 + i * 30})),
        )

    # ── policy decisions ───────────────────────────────────────────────
    decision_specs = [
        ("allow", "Auto-approve read-only actions", grant_ids[0], 0, "grant"),
        ("allow", "Auto-approve read-only actions", grant_ids[3], 1, "grant"),
        ("escalate", "Escalate refunds over $100", grant_ids[2], 4, "grant"),
        ("consent", "Require consent for new providers", grant_ids[5], 2, "grant"),
        ("deny", "Block production deletes", None, 3, "tool_call"),
    ]
    decision_ids = []
    for i, (decision, rule_name, grant_id, run_idx, source) in enumerate(decision_specs):
        did = uid("dec")
        decision_ids.append(did)
        c.execute(
            "INSERT OR REPLACE INTO policy_decisions (id, workspace_id, rule_id, decision, mode, enforced,"
            " default_applied, action, scope, resource, agent_id, agent_label, connect_user_id, user_label, source,"
            " grant_id, reason, created_at, enforcement, run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (did, WORKSPACE_ID, rule_ids[["allow", "allow", "escalate", "consent", "deny"].index(decision)],
             decision, "enforce", 1, 0, decision, "all scopes", "acme/platform",
             agent_ids["support-copilot"], "support-copilot", connect_users[0][0], "maya@northwind.io",
             source, grant_id, rule_name,
             ago(hours=2, minutes=i * 7), "cooperative", run_ids[run_idx]),
        )

    # ── audit events ───────────────────────────────────────────────────
    # Every row points at a real task, run or decision so the ledger chains
    # back to a thread and a human. Event types and actor types must match
    # the enums in utils/types_enums.py; `result` must be success/denied/
    # failed for the UI outcome to read right.
    audit_specs = [
        ("connect.grant.created", "app", "support-copilot", 0, "grn", "success", None, 0),
        ("policy.decision", "system", "support-copilot", 0, "dec", "success", "Auto-approve read-only actions", 0),
        ("agent.run.finished", "app", "support-copilot", 0, "task", "success", None, 0),
        ("connect.grant.created", "app", "release-notes", 4, "task", "success", None, 0),
        ("agent.run.finished", "app", "release-notes", 4, "task", "success", None, 0),
        ("policy.decision", "system", "cfo-approver", 2, "dec", "success", "Escalate refunds over $100", 1),
        ("connect.grant.created", "app", "triage-bot", 3, "task", "success", None, 1),
        ("policy.decision", "system", "triage-bot", 4, "dec", "denied", "Block production deletes", 0),
        ("agent.run.finished", "app", "repo-watch", 1, "task", "failed", "GitHub API returned 502", 0),
        ("connect.grant.revoked", "developer", "docs-indexer", 6, "grn", "denied", "Quarantined by policy: outside repo scope", 0),
    ]
    for i, (etype, actor_type, agent_name, ref_idx, rtype, outcome, reason, needs_approval) in enumerate(audit_specs):
        person = connect_users[i % len(connect_users)]
        metadata = {"scope": "read", "repo": "acme/platform"}
        if rtype == "dec":
            did = decision_ids[ref_idx]
            metadata = {"decision_id": did, "decision": outcome, "rule_name": reason, "source": "grant"}
            resource_id = did
        elif rtype == "task":
            resource_id = task_ids[ref_idx]
        else:
            resource_id = grant_ids[ref_idx]
        c.execute(
            "INSERT OR REPLACE INTO connect_audit_events (id, connect_user_id, connect_app_id, event_type, actor_type,"
            " actor_id, resource_type, resource_id, metadata, created_at, agent_id, task_id, approval_required,"
            " denial_reason, token_issued_at, token_expires_at, result, error_code, error_message, request_id, workspace_id)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (uid("aud"), person[0], APP_ID, etype, actor_type, agent_ids[agent_name],
             rtype, resource_id, json.dumps(metadata),
             ago(hours=i * 2 + 1), agent_ids[agent_name],
             task_ids[ref_idx] if rtype == "task" else None,
             needs_approval, reason if outcome in ("denied", "revoked") else None,
             ago(hours=i * 2 + 1) if etype == "connect.grant.created" else None,
             ahead(hours=6) if etype == "connect.grant.created" else None,
             outcome, "upstream_error" if outcome == "failed" else None,
             "GitHub API returned 502" if outcome == "failed" else None,
             f"req_{uuid.uuid4().hex[:10]}", WORKSPACE_ID),
        )

    conn.commit()
    counts = {}
    for t in ["users", "workspaces", "agents", "connect_grants", "connect_audit_events",
              "policy_rules", "policy_decisions", "agent_runs", "agent_events", "tasks"]:
        counts[t] = c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    print("seeded:", json.dumps(counts, indent=2))
    print(f"\nUSER_ID={USER_ID}\nWORKSPACE_ID={WORKSPACE_ID}\nAPP_ID={APP_ID}")
    conn.close()


if __name__ == "__main__":
    main()
