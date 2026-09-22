"""Policy rules: prose in, Rego out. Evaluation and issuance enforcement.

Rules are workspace-scoped, ordered (first match wins), and stored as JSON
conditions. The compiled Rego artifact is generated on read. Enforcement runs
at grant issuance: the engine decides before a grant is minted, and every
decision is written to ``policy_decisions`` so oversight metrics are real.

The action identity is server-derived (see ``policy_engine.build_action_identity``).
Requests never supply the label used for a security decision.
"""

import json
import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from db.orm import Model
from utils.responses import success
from services.workspaces import resolve_workspace_id
from services.connect_common import _audit
from services import policy_engine as engine
from utils.connect_providers import list_providers_catalog
from services.policy_engine import (
    POLICY_ACTIONS,
    POLICY_FIELDS,
    POLICY_MODES,
    POLICY_OPERATORS,
    POLICY_REVERSIBILITY,
    change_hint,
    evaluate,
)
from utils.types import (
    ConnectAuditActorType,
    ConnectAuditEventType,
    ConnectResourceType,
)

POLICY_NAME_MAX = 80
POLICY_DESCRIPTION_MAX = 500
DECISION_SCAN_LIMIT = 5000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _parse_json_list(value, field: str) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=500, detail=f"Stored {field} is not valid JSON")
    if not isinstance(parsed, list):
        raise HTTPException(status_code=500, detail=f"Stored {field} is not a list")
    return parsed


def _parse_json_dict(value, field: str) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=500, detail=f"Stored {field} is not valid JSON")
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=500, detail=f"Stored {field} is not an object")
    return parsed


def _validate_conditions(raw) -> list:
    conditions = _parse_json_list(raw, "conditions") if not isinstance(raw, list) else raw
    cleaned = []
    for condition in conditions:
        if isinstance(condition, dict):
            field = str(condition.get("field") or "action")
            operator = str(condition.get("operator") or "is")
            value = str(condition.get("value") or "")
        else:
            field, operator, value = "action", "is", ""
        if field not in POLICY_FIELDS:
            raise HTTPException(status_code=400, detail=f"Condition field must be one of: {', '.join(POLICY_FIELDS)}")
        if operator not in POLICY_OPERATORS:
            raise HTTPException(status_code=400, detail=f"Condition operator must be one of: {', '.join(POLICY_OPERATORS)}")
        cleaned.append({"field": field, "operator": operator, "value": value})
    return cleaned


def rule_rego(rule: dict) -> str:
    """Compile stored conditions to the Rego artifact. Mirrors lib/policy.ts."""
    op_map = {"is": "==", "is not": "!=", ">": ">", "<": "<", "contains": "contains"}
    clauses = []
    for condition in _parse_json_list(rule.get("conditions"), "conditions"):
        field = condition.get("field") or "action"
        operator = condition.get("operator") or "is"
        value = condition.get("value") or ""
        target = "input.tool.name" if field == "action" else f"input.{field}"
        op = op_map.get(operator, "==")
        if op == "contains":
            clauses.append(f"  contains({target}, {json.dumps(value)})")
        elif re.fullmatch(r"-?\d+(\.\d+)?", value):
            clauses.append(f"  {target} {op} {value}")
        else:
            clauses.append(f"  {target} {op} {json.dumps(value)}")
    body = "\n".join(clauses)
    return (
        "package runmesh.policy\n\n"
        "import rego.v1\n\n"
        'default decision := {"decision": "deny", "reason": "no rule matched"}\n\n'
        f"# {rule.get('priority')} · {rule.get('name')}\n"
        f'decision := {{"decision": {json.dumps(rule.get("action"))}}} if {{\n'
        f"{body}\n"
        "}\n"
    )


