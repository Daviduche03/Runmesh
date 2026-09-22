import json

from fastapi import HTTPException

from db.connect_orm import (
    ConnectAuditEventModel,
    ConnectConnectionModel,
    ConnectGrantModel,
    ConnectUserModel,
)
from db.orm import Model
from utils.responses import success
from utils.types import (
    ConnectAuditActorType,
    ConnectAuditEventType,
    ConnectConnectionRow,
    ConnectGrantCreate,
    ConnectGrantRow,
    ConnectResourceType,
    utc_now_iso,
)

from services.connect_common import (
    _audit,
    _parse_grant_access_token,
    _seconds_until,
)

POLICY_APPROVAL_BY_DECISION = {
    "allow": "approved",
    "escalate": "pending_approval",
    "consent": "pending_approval",
}

GRANT_ENVIRONMENTS = ("dev", "staging", "prod")
GRANT_APPROVAL_STATES = ("pending_approval", "approved")
GRANT_UI_STATUSES = ("pending", "active", "expired", "revoked", "denied")


def _grant_ui_status(grant: ConnectGrantRow, now: str) -> str:
    status = grant.status.value if hasattr(grant.status, "value") else str(grant.status)
    if status == "revoked":
        return "revoked"
    if grant.approval_status == "denied":
        return "denied"
    if grant.approval_status == "pending_approval":
        return "pending"
    if grant.valid_until is not None and grant.valid_until <= now:
        return "expired"
    return "active"


def _summarize_filters(resource_filters) -> str | None:
    if not resource_filters:
        return None
    if not isinstance(resource_filters, dict):
        return str(resource_filters)[:80]
    parts = []
    for key, value in resource_filters.items():
        if isinstance(value, dict):
            repos = value.get("repos")
            if isinstance(repos, list) and repos:
                shown = ", ".join(str(r) for r in repos[:2])
                extra = f" +{len(repos) - 2}" if len(repos) > 2 else ""
                parts.append(f"{key}:{shown}{extra}")
            else:
                parts.append(str(key))
        elif isinstance(value, list):
            parts.append(f"{key}:{', '.join(str(v) for v in value[:2])}")
        else:
            parts.append(f"{key}:{value}")
    summary = " · ".join(parts)[:80]
    return summary or None


def _serialize_grant(
    grant: ConnectGrantRow,
    connection: ConnectConnectionRow | None,
    user_label: str | None,
    now: str,
) -> dict:
    max_uses = grant.max_uses
    return {
        "id": grant.id,
        "agent_id": grant.agent_id,
        "connect_user_id": grant.connect_user_id,
        "user": user_label or grant.connect_user_id[:8],
        "provider": connection.provider if connection else None,
        "account_label": connection.provider_account_label if connection else None,
        "scopes": grant.scopes,
        "resource": _summarize_filters(grant.resource_filters),
        "resource_filters": grant.resource_filters,
        "status": _grant_ui_status(grant, now),
        "approval_status": grant.approval_status,
        "uses": grant.use_count,
        "max_uses": max_uses,
        "valid_until": grant.valid_until,
        "seconds_until_expiration": _seconds_until(grant.valid_until),
        "environment": grant.environment,
        "created_at": grant.created_at,
    }

async def _link_decision_grant(db, decision_id: str | None, grant_id: str) -> None:
    if not decision_id or not grant_id:
        return
    await Model(db).update("policy_decisions", "id = ?", {"grant_id": grant_id}, decision_id)


