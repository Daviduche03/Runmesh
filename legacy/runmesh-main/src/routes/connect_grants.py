from db.connect_orm import (
    ConnectAuditEventModel,
    ConnectConnectionModel,
    ConnectGrantModel,
    ConnectUserModel,
)

from db.orm import TaskModel

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
)

from services import connect as connect_service

from services.workspaces import resolve_request_workspace

from typing import Optional

from utils.dual_auth import require_auth

from utils.responses import (
    error,
    success,
)

from utils.types import (
    ConnectGrantApprovalRequest,
    ConnectGrantDenialRequest,
    GrantCreateRequest,
    GrantRevokeRequest,
)

router = APIRouter()


@router.get("/api/v1/grants")
async def api_list_grants(
    request: Request,
    status: Optional[str] = None,
    agent_id: Optional[str] = None,
    provider: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    current_user: dict = Depends(require_auth("read")),
):
    """Workspace-wide grant list. No app keying."""
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    try:
        return await connect_service.list_workspace_grants(
            ConnectGrantModel(env.DB),
            ConnectConnectionModel(env.DB),
            ConnectUserModel(env.DB),
            workspace_id,
            status=status,
            agent_id=agent_id,
            provider=provider,
            page=page,
            limit=limit,
        )
    except HTTPException as e:
        return error(e.status_code, e.detail)


@router.post("/api/v1/grants")
async def api_create_grant(
    req: GrantCreateRequest,
    request: Request,
    current_user: dict = Depends(require_auth("write")),
):
    """Mint a grant in this workspace."""
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    try:
        return await connect_service.create_grant(
            ConnectGrantModel(env.DB),
            ConnectConnectionModel(env.DB),
            ConnectUserModel(env.DB),
            ConnectAuditEventModel(env.DB),
            current_user["id"],
            workspace_id,
            req,
        )
    except HTTPException as e:
        return error(e.status_code, e.detail)


@router.post("/api/v1/grants/{grant_id}/revoke")
async def api_revoke_grant(
    grant_id: str,
    req: GrantRevokeRequest,
    request: Request,
    current_user: dict = Depends(require_auth("write")),
):
    """Revoke an active grant."""
    env = request.scope["env"]
    try:
        return await connect_service.revoke_grant(
            ConnectGrantModel(env.DB),
            ConnectConnectionModel(env.DB),
            ConnectUserModel(env.DB),
            ConnectAuditEventModel(env.DB),
            grant_id,
            current_user["id"],
            req.reason,
            env,
        )
    except HTTPException as e:
        return error(e.status_code, e.detail)


@router.post("/api/v1/connect/grants/{grant_id}/approve")
async def api_approve_grant(
    grant_id: str,
    req: ConnectGrantApprovalRequest,
    request: Request,
    current_user: dict = Depends(require_auth("write")),
):
    """Approve a pending grant."""
    env = request.scope["env"]
    grant_model = ConnectGrantModel(env.DB)
    audit_model = ConnectAuditEventModel(env.DB)
    
    try:
        return await connect_service.approve_grant(
            grant_model,
            audit_model,
            grant_id,
            current_user["id"],
            req.reason,
            env,
        )
    except HTTPException as e:
        return error(e.status_code, e.detail)


@router.post("/api/v1/connect/grants/{grant_id}/deny")
async def api_deny_grant(
    grant_id: str,
    req: ConnectGrantDenialRequest,
    request: Request,
    current_user: dict = Depends(require_auth("write")),
):
    """Deny a grant request."""
    env = request.scope["env"]
    grant_model = ConnectGrantModel(env.DB)
    audit_model = ConnectAuditEventModel(env.DB)
    
    try:
        return await connect_service.deny_grant(
            grant_model,
            audit_model,
            grant_id,
            current_user["id"],
            req.reason,
            env,
        )
    except HTTPException as e:
        return error(e.status_code, e.detail)


@router.get("/api/v1/tasks/{task_id}/grant_status")
async def api_task_grant_status(
    task_id: str,
    request: Request,
    current_user: dict = Depends(require_auth("read")),
):
    env = request.scope["env"]
    task = await TaskModel(env.DB).find_by_id(task_id)
    if not task or task.get("user_id") != current_user["id"]:
        return error(404, "Task not found")
    grant_id = task.get("connect_grant_id")
    if not grant_id:
        return success({"task_id": task_id, "grant_id": None, "approval_status": None})
    grant = await ConnectGrantModel(env.DB).find_by_id(grant_id)
    if not grant:
        return success({"task_id": task_id, "grant_id": grant_id, "approval_status": "not_found"})
    return success({"task_id": task_id, "grant_id": grant_id, "approval_status": grant.approval_status, "agent_id": grant.agent_id})


@router.get("/api/v1/connect/metrics")
async def api_get_connect_metrics(
    request: Request,
    current_user: dict = Depends(require_auth("read")),
):
    """Workspace-scoped Connect metrics and monitoring data."""
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await connect_service.get_connect_metrics(env, current_user["id"], workspace_id)


@router.get("/api/v1/connect/tokens")
async def api_list_connect_tokens(
    request: Request,
    task_id: Optional[str] = None,
    workflow_run_id: Optional[str] = None,
    workspace_project_id: Optional[str] = None,
    current_user: dict = Depends(require_auth("read")),
):
    env = request.scope["env"]
    audit_model = ConnectAuditEventModel(env.DB)
    workspace_id = await resolve_request_workspace(request, current_user)
    rows = await audit_model.find_token_exchanges(
        workspace_id,
        task_id=task_id,
        workflow_run_id=workflow_run_id,
        workspace_project_id=workspace_project_id,
    )
    return success([
        {
            "id": r.id,
            "event_type": r.event_type,
            "connect_app_id": r.connect_app_id,
            "connect_user_id": r.connect_user_id,
            "resource_id": r.resource_id,
            "metadata": r.metadata,
            "created_at": r.created_at,
        }
        for r in rows
    ])


@router.get("/api/v1/connect/grants/current")
async def api_get_current_grant(request: Request):
    env = request.scope["env"]
    token = request.headers.get("X-Connect-Grant-Token")
    if not token:
        raise HTTPException(status_code=401, detail="X-Connect-Grant-Token header required")
    return await connect_service.get_current_grant(
        ConnectGrantModel(env.DB),
        ConnectConnectionModel(env.DB),
        token,
        env.JWT_SECRET,
    )


# Workspaces — onboarding and membership
