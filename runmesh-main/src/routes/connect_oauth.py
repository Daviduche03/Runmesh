from db.connect_orm import (
    ConnectAppModel,
    ConnectAppUserModel,
    ConnectAuditEventModel,
    ConnectConnectionModel,
    ConnectGrantModel,
    ConnectIdentityModel,
    ConnectSessionModel,
    ConnectUserModel,
)

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
)

from services import connect as connect_service

from starlette.responses import RedirectResponse

from typing import Optional

from utils.dual_auth import require_auth

from utils.responses import error

from utils.types import (
    ConnectConsentRequest,
    ConnectTokenRequest,
)

router = APIRouter()


@router.get("/connect/authorize")
async def connect_authorize(state: str, request: Request):
    env = request.scope["env"]
    base = getattr(env, "PUBLIC_URL", str(request.base_url).rstrip("/"))
    result = await connect_service.begin_connect_authorize(
        env,
        ConnectSessionModel(env.DB),
        ConnectUserModel(env.DB),
        ConnectAppUserModel(env.DB),
        ConnectConnectionModel(env.DB),
        ConnectGrantModel(env.DB),
        state,
        base,
    )
    return connect_service.finalize_connect_redirect(result)


@router.get("/connect/callback")
async def connect_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    env = request.scope["env"]
    base = getattr(env, "PUBLIC_URL", str(request.base_url).rstrip("/"))
    if error or not code or not state:
        if state:
            url = await connect_service.connect_oauth_error_redirect(
                ConnectSessionModel(env.DB),
                state,
                error or "oauth_failed",
            )
            return RedirectResponse(url=url)
        raise HTTPException(status_code=400, detail="Connect OAuth failed")
    result = await connect_service.handle_connect_callback(
        env,
        ConnectAppModel(env.DB),
        ConnectSessionModel(env.DB),
        ConnectUserModel(env.DB),
        ConnectIdentityModel(env.DB),
        ConnectAppUserModel(env.DB),
        ConnectConnectionModel(env.DB),
        ConnectGrantModel(env.DB),
        ConnectAuditEventModel(env.DB),
        code=code,
        state=state,
        public_base_url=base,
    )
    return connect_service.finalize_connect_redirect(result)


@router.get("/connect/consent")
async def connect_consent_page(state: str, request: Request):
    env = request.scope["env"]
    return await connect_service.get_connect_consent_page(
        ConnectAppModel(env.DB),
        ConnectSessionModel(env.DB),
        ConnectConnectionModel(env.DB),
        state,
    )


@router.post("/connect/consent")
async def connect_consent_submit(request: Request):
    env = request.scope["env"]
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        body = await request.json()
        req = ConnectConsentRequest(**body)
    else:
        form = await request.form()
        req = ConnectConsentRequest(
            state=str(form.get("state", "")),
            action=str(form.get("action", "")),
        )
    result = await connect_service.submit_connect_consent(
        env,
        ConnectSessionModel(env.DB),
        ConnectConnectionModel(env.DB),
        ConnectGrantModel(env.DB),
        ConnectAuditEventModel(env.DB),
        req,
    )
    return connect_service.finalize_connect_redirect(result)


@router.post("/api/v1/connect/token")
async def api_exchange_connect_token(
    req: ConnectTokenRequest,
    request: Request,
    current_user: dict = Depends(require_auth("write")),
):
    from services.workspaces import resolve_request_workspace

    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await connect_service.exchange_connect_token(
        ConnectAppModel(env.DB),
        ConnectSessionModel(env.DB),
        ConnectGrantModel(env.DB),
        ConnectAuditEventModel(env.DB),
        req,
        current_user["id"],
        env.JWT_SECRET,
        workspace_id,
    )


@router.get("/api/v1/connect/providers")
async def api_list_connect_providers():
    return await connect_service.list_connect_providers()