async def _ensure_grant(
    grant_model: ConnectGrantModel,
    *,
    connect_app_id: str,
    connect_user_id: str,
    connection_id: str,
    scopes: list[str],
    workspace_id: str | None = None,
) -> str:
    """Provision the consent-path grant.

    Policy runs first in restrictive mode: an explicit enforced deny forbids
    the connect, everything else leaves today's behavior untouched. The end
    user's act is the authority here, so policy may forbid but never
    auto-approve.
    """
    decision_id: str | None = None
    if workspace_id:
        from services import policies as policies_service

        connection = await ConnectConnectionModel(grant_model.db).find_by_id(connection_id)
        provider = getattr(connection, "provider", None) if connection else None
        connect_user = await ConnectUserModel(grant_model.db).find_by_id(connect_user_id)
        user_label = (connect_user.primary_email or "") if connect_user else ""
        outcome = await policies_service.enforce_grant_issuance(
            grant_model.db,
            workspace_id=workspace_id,
            provider=provider,
            scopes=scopes,
            connect_user_id=connect_user_id,
            user_label=user_label,
            source="consent",
            restrictive=True,
        )
        decision_id = outcome.get("decision_id")
        if outcome["blocks"]:
            raise HTTPException(
                status_code=403,
                detail=f"Blocked by policy: {outcome['reason']}",
            )

    existing = await grant_model.find_active(connect_app_id, connect_user_id, connection_id, workspace_id)
    if existing is not None:
        await _link_decision_grant(grant_model.db, decision_id, existing.id)
        return existing.id
    grant = await grant_model.create(
        ConnectGrantCreate(
            connect_app_id=connect_app_id,
            connect_user_id=connect_user_id,
            connection_id=connection_id,
            scopes=scopes,
            workspace_id=workspace_id,
        )
    )
    await _link_decision_grant(grant_model.db, decision_id, grant.id)
    return grant.id


async def get_grant_context(
    grant_model: ConnectGrantModel,
    connection_model: ConnectConnectionModel,
    grant_access_token: str,
    jwt_secret: str,
) -> tuple[ConnectGrantRow, ConnectConnectionRow]:
    payload = _parse_grant_access_token(grant_access_token.strip(), jwt_secret)
    grant = await grant_model.find_by_id(str(payload["grant_id"]))
    if grant is None or grant.status.value != "active":
        raise HTTPException(status_code=401, detail="Grant is not active")
    if grant.connect_app_id != payload.get("app_id"):
        raise HTTPException(status_code=401, detail="Grant access token mismatch")
    if grant.connect_user_id != payload.get("connect_user_id"):
        raise HTTPException(status_code=401, detail="Grant access token mismatch")
    if grant.connection_id != payload.get("connection_id"):
        raise HTTPException(status_code=401, detail="Grant access token mismatch")

    connection = await connection_model.find_by_id(grant.connection_id)
    if connection is None or connection.status.value != "active":
        raise HTTPException(status_code=404, detail="Connection not found")

    return grant, connection


async def get_current_grant(
    grant_model: ConnectGrantModel,
    connection_model: ConnectConnectionModel,
    grant_access_token: str,
    jwt_secret: str,
) -> dict:
    grant, connection = await get_grant_context(
        grant_model,
        connection_model,
        grant_access_token,
        jwt_secret,
    )
    return success(
        {
            "grant_id": grant.id,
            "connect_user_id": grant.connect_user_id,
            "connection_id": connection.id,
            "provider": connection.provider,
            "scopes": grant.scopes,
            "account_label": connection.provider_account_label,
            "status": grant.status.value,
        }
    )


async def _enrich_grants(
    grant_model: ConnectGrantModel,
    connection_model: ConnectConnectionModel,
    user_model: ConnectUserModel,
    grants: list[ConnectGrantRow],
    now: str,
) -> list[dict]:
    connection_ids = list({g.connection_id for g in grants})
    connections: dict[str, ConnectConnectionRow] = {}
    for connection_id in connection_ids:
        connection = await connection_model.find_by_id(connection_id)
        if connection is not None:
            connections[connection_id] = connection
    user_ids = list({g.connect_user_id for g in grants})
    user_labels: dict[str, str] = {}
    for user_id in user_ids:
        user = await user_model.find_by_id(user_id)
        if user is not None and user.primary_email:
            user_labels[user_id] = user.primary_email
    items = []
    for grant in grants:
        connection = connections.get(grant.connection_id)
        label = user_labels.get(grant.connect_user_id)
        if label is None and connection is not None and connection.provider_account_label:
            label = connection.provider_account_label
        items.append(_serialize_grant(grant, connection, label, now))
    return items


