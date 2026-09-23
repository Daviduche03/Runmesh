import json
from datetime import datetime, timedelta, timezone

from db.connect_orm import (
    ConnectAuditEventModel,
    ConnectGrantModel,
)
from db.orm import Model
from utils.responses import success
from utils.types import ConnectAuditEventType

from services.connect_common import (
    CONNECT_LATENCY,
    CONNECT_METRICS,
)

INTERACTIVE_EVENTS = frozenset({
    "connect.grant.approved",
    "connect.grant.denied",
})


def _event_ui_type(event_type: str) -> str:
    if event_type in ("connect.grant.approved", "connect.grant.denied"):
        return "approval"
    if event_type.startswith("connect.grant."):
        return "grant"
    if event_type.startswith("connect.token."):
        return "token"
    if event_type.startswith("connect.session.") or event_type.startswith("connect.connection."):
        return "consent"
    if event_type.startswith("agent.run."):
        return "agent"
    if event_type.startswith("policy."):
        return "policy"
    return "system"


def _event_outcome(event_type: str, result: str | None, error_code: str | None) -> str:
    if event_type.endswith(".denied") or (result or "success") == "denied":
        return "denied"
    if (result or "success") not in ("success",) or error_code:
        return "failed"
    return "success"


async def list_audit_events(
    audit_model: ConnectAuditEventModel,
    task_model,
    run_model,
    user_model,
    agent_model,
    workspace_id: str,
    event_type: str | None = None,
    connect_user_id: str | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    rows, total = await audit_model.list_all(
        workspace_id,
        event_type=event_type,
        connect_user_id=connect_user_id,
        search=search,
        limit=limit,
        offset=offset,
    )

    user_labels: dict[str, str] = {}
    for user_id in {r.connect_user_id for r in rows if r.connect_user_id}:
        user = await user_model.find_by_id(user_id)
        if user is not None and user.primary_email:
            user_labels[user_id] = user.primary_email

    agent_names: dict[str, str] = {}
    for agent_id in {r.agent_id for r in rows if r.agent_id}:
        agent = await agent_model.find_one("agents", "id = ?", agent_id)
        if agent is not None:
            agent_names[agent_id] = agent.get("name") or agent_id

    thread_ids: dict[str, str | None] = {}
    for task_id in {r.task_id for r in rows if r.task_id}:
        task = await task_model.find_by_id(task_id)
        thread_ids[task_id] = task.get("thread_id") if task else None
    for run_id in {r.workflow_run_id for r in rows if r.workflow_run_id}:
        run = await run_model.find_by_id(run_id)
        thread_ids[run_id] = run.get("thread_id") if run else None

    def _resource_name(value) -> str:
        return str(getattr(value, "value", value) or "")

    def _metadata_dict(value) -> dict:
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except (TypeError, ValueError):
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    # Agent runs are traces too: a run lifecycle event chains to its run,
    # and the run carries the thread. Without this, everything the wrapper
    # and policy engine write lands in "unchained".
    runs = Model(task_model.db)
    agent_run_threads: dict[str, str | None] = {}
    agent_run_ids = {
        r.resource_id for r in rows
        if _resource_name(r.resource_type) == "agent_run" and r.resource_id
    }
    for rid in agent_run_ids:
        arow = await runs.find_one("agent_runs", "id = ? AND workspace_id = ?", rid, workspace_id)
        if arow is not None:
            agent_run_threads[rid] = arow.get("thread_id")

    # Call-time policy decisions chain through the decision's run.
    decision_threads: dict[str, str | None] = {}
    decision_ids = set()
    for r in rows:
        if r.event_type == "policy.decision":
            did = _metadata_dict(r.metadata).get("decision_id")
            if did:
                decision_ids.add(did)
    decision_runs: dict[str, str | None] = {}
    decision_reasons: dict[str, str | None] = {}
    if decision_ids:
        placeholders = ", ".join("?" for _ in decision_ids)
        for drow in await runs.find_many("policy_decisions", f"id IN ({placeholders})", *decision_ids):
            if drow.get("run_id"):
                decision_runs[drow["id"]] = drow["run_id"]
            if drow.get("reason"):
                decision_reasons[drow["id"]] = drow.get("reason")
    for run_id in set(decision_runs.values()):
        if run_id not in agent_run_threads:
            arow = await runs.find_one("agent_runs", "id = ? AND workspace_id = ?", run_id, workspace_id)
            if arow is not None:
                agent_run_threads[run_id] = arow.get("thread_id")
    for r in rows:
        if r.event_type == "policy.decision":
            did = _metadata_dict(r.metadata).get("decision_id")
            run_id = decision_runs.get(did) if did else None
            if run_id and run_id in agent_run_threads:
                decision_threads[r.id] = agent_run_threads[run_id]

    # Agent run telemetry (tool.call / tool.result) lives in agent_events,
    # not connect_audit_events — merge it so a run's steps appear in one trace.
    run_agent_ids: dict[str, str | None] = {}
    for rid in set(agent_run_threads) | set(decision_runs.values()):
        if rid and rid not in run_agent_ids:
            arow = await runs.find_one("agent_runs", "id = ? AND workspace_id = ?", rid, workspace_id)
            run_agent_ids[rid] = (arow.get("agent_id") if arow else None) or None
            if arow is not None and rid not in agent_run_threads:
                agent_run_threads[rid] = arow.get("thread_id")
    for agent_id in {aid for aid in run_agent_ids.values() if aid} - set(agent_names):
        agent = await agent_model.find_one("agents", "id = ?", agent_id)
        if agent is not None:
            agent_names[agent_id] = agent.get("name") or agent_id

    scoped_run_ids = sorted({rid for rid in run_agent_ids if rid})
    agent_event_rows = []
    if scoped_run_ids:
        run_ph = ", ".join("?" for _ in scoped_run_ids)
        agent_event_rows = await runs.find_many(
            "agent_events",
            (
                f"workspace_id = ? AND run_id IN ({run_ph}) "
                "AND kind IN ('tool.call','tool.result','error','policy.decision') "
                "ORDER BY created_at ASC"
            ),
            workspace_id,
            *scoped_run_ids,
        )

    items = []
    for r in rows:
        actor_type = r.actor_type.value if hasattr(r.actor_type, 'value') else str(r.actor_type)
        if r.agent_id:
            ui_actor_type = "agent"
            actor = agent_names.get(r.agent_id, r.agent_id[:8])
        elif actor_type == "system":
            ui_actor_type = "system"
            actor = "system"
        elif r.connect_user_id and r.connect_user_id in user_labels:
            ui_actor_type = "operator"
            actor = user_labels[r.connect_user_id]
        else:
            ui_actor_type = "operator"
            actor = (r.actor_id or "")[:8] or "—"
        on_behalf_of = user_labels.get(r.connect_user_id) if r.connect_user_id else None
        trace_id = r.task_id or r.workflow_run_id
        thread_id = thread_ids.get(trace_id) if trace_id else None
        if trace_id is None and _resource_name(r.resource_type) == "agent_run" and r.resource_id in agent_run_threads:
            trace_id = r.resource_id
            thread_id = agent_run_threads[r.resource_id]
        meta = _metadata_dict(r.metadata)
        denial_reason = r.denial_reason
        if r.event_type == "policy.decision":
            did = meta.get("decision_id")
            decision_run = decision_runs.get(did) if did else None
            if trace_id is None and decision_run:
                trace_id = decision_run
            if thread_id is None and trace_id:
                thread_id = agent_run_threads.get(trace_id) or thread_ids.get(trace_id)
            if denial_reason is None and did and decision_reasons.get(did):
                denial_reason = decision_reasons[did]
            if denial_reason is None and meta.get("reason"):
                denial_reason = str(meta["reason"])
            if not meta.get("reason") and denial_reason:
                meta = {**meta, "reason": denial_reason}
        if thread_id is None:
            thread_id = decision_threads.get(r.id)
        items.append({
            "id": r.id,
            "event_type": r.event_type,
            "actor": actor,
            "actor_type": ui_actor_type,
            "on_behalf_of": on_behalf_of or "—",
            "mode": "interactive" if r.event_type in INTERACTIVE_EVENTS else "autonomous",
            "type": _event_ui_type(r.event_type),
            "authority": (r.resource_id or "")[:8] or "—",
            "outcome": _event_outcome(r.event_type, r.result, r.error_code),
            "trace_id": trace_id,
            "thread_id": thread_id,
            "agent_id": r.agent_id,
            "task_id": r.task_id,
            "workflow_run_id": r.workflow_run_id,
            "result": r.result,
            "denial_reason": denial_reason,
            "metadata": meta,
            "duration_ms": None,
            "created_at": r.created_at,
        })

    agent_event_type = {
        "tool.call": "tool",
        "tool.result": "tool",
        "error": "tool",
        "policy.decision": "policy",
    }
    for erow in agent_event_rows:
        rid = erow.get("run_id")
        kind = erow.get("kind") or "log"
        name = erow.get("name") or ""
        agent_id = run_agent_ids.get(rid)
        actor = agent_names.get(agent_id, (agent_id or "")[:8]) if agent_id else "agent"
        args_raw = _metadata_dict(erow.get("args")) if isinstance(erow.get("args"), (str, dict)) else {}
        result_raw = _metadata_dict(erow.get("result")) if isinstance(erow.get("result"), (str, dict)) else {}
        outcome = "failed" if kind == "error" else "success"
        if kind == "policy.decision":
            outcome = "denied" if (result_raw.get("decision") or result_raw.get("outcome")) == "deny" else "success"
        items.append({
            "id": erow.get("id"),
            "event_type": kind,
            "actor": actor,
            "actor_type": "agent",
            "on_behalf_of": "—",
            "mode": "autonomous",
            "type": agent_event_type.get(kind, "system"),
            "authority": "—",
            "outcome": outcome,
            "trace_id": rid,
            "thread_id": agent_run_threads.get(rid),
            "agent_id": agent_id,
            "task_id": None,
            "workflow_run_id": None,
            "result": erow.get("result"),
            "denial_reason": None,
            "metadata": {
                "kind": kind,
                "name": name,
                "seq": erow.get("seq"),
                "args": args_raw,
                "result": result_raw,
            },
            "duration_ms": erow.get("duration_ms"),
            "created_at": erow.get("created_at"),
        })

    def _created(value) -> str:
        return str(value or "")

    items.sort(key=lambda e: _created(e.get("created_at")))
    return success(
        items,
        meta={"total": total + len(agent_event_rows), "limit": limit, "offset": offset},
    )


# ============================================================================
# Agentic Connect Layer (P0/P1): Task-aware grants with approval gating
# ============================================================================


async def get_connect_metrics(env, user_id: str, workspace_id: str):
    """Workspace-scoped metrics: pending approvals and recent token requests."""
    from utils.responses import success
    from services.workspaces import require_membership

    await require_membership(env.DB, user_id, workspace_id)

    grant_model = ConnectGrantModel(env.DB)
    audit_model = ConnectAuditEventModel(env.DB)

    pending_count = await grant_model.count_by_workspace(workspace_id, ui_status="pending")

    # Count token exchange events in last 24 hours
    twenty_four_hours_ago = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

    token_events = await audit_model.find_token_exchanges(workspace_id, limit=1000)
    
    # Filter events from last 24 hours
    recent_tokens = [
        e for e in token_events 
        if e.created_at and e.created_at >= twenty_four_hours_ago
    ]
    
    p50 = sorted(CONNECT_LATENCY)[len(CONNECT_LATENCY)//2] if CONNECT_LATENCY else 0
    p99 = sorted(CONNECT_LATENCY)[int(len(CONNECT_LATENCY)*0.99)] if CONNECT_LATENCY else 0
    return success({
        "pending_approvals": pending_count,
        "token_requests_24h": len(recent_tokens),
        "metrics": dict(CONNECT_METRICS),
        "latency_p50_ms": round(p50*1000, 2),
        "latency_p99_ms": round(p99*1000, 2),
    })
