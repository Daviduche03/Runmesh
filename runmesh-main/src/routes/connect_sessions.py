from db.connect_orm import (
    ConnectAppModel,
    ConnectAppUserModel,
    ConnectAuditEventModel,
    ConnectConnectionModel,
    ConnectIdentityModel,
    ConnectOtpChallengeModel,
    ConnectSessionModel,
    ConnectUserModel,
)
from db.orm import Model, TaskModel, WorkflowRunModel

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

from utils.responses import error

from utils.types import (
    ConnectOtpResendRequest,
    ConnectOtpVerifyRequest,
    ConnectSessionCreateRequest,
)

router = APIRouter()


@router.post("/api/v1/connect/otp/verify")
async def api_verify_connect_otp(
    req: ConnectOtpVerifyRequest,
    request: Request,
    current_user: dict = Depends(require_auth("write")),
):
    env = request.scope["env"]
    return await connect_service.verify_connect_otp(
        env,
        ConnectAppModel(env.DB),
        ConnectUserModel(env.DB),
        ConnectIdentityModel(env.DB),
        ConnectAppUserModel(env.DB),
        ConnectOtpChallengeModel(env.DB),
        ConnectSessionModel(env.DB),
        req,
        current_user["id"],
    )


@router.post("/api/v1/connect/otp/resend")
async def api_resend_connect_otp(
    req: ConnectOtpResendRequest,
    request: Request,
    current_user: dict = Depends(require_auth("write")),
):
    env = request.scope["env"]
    return await connect_service.resend_connect_otp(
        env,
        ConnectAppModel(env.DB),
        ConnectOtpChallengeModel(env.DB),
        req,
        current_user["id"],
    )


@router.post("/api/v1/connect/sessions")
async def api_create_connect_session(
    req: ConnectSessionCreateRequest,
    request: Request,
    current_user: dict = Depends(require_auth("write")),
):
    env = request.scope["env"]
    base = getattr(env, "PUBLIC_URL", str(request.base_url).rstrip("/"))
    workspace_id = await resolve_request_workspace(request, current_user)
    return await connect_service.create_connect_session(
        env,
        ConnectAppModel(env.DB),
        ConnectSessionModel(env.DB),
        ConnectAuditEventModel(env.DB),
        ConnectUserModel(env.DB),
        ConnectIdentityModel(env.DB),
        ConnectAppUserModel(env.DB),
        ConnectOtpChallengeModel(env.DB),
        req,
        current_user["id"],
        base,
        workspace_id,
    )


@router.get("/api/v1/connect/audit")
async def api_list_connect_audit(
    request: Request,
    event_type: Optional[str] = None,
    connect_user_id: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(require_auth("read")),
):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await connect_service.list_audit_events(
        ConnectAuditEventModel(env.DB),
        TaskModel(env.DB),
        WorkflowRunModel(env.DB),
        ConnectUserModel(env.DB),
        Model(env.DB),
        workspace_id,
        event_type=event_type,
        connect_user_id=connect_user_id,
        search=search,
        limit=limit,
        offset=offset,
    )


@router.get("/api/v1/connections")
async def api_list_connections(
    request: Request,
    provider: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    current_user: dict = Depends(require_auth("read")),
):
    """Workspace-wide connection list. Who authorized which account."""
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    try:
        return await connect_service.list_workspace_connections(
            ConnectConnectionModel(env.DB),
            ConnectUserModel(env.DB),
            workspace_id,
            provider=provider,
            status=status,
            page=page,
            limit=limit,
        )
    except HTTPException as e:
        return error(e.status_code, e.detail)