async def list_workspace_grants(
    grant_model: ConnectGrantModel,
    connection_model: ConnectConnectionModel,
    user_model: ConnectUserModel,
    workspace_id: str,
    *,
    status: str | None = None,
    agent_id: str | None = None,
    provider: str | None = None,
    page: int = 1,
    limit: int = 50,
) -> dict:
    """Workspace-wide grant list. No app keying."""
    if status is not None and status not in GRANT_UI_STATUSES:
        raise HTTPException(status_code=400, detail="status must be pending, active, expired, revoked, or denied")
    now = utc_now_iso()
    offset = (page - 1) * limit
    grants = await grant_model.list_by_workspace(
        workspace_id, ui_status=status, agent_id=agent_id or None, now=now, limit=limit, offset=offset
    )
    total = await grant_model.count_by_workspace(
        workspace_id, ui_status=status, agent_id=agent_id or None, now=now
    )
    items = await _enrich_grants(grant_model, connection_model, user_model, grants, now)
    if provider:
        items = [item for item in items if item["provider"] == provider]
    return success(items, meta={
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if limit else 0,
    })


async def create_grant(
    grant_model: ConnectGrantModel,
    connection_model: ConnectConnectionModel,
    user_model: ConnectUserModel,
    audit_model: ConnectAuditEventModel,
    user_id: str,
    workspace_id: str,
    req,
) -> dict:
    """Mint a grant. Authority stays in grants/policy/audit — never ambient."""
    from services.workspaces import require_membership
    await require_membership(grant_model.db, user_id, workspace_id)

    connection_id = (req.connection_id or "").strip()
    connection = await connection_model.find_by_id(connection_id) if connection_id else None
    if connection is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    agent_id = (req.agent_id or "").strip() or None
    if agent_id:
        agent = await Model(grant_model.db).find_one(
            "agents", "id = ? AND workspace_id = ?", agent_id, workspace_id
        )
        if agent is None:
            raise HTTPException(status_code=404, detail="Agent not found")

    scopes = [s for s in (req.scopes or []) if str(s).strip()]
    if not scopes:
        raise HTTPException(status_code=400, detail="At least one scope is required")

    max_uses = req.max_uses
    if max_uses is not None and max_uses <= 0:
        raise HTTPException(status_code=400, detail="max_uses must be positive")

    environment = (req.environment or "").strip().lower() or None
    if environment is not None and environment not in GRANT_ENVIRONMENTS:
        raise HTTPException(status_code=400, detail="Environment must be dev, staging, or prod")

    approval_status = (req.approval_status or "pending_approval").strip()
    if approval_status not in GRANT_APPROVAL_STATES:
        raise HTTPException(status_code=400, detail="approval_status must be pending_approval or approved")

    # Policy decides issuance. The action identity is derived server-side from
    # the connection — the request cannot name its own action or self-approve.
    from services import policies as policies_service

    agent_label = ""
    if agent_id:
        agent = await Model(grant_model.db).find_one("agents", "id = ?", agent_id)
        agent_label = (agent.get("name") if agent else "") or agent_id
    connect_user = await user_model.find_by_id(connection.connect_user_id)
    user_label = (connect_user.primary_email or "") if connect_user else ""

    outcome = await policies_service.enforce_grant_issuance(
        grant_model.db,
        workspace_id=workspace_id,
        provider=connection.provider,
        scopes=scopes,
        resource=_summarize_filters(req.resource_filters) or "",
        agent_id=agent_id,
        agent_label=agent_label,
        connect_user_id=connection.connect_user_id,
        user_label=user_label,
        source="grant",
        restrictive=False,
    )
    if outcome["blocks"]:
        hint = policies_service.change_hint("deny", outcome.get("rule"), "")
        raise HTTPException(
            status_code=403,
            detail=f"Blocked by policy: {outcome['reason']} {hint}",
        )
    if outcome["configured"]:
        # Policy governs when it is on; the request cannot override it.
        approval_status = POLICY_APPROVAL_BY_DECISION.get(outcome["decision"], approval_status)

    grant = await grant_model.create(
        ConnectGrantCreate(
            connect_app_id=None,
            connect_user_id=connection.connect_user_id,
            connection_id=connection.id,
            scopes=scopes,
            agent_id=agent_id,
            valid_until=(req.valid_until or "").strip() or None,
            resource_filters=req.resource_filters,
            max_uses=max_uses,
            environment=environment,
            workspace_id=workspace_id,
            approval_status=approval_status,
        )
    )
    await _link_decision_grant(grant_model.db, outcome.get("decision_id"), grant.id)
    now = utc_now_iso()
    await _audit(
        audit_model,
        event_type=ConnectAuditEventType.GRANT_CREATED,
        actor_type=ConnectAuditActorType.CONNECT_USER,
        actor_id=user_id,
        connect_user_id=connection.connect_user_id,
        resource_type=ConnectResourceType.CONNECT_GRANT,
        resource_id=grant.id,
        agent_id=agent_id,
        result="success",
        workspace_id=workspace_id,
        metadata={"approval_status": approval_status},
    )
    items = await _enrich_grants(grant_model, connection_model, user_model, [grant], now)
    return success(items[0])