def _base_rule(row: dict) -> dict:
    """Rule shape the engine consumes: no metrics, no compiled artifact."""
    return {
        "id": row["id"],
        "priority": row["priority"],
        "name": row.get("name") or "",
        "description": row.get("description") or "",
        "enabled": bool(row.get("enabled")),
        "conditions": _parse_json_list(row.get("conditions"), "conditions"),
        "action": row.get("action") or "escalate",
        "scope": row.get("scope") or "all scopes",
        "mode": row.get("mode") or "log-only",
        "caps": _parse_json_dict(row.get("caps"), "caps"),
        "reversibility": row.get("reversibility") or "reversible",
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def serialize_rule(row: dict, metrics: dict | None = None) -> dict:
    rule = _base_rule(row)
    rule.update(metrics or {
        "decided": 0,
        "escalated": 0,
        "approvals": 0,
        "rejections": 0,
        "medianReviewMs": 0,
    })
    rule["rego"] = rule_rego(row)
    return rule


async def _audited(db, user_id: str, workspace_id: str, rule_id: str, change: str) -> None:
    from db.connect_orm import ConnectAuditEventModel

    await _audit(
        ConnectAuditEventModel(db),
        event_type=ConnectAuditEventType.POLICY_UPDATED,
        actor_type=ConnectAuditActorType.CONNECT_USER,
        actor_id=user_id,
        resource_type=ConnectResourceType.CONNECT_POLICY,
        resource_id=rule_id,
        result="success",
        workspace_id=workspace_id,
        metadata={"change": change},
    )


async def _rule_metrics(model: Model, workspace_id: str) -> dict:
    """Oversight per rule, from real decisions and the grants they produced."""
    decisions = await model.find_many(
        "policy_decisions", "workspace_id = ?", workspace_id, limit=DECISION_SCAN_LIMIT
    )
    grants = await model.find_many(
        "connect_grants", "workspace_id = ?", workspace_id, limit=DECISION_SCAN_LIMIT
    )
    grant_state = {
        g["id"]: (g.get("approval_status"), g.get("updated_at"))
        for g in grants
        if g.get("id")
    }
    buckets: dict[str, dict] = {}
    for decision in decisions:
        rule_id = decision.get("rule_id")
        if not rule_id:
            continue
        bucket = buckets.setdefault(
            rule_id,
            {"decided": 0, "escalated": 0, "approvals": 0, "rejections": 0, "latencies": []},
        )
        if decision.get("enforced"):
            bucket["decided"] += 1
            if decision.get("decision") in ("escalate", "consent"):
                bucket["escalated"] += 1
        grant_id = decision.get("grant_id")
        state = grant_state.get(grant_id) if grant_id else None
        if not state:
            continue
        status, updated = state
        if status == "approved":
            bucket["approvals"] += 1
        elif status == "denied":
            bucket["rejections"] += 1
        else:
            continue
        if updated and decision.get("created_at"):
            try:
                delta = (_parse_iso(updated) - _parse_iso(decision["created_at"])).total_seconds() * 1000
                if delta >= 0:
                    bucket["latencies"].append(delta)
            except (ValueError, TypeError):
                pass
    out = {}
    for rule_id, bucket in buckets.items():
        latencies = sorted(bucket["latencies"])
        out[rule_id] = {
            "decided": bucket["decided"],
            "escalated": bucket["escalated"],
            "approvals": bucket["approvals"],
            "rejections": bucket["rejections"],
            "medianReviewMs": round(latencies[len(latencies) // 2]) if latencies else 0,
        }
    return out


async def list_rules(db, user_id: str, workspace_id: str) -> dict:
    model = Model(db)
    workspace_id = await resolve_workspace_id(model.db, user_id, workspace_id)
    rows = await model.find_many(
        "policy_rules", "workspace_id = ? ORDER BY priority ASC", workspace_id
    )
    metrics = await _rule_metrics(model, workspace_id)
    rules = [serialize_rule(row, metrics.get(row["id"])) for row in rows]
    return success(rules, meta={"total": len(rules)})


async def create_rule(db, user_id: str, workspace_id: str, req) -> dict:
    name = (req.name or "").strip()
    if not name or len(name) > POLICY_NAME_MAX:
        raise HTTPException(status_code=400, detail="Rule name is required (1-80 characters)")
    description = (req.description or "").strip()
    if len(description) > POLICY_DESCRIPTION_MAX:
        raise HTTPException(status_code=400, detail="Description must be under 500 characters")
    if req.action not in POLICY_ACTIONS:
        raise HTTPException(status_code=400, detail="Action must be allow, escalate, consent, or deny")
    if req.mode not in POLICY_MODES:
        raise HTTPException(status_code=400, detail="Mode must be enforce or log-only")
    if req.reversibility not in POLICY_REVERSIBILITY:
        raise HTTPException(status_code=400, detail="Reversibility must be reversible, undoable, or irreversible")
    conditions = _validate_conditions([c.model_dump() for c in (req.conditions or [])])

    model = Model(db)
    workspace_id = await resolve_workspace_id(model.db, user_id, workspace_id)
    existing = await model.find_many("policy_rules", "workspace_id = ?", workspace_id)
    priority = max([row["priority"] for row in existing], default=0) + 1

    now = _now()
    rule_id = f"pol_{uuid.uuid4().hex[:12]}"
    await model.insert(
        "policy_rules",
        {
            "id": rule_id,
            "workspace_id": workspace_id,
            "priority": priority,
            "name": name,
            "description": description,
            "enabled": 1 if req.enabled else 0,
            "conditions": json.dumps(conditions),
            "action": req.action,
            "scope": (req.scope or "all scopes").strip() or "all scopes",
            "mode": req.mode,
            "caps": json.dumps(req.caps or {}),
            "reversibility": req.reversibility,
            "created_at": now,
            "updated_at": now,
        },
    )
    await _audited(db, user_id, workspace_id, rule_id, f"Created rule '{name}'.")
    row = await model.find_one("policy_rules", "id = ?", rule_id)
    return success(serialize_rule(row), message="Policy rule created")


async def _get_owned_rule(model: Model, user_id: str, workspace_id: str, rule_id: str) -> dict:
    workspace_id = await resolve_workspace_id(model.db, user_id, workspace_id)
    row = await model.find_one(
        "policy_rules", "id = ? AND workspace_id = ?", rule_id, workspace_id
    )
    if row is None:
        # 404 either way: never confirm whether an id exists elsewhere.
        raise HTTPException(status_code=404, detail="Policy rule not found")
    return row


async def update_rule(db, user_id: str, workspace_id: str, rule_id: str, req) -> dict:
    model = Model(db)
    row = await _get_owned_rule(model, user_id, workspace_id, rule_id)
    updates: dict = {}
    if req.name is not None:
        name = req.name.strip()
        if not name or len(name) > POLICY_NAME_MAX:
            raise HTTPException(status_code=400, detail="Rule name is required (1-80 characters)")
        updates["name"] = name
    if req.description is not None:
        description = req.description.strip()
        if len(description) > POLICY_DESCRIPTION_MAX:
            raise HTTPException(status_code=400, detail="Description must be under 500 characters")
        updates["description"] = description
    if req.enabled is not None:
        updates["enabled"] = 1 if req.enabled else 0
    if req.conditions is not None:
        updates["conditions"] = json.dumps(
            _validate_conditions([c.model_dump() for c in req.conditions])
        )
    if req.action is not None:
        if req.action not in POLICY_ACTIONS:
            raise HTTPException(status_code=400, detail="Action must be allow, escalate, consent, or deny")
        updates["action"] = req.action
    if req.scope is not None:
        updates["scope"] = req.scope.strip() or "all scopes"
    if req.mode is not None:
        if req.mode not in POLICY_MODES:
            raise HTTPException(status_code=400, detail="Mode must be enforce or log-only")
        updates["mode"] = req.mode
    if req.caps is not None:
        updates["caps"] = json.dumps(req.caps)
    if req.reversibility is not None:
        if req.reversibility not in POLICY_REVERSIBILITY:
            raise HTTPException(status_code=400, detail="Reversibility must be reversible, undoable, or irreversible")
        updates["reversibility"] = req.reversibility
    if not updates:
        return success(serialize_rule(row))
    updates["updated_at"] = _now()
    await model.update("policy_rules", "id = ?", updates, rule_id)
    await _audited(db, user_id, row["workspace_id"], rule_id, f"Updated rule '{row['name']}'.")
    updated = await model.find_one("policy_rules", "id = ?", rule_id)
    return success(serialize_rule(updated), message="Policy rule updated")


async def delete_rule(db, user_id: str, workspace_id: str, rule_id: str) -> dict:
    model = Model(db)
    row = await _get_owned_rule(model, user_id, workspace_id, rule_id)
    await model.delete("policy_rules", "id = ?", rule_id)
    # Close the gap: renumber survivors so priority stays dense (first match wins).
    survivors = await model.find_many(
        "policy_rules", "workspace_id = ? ORDER BY priority ASC", row["workspace_id"]
    )
    for index, survivor in enumerate(survivors, start=1):
        if survivor["priority"] != index:
            await model.update(
                "policy_rules", "id = ?", {"priority": index, "updated_at": _now()}, survivor["id"]
            )
    await _audited(db, user_id, row["workspace_id"], rule_id, f"Deleted rule '{row['name']}'.")
    return success({"id": rule_id}, message="Policy rule deleted")


async def reorder_rules(db, user_id: str, workspace_id: str, ids: list) -> dict:
    model = Model(db)
    workspace_id = await resolve_workspace_id(model.db, user_id, workspace_id)
    rows = await model.find_many("policy_rules", "workspace_id = ?", workspace_id)
    current = {row["id"] for row in rows}
    if set(ids) != current or len(ids) != len(current):
        raise HTTPException(
            status_code=400,
            detail="ids must contain exactly the workspace's rule ids, in the new order",
        )
    # Distinct negative temps first: UNIQUE(workspace_id, priority) forbids swaps in place.
    for temp, rule_id in enumerate(ids, start=1):
        await model.update("policy_rules", "id = ?", {"priority": -temp, "updated_at": _now()}, rule_id)
    for index, rule_id in enumerate(ids, start=1):
        await model.update(
            "policy_rules", "id = ?", {"priority": index, "updated_at": _now()}, rule_id
        )
    await _audited(db, user_id, workspace_id, ids[0] if ids else "-", "Reordered rules.")
    ordered = await model.find_many(
        "policy_rules", "workspace_id = ? ORDER BY priority ASC", workspace_id
    )
    return success([serialize_rule(row) for row in ordered], message="Policy rules reordered")


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------


# Strictest wins when several candidates are evaluated (deny > escalate/consent > allow).
_DECISION_RANK = {"deny": 3, "escalate": 2, "consent": 2, "allow": 0}


async def _load_rules(db, workspace_id: str) -> tuple[list, bool]:
    """Rules in priority order, plus whether any enabled enforce rule exists.

    ``configured`` gates default-deny: a workspace that has not opted into
    policy keeps working exactly as before.
    """
    model = Model(db)
    rows = await model.find_many(
        "policy_rules", "workspace_id = ? ORDER BY priority ASC", workspace_id
    )
    rules = [_base_rule(row) for row in rows]
    enforcing = [
        rule for rule in rules
        if rule.get("enabled") and (rule.get("mode") or "enforce") == "enforce"
    ]
    return rules, len(enforcing) > 0


async def evaluate_workspace(db, workspace_id: str, context: dict) -> dict:
    """Load the workspace's rules and evaluate them against a verified context."""
    rules, configured = await _load_rules(db, workspace_id)
    result = evaluate(rules, context)
    result["configured"] = configured
    return result


async def evaluate_capabilities(rules: list, context: dict, candidates: list) -> tuple[dict, dict]:
    """Evaluate a request whose capability is one of several candidates.

    At issuance a grant requests a *set* of scopes, and the provider is the
    connection. So the capability being decided is the provider plus each
    requested scope. Rules that match any candidate decide; when none match,
    the provider candidate's result governs (which preserves default-deny and
    coarse provider-level rules). Returns ``(winning_context, result)``.
    """
    ordered: list[str] = []
    for candidate in candidates:
        value = str(candidate or "").strip()
        if value and value not in ordered:
            ordered.append(value)
    if not ordered:
        ordered = [context.get("action") or ""]

    evaluations: list[tuple[dict, dict]] = []
    for candidate in ordered:
        candidate_context = dict(context)
        candidate_context["action"] = candidate
        evaluations.append((candidate_context, evaluate(rules, candidate_context)))

    settled = [pair for pair in evaluations if pair[1]["settled"]]
    pool = settled or [evaluations[0]]
    return max(pool, key=lambda pair: _DECISION_RANK.get(pair[1]["decision"], 0))


async def record_decision(
    db,
    *,
    workspace_id: str,
    rule_id: str | None,
    decision: str,
    mode: str,
    enforced: bool,
    default_applied: bool,
    context: dict,
    agent_id: str | None = None,
    agent_label: str = "",
    connect_user_id: str | None = None,
    user_label: str = "",
    source: str = "grant",
    grant_id: str | None = None,
    reason: str = "",
    enforcement: str = "cooperative",
    run_id: str | None = None,
) -> str:
    model = Model(db)
    decision_id = f"pdec_{uuid.uuid4().hex[:12]}"
    await model.insert(
        "policy_decisions",
        {
            "id": decision_id,
            "workspace_id": workspace_id,
            "rule_id": rule_id,
            "decision": decision,
            "mode": mode,
            "enforced": 1 if enforced else 0,
            "default_applied": 1 if default_applied else 0,
            "enforcement": enforcement,
            "action": context.get("action") or "",
            "scope": context.get("scope") or "",
            "resource": context.get("resource") or "",
            "agent_id": agent_id,
            "agent_label": agent_label or "",
            "connect_user_id": connect_user_id,
            "user_label": user_label or "",
            "source": source,
            "grant_id": grant_id,
            "reason": reason,
            "run_id": run_id,
            "created_at": _now(),
        },
    )
    return decision_id


def _decision_reason(decision: str, rule: dict | None, default_applied: bool, configured: bool) -> str:
    if not configured:
        return "No enforcing rule configured; issuance proceeds."
    if default_applied:
        return "No enabled rule matched and policy is on; blocked by default."
    if rule is None:
        return f"Policy decided {decision}."
    name = rule.get("name") or rule.get("id")
    if decision == "deny":
        return f"{name} denies this."
    if decision == "escalate":
        return f"{name} requires a human before this runs."
    if decision == "consent":
        return f"{name} requires user consent."
    return f"{name} allows this."


async def enforce_grant_issuance(
    db,
    *,
    workspace_id: str,
    provider: str | None,
    scopes,
    resource: str = "",
    agent_id: str | None = None,
    agent_label: str = "",
    connect_user_id: str | None = None,
    user_label: str = "",
    source: str = "grant",
    restrictive: bool = False,
    grant_id: str | None = None,
    action_override: str | None = None,
    enforcement: str = "cooperative",
    run_id: str | None = None,
    strict_record: bool = True,
) -> dict:
    """Evaluate policy at issuance or on a tool call, and record every decision.

    Full mode (``restrictive=False``) applies the whole mapping: allow →
    auto-approve, escalate/consent → pending, deny → block. Restrictive mode
    (the consent path) only blocks an explicit enforced deny — the end user's
    act is the authority there, so policy may forbid but never auto-approve.

    ``action_override`` carries the registry-derived action on the call path;
    it is server-owned (from the tool row), never a caller-supplied string.

    With ``strict_record=False`` the ledger writes (decision rows, audit) are
    best-effort: a recording failure is flagged in ``ledger_ok`` but never
    vetoes the decision itself. The ledger must not stop an allowed call.
    """
    context = engine.build_grant_context(
        provider=provider,
        scopes=scopes,
        resource=resource,
        agent=agent_label,
        user=user_label,
    )
    rules, configured = await _load_rules(db, workspace_id)
    if action_override:
        # Call path: the capability is exactly the registered tool action.
        context["action"] = action_override
        candidates = [action_override]
    else:
        # Issuance: the capability is the provider, or a requested scope
        # qualified as `provider.scope` (`google.gmail.send`) — the same
        # vocabulary tool actions use, so one rule fires at both tiers. Bare
        # scopes stay as aliases so rules written before qualification keep
        # matching.
        provider_action = context["action"]
        clean_scopes = [str(s).strip() for s in (scopes or []) if str(s).strip()]
        qualified = [f"{provider_action}.{s}" for s in clean_scopes] if provider_action else []
        candidates = [provider_action, *qualified, *clean_scopes]
    context, result = await evaluate_capabilities(rules, context, candidates)

    if not configured:
        decision, rule, enforced, default_applied, mode = "allow", None, False, False, "none"
    else:
        decision = result["decision"]
        rule = result["rule"]
        enforced = True
        default_applied = bool(result["default_applied"])
        mode = "enforce" if result["settled"] else "none"

    # Restrictive (consent) path: only a settled enforce deny blocks.
    blocks = enforced and decision == "deny" and (result["settled"] or not restrictive)

    ledger_ok = True

    async def _kept(coro):
        """Ledger writes must never veto a decision. Returns False when dropped."""
        nonlocal ledger_ok
        try:
            return await coro
        except HTTPException:
            raise
        except Exception:
            if strict_record:
                raise
            ledger_ok = False
            return None

    for shadow in result["shadowed"]:
        await _kept(record_decision(
            db,
            workspace_id=workspace_id,
            rule_id=shadow.get("id"),
            decision=shadow.get("action") or "allow",
            mode="log-only",
            enforced=False,
            default_applied=False,
            context=context,
            agent_id=agent_id,
            agent_label=agent_label,
            connect_user_id=connect_user_id,
            user_label=user_label,
            source=source,
            grant_id=grant_id,
            reason=f"{shadow.get('name')} would have {shadow.get('action')}ed.",
            enforcement=enforcement,
            run_id=run_id,
        ))

    reason = _decision_reason(decision, rule, default_applied, configured)
    decision_id = await _kept(record_decision(
        db,
        workspace_id=workspace_id,
        rule_id=(rule or {}).get("id"),
        decision=decision,
        mode=mode,
        enforced=enforced,
        default_applied=default_applied,
        context=context,
        agent_id=agent_id,
        agent_label=agent_label,
        connect_user_id=connect_user_id,
        user_label=user_label,
        source=source,
        grant_id=grant_id,
        reason=reason,
        enforcement=enforcement,
        run_id=run_id,
    ))

    if enforced:
        from db.connect_orm import ConnectAuditEventModel

        await _kept(_audit(
            ConnectAuditEventModel(db),
            event_type=ConnectAuditEventType.POLICY_DECISION,
            actor_type=ConnectAuditActorType.SYSTEM,
            actor_id=agent_id or connect_user_id or "policy",
            connect_user_id=connect_user_id,
            resource_type=(
                ConnectResourceType.CONNECT_GRANT if grant_id else ConnectResourceType.CONNECT_POLICY
            ),
            resource_id=grant_id or (rule or {}).get("id") or "",
            agent_id=agent_id,
            result="denied" if decision == "deny" else "success",
            workspace_id=workspace_id,
            metadata={
                "decision": decision,
                "decision_id": decision_id,
                "rule_id": (rule or {}).get("id"),
                "rule_name": (rule or {}).get("name"),
                "action": context["action"],
                "scope": context["scope"],
                "source": source,
                "default_applied": default_applied,
            },
        ))

    return {
        "decision": decision,
        "rule": rule,
        "enforced": enforced,
        "default_applied": default_applied,
        "configured": configured,
        "blocks": blocks,
        "reason": reason,
        "context": context,
        "decision_id": decision_id,
        "ledger_ok": ledger_ok,
    }


async def evaluate_request(db, user_id: str, workspace_id: str, req) -> dict:
    """Dry-run. Walks rules in priority order, first match wins, unmatched
    falls to default-deny. No side effects — this simulates, it does not
    enforce, and its action comes from the caller on purpose."""
    model = Model(db)
    workspace_id = await resolve_workspace_id(model.db, user_id, workspace_id)
    rows = await model.find_many(
        "policy_rules", "workspace_id = ? ORDER BY priority ASC", workspace_id
    )
    rules = [_base_rule(row) for row in rows]
    context = {
        "action": req.action,
        "agent": req.agent,
        "scope": "",
        "resource": req.resource,
        "user": req.user,
        "amount": req.amount,
        "time": "",
    }
    result = evaluate(rules, context)
    decision = result["decision"]
    matched = result["rule"]
    if matched is None:
        return success({
            "decision": "deny",
            "rule": None,
            "reason": f"No rule matched. {req.action} falls to the default (deny).",
            "steps": result["steps"],
            "changeHint": change_hint("deny", None, req.amount),
        })
    first = (matched.get("conditions") or [{}])[0]
    reason = (
        f"{matched['name']} denies this unconditionally."
        if decision == "deny"
        else f"{matched['name']} matched on {first.get('field')} {first.get('operator')} {first.get('value')}."
    )
    return success({
        "decision": decision,
        "rule": {"id": matched["id"], "priority": matched["priority"], "name": matched["name"]},
        "reason": reason,
        "steps": result["steps"],
        "changeHint": change_hint(decision, matched, req.amount),
    })


async def coverage_gaps(db, user_id: str, workspace_id: str) -> dict:
    """Actions that were requested, matched no rule, and fell to the default.

    Default-deny makes these invisible at the point of refusal; the decision
    ledger is the only place they survive. Grouped by action so an operator can
    see what is asking for a rule.
    """
    model = Model(db)
    workspace_id = await resolve_workspace_id(model.db, user_id, workspace_id)
    rows = await model.find_many(
        "policy_decisions",
        "workspace_id = ? AND default_applied = 1 ORDER BY created_at DESC",
        workspace_id,
    )
    grouped: dict[str, dict] = {}
    for row in rows:
        action = (row.get("action") or "").strip() or "(unnamed action)"
        entry = grouped.setdefault(
            action,
            {"action": action, "blocked": 0, "agents": [], "lastSeen": ""},
        )
        entry["blocked"] += 1
        label = (row.get("agent_label") or "").strip()
        if label and label not in entry["agents"]:
            entry["agents"].append(label)
        created = row.get("created_at") or ""
        if created > entry["lastSeen"]:
            entry["lastSeen"] = created
    gaps = sorted(grouped.values(), key=lambda gap: gap["blocked"], reverse=True)
    return success({"gaps": gaps, "total": len(rows)})


async def capability_matrix(db, user_id: str, workspace_id: str) -> dict:
    """Resolved decision per agent per known action, from the current rules.

    Evaluated with resource, user and amount unset, so a rule conditioned on
    those fields will not match here — this projects the rules, it does not
    replay traffic. ``configured`` is false when no enforcing rule exists, in
    which case nothing is gated and every cell is the default.
    """
    model = Model(db)
    workspace_id = await resolve_workspace_id(model.db, user_id, workspace_id)
    rule_rows = await model.find_many(
        "policy_rules", "workspace_id = ? ORDER BY priority ASC", workspace_id
    )
    rules = [_base_rule(row) for row in rule_rows]
    configured = any(
        rule.get("enabled") and (rule.get("mode") or "enforce") == "enforce"
        for rule in rules
    )

    agent_rows = await model.find_many(
        "agents", "workspace_id = ? ORDER BY name ASC", workspace_id
    )
    agents = [
        {"id": row["id"], "name": row.get("name") or row["id"]} for row in agent_rows
    ]

    actions: list[str] = [provider["id"] for provider in list_providers_catalog()]
    tool_rows = await model.find_many(
        "tools", "workspace_id = ? ORDER BY name ASC", workspace_id
    )
    for row in tool_rows:
        action = (row.get("action") or "").strip()
        if action and action not in actions:
            actions.append(action)

    matrix = []
    for action in actions:
        cells = {}
        for agent in agents:
            # The engine matches on the agent label, so evaluate by name even
            # though cells are keyed by id (names are not unique).
            result = evaluate(
                rules,
                {
                    "action": action,
                    "agent": agent["name"],
                    "scope": "",
                    "resource": "",
                    "user": "",
                    "amount": "",
                    "time": "",
                },
            )
            matched = result["rule"]
            cells[agent["id"]] = {
                "decision": result["decision"] if configured else "allow",
                "rule": (matched or {}).get("name"),
                "default": bool(result["default_applied"]) if configured else False,
            }
        matrix.append({"action": action, "cells": cells})

    return success({"agents": agents, "matrix": matrix, "configured": configured})