async def revoke_grant(
    grant_model: ConnectGrantModel,
    connection_model: ConnectConnectionModel,
    user_model: ConnectUserModel,
    audit_model: ConnectAuditEventModel,
    grant_id: str,
    user_id: str,
    reason: str | None = None,
    env=None,
) -> dict:
    """Revoke an active grant. Deny is for pending grants; revoke is for live ones."""
    grant = await grant_model.find_by_id(grant_id)
    if grant is None:
        raise HTTPException(status_code=404, detail="Grant not found")
    if env is not None:
        from services.workspaces import require_membership
        await require_membership(env.DB, user_id, grant.workspace_id)
    status = grant.status.value if hasattr(grant.status, "value") else str(grant.status)
    if status == "revoked":
        raise HTTPException(status_code=409, detail="Grant is already revoked")

    await grant_model.revoke(grant_id)
    await _audit(
        audit_model,
        event_type=ConnectAuditEventType.GRANT_REVOKED,
        actor_type=ConnectAuditActorType.CONNECT_USER,
        actor_id=user_id,
        connect_user_id=grant.connect_user_id,
        resource_type=ConnectResourceType.CONNECT_GRANT,
        resource_id=grant_id,
        agent_id=grant.agent_id,
        result="success",
        workspace_id=grant.workspace_id,
        metadata={"reason": reason or "Grant revoked"},
    )
    now = utc_now_iso()
    updated = await grant_model.find_by_id(grant_id)
    items = await _enrich_grants(grant_model, connection_model, user_model, [updated], now)
    return success(items[0])


async def approve_grant(
    grant_model: ConnectGrantModel,
    audit_model: ConnectAuditEventModel,
    grant_id: str,
    approved_by_user_id: str,
    approval_reason: str | None = None,
    env = None,
) -> dict:
    """Approve a pending grant."""
    grant = await grant_model.find_by_id(grant_id)
    if grant is None:
        raise HTTPException(status_code=404, detail=json.dumps({
            "error": "grant_not_found",
            "message": f"No grant found with id: {grant_id}",
            "grant_id": grant_id,
        }))
    if env is not None:
        from services.workspaces import require_membership
        await require_membership(env.DB, approved_by_user_id, grant.workspace_id)

    # Can only approve pending grants
    if grant.approval_status != "pending_approval":
        raise HTTPException(status_code=409, detail=json.dumps({
            "error": "grant_invalid_state",
            "message": f"Grant state is {grant.approval_status}, not pending_approval",
            "grant_id": grant_id,
        }))
    
    # Update grant to approved (SIMPLIFIED: only update approval_status)
    now = utc_now_iso()
    await grant_model.update_grant(
        grant_id,
        {
            "approval_status": "approved",
        }
    )
    
    # Audit the approval with full agentic context
    await _audit(
        audit_model,
        event_type=ConnectAuditEventType.GRANT_APPROVED,
        actor_type=ConnectAuditActorType.CONNECT_USER,
        actor_id=approved_by_user_id,
        connect_app_id=grant.connect_app_id,
        connect_user_id=grant.connect_user_id,
        resource_type=ConnectResourceType.CONNECT_GRANT,
        resource_id=grant_id,
        agent_id=grant.agent_id,
        task_id=grant.created_by_task_id,
        workflow_run_id=grant.created_by_workflow_run_id,
        result="success",
        workspace_id=grant.workspace_id,
        metadata={
            "approval_reason": approval_reason or "Grant approved",
            "approved_at": now,
        },
    )
    if env and hasattr(env, "TASK_QUEUE"):
        from db.orm import TaskModel
        task_model = TaskModel(env.DB)
        waiting = await task_model.find_many("tasks", "connect_grant_id = ? AND status = ?", grant_id, "waiting_for_grant")
        for t in waiting:
            await task_model.update("tasks", "id = ?", {"status": "queued", "updated_at": now}, t["id"])
            await env.TASK_QUEUE.send({"task_id": t["id"]})
    
    # Return updated grant
    updated_grant = await grant_model.find_by_id(grant_id)
    return success({
        "id": updated_grant.id,
        "approval_status": updated_grant.approval_status,
        "message": "Grant approved successfully",
    })


async def deny_grant(
    grant_model: ConnectGrantModel,
    audit_model: ConnectAuditEventModel,
    grant_id: str,
    denied_by_user_id: str,
    denial_reason: str,
    env = None,
) -> dict:
    """Deny a grant request."""
    grant = await grant_model.find_by_id(grant_id)
    if grant is None:
        raise HTTPException(status_code=404, detail=json.dumps({
            "error": "grant_not_found",
            "message": f"No grant found with id: {grant_id}",
            "grant_id": grant_id,
        }))
    
    if env is not None:
        from services.workspaces import require_membership
        await require_membership(env.DB, denied_by_user_id, grant.workspace_id)
    if grant.approval_status != "pending_approval":
        raise HTTPException(status_code=409, detail=json.dumps({
            "error": "grant_invalid_state",
            "message": f"Cannot deny grant in state {grant.approval_status}",
            "grant_id": grant_id,
        }))
    
    # Update grant to denied (SIMPLIFIED: only update approval_status)
    now = utc_now_iso()
    await grant_model.update_grant(
        grant_id,
        {
            "approval_status": "denied",
        }
    )
    
    # Audit the denial with full agentic context (decision metadata stored here)
    await _audit(
        audit_model,
        event_type=ConnectAuditEventType.GRANT_DENIED,
        actor_type=ConnectAuditActorType.CONNECT_USER,
        actor_id=denied_by_user_id,
        connect_app_id=grant.connect_app_id,
        connect_user_id=grant.connect_user_id,
        resource_type=ConnectResourceType.CONNECT_GRANT,
        resource_id=grant_id,
        agent_id=grant.agent_id,
        task_id=grant.created_by_task_id,
        workflow_run_id=grant.created_by_workflow_run_id,
        denial_reason=denial_reason,
        result="success",
        workspace_id=grant.workspace_id,
        metadata={
            "reason": denial_reason,
            "denied_at": now,
        },
    )
    if env and hasattr(env, "TASK_QUEUE"):
        from db.orm import TaskModel
        task_model = TaskModel(env.DB)
        waiting = await task_model.find_many("tasks", "connect_grant_id = ? AND status = ?", grant_id, "waiting_for_grant")
        for t in waiting:
            await task_model.update("tasks", "id = ?", {"status": "failed", "updated_at": now}, t["id"])
    
    # Return updated grant
    updated_grant = await grant_model.find_by_id(grant_id)
    return success({
        "id": updated_grant.id,
        "approval_status": updated_grant.approval_status,
        "message": "Grant denied successfully",
    })


