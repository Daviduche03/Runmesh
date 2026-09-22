from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
)
from fastapi.responses import JSONResponse, Response

from services import tool_invoke

from services.workspaces import resolve_request_workspace

from utils.dual_auth import require_auth

from utils.responses import error

from utils.types import ToolForwardRequest, ToolInvokeRequest

router = APIRouter()

FORWARD_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]


@router.get("/api/v1/tools")
async def api_list_tools(
    request: Request,
    current_user: dict = Depends(require_auth("read")),
):
    """Registered tools: the formal `provider.action` vocabulary for rules."""
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await tool_invoke.list_tools(env, current_user["id"], workspace_id)


@router.post("/api/v1/tools/{ref}/invoke")
async def api_invoke_tool(
    ref: str,
    req: ToolInvokeRequest,
    request: Request,
    current_user: dict = Depends(require_auth("write")),
):
    """Execute a managed tool: policy decides, Runmesh injects the credential."""
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    try:
        return await tool_invoke.invoke_tool(env, current_user["id"], workspace_id, ref, req)
    except HTTPException as e:
        return error(e.status_code, e.detail)


@router.post("/api/v1/tools/{ref}/forward")
async def api_forward_tool(
    ref: str,
    req: ToolForwardRequest,
    request: Request,
    current_user: dict = Depends(require_auth("write")),
):
    """Forward the caller's own request with the credential injected (JSON envelope)."""
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    try:
        return await tool_invoke.forward_tool(
            env,
            current_user["id"],
            workspace_id,
            ref,
            method=req.method,
            path=req.path,
            headers=req.headers,
            body=req.body,
            query=req.query,
            run_id=req.run_id,
            idempotency_key=req.idempotency_key,
            connect_user_id=req.connect_user_id,
        )
    except HTTPException as e:
        return error(e.status_code, e.detail)


@router.api_route(
    "/api/v1/tools/{ref}/forward/{path:path}",
    methods=FORWARD_METHODS,
)
async def api_forward_passthrough(
    ref: str,
    path: str,
    request: Request,
    current_user: dict = Depends(require_auth("write")),
):
    """Same forwarding, but for SDKs pointed straight at this base URL.

    The client sets its base URL to /api/v1/tools/{ref}/forward and authenticates
    with its Runmesh API key; the run is named by X-Runmesh-Run. The response is
    the upstream response verbatim, so an SDK parses it normally.
    """
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    raw_body = await request.body()
    body_text = raw_body.decode("utf-8", "replace") if raw_body else None
    try:
        result = await tool_invoke.forward_tool(
            env,
            current_user["id"],
            workspace_id,
            ref,
            method=request.method,
            path="/" + path,
            headers=dict(request.headers),
            body=body_text,
            query=dict(request.query_params),
            run_id=request.headers.get("X-Runmesh-Run", ""),
            idempotency_key=request.headers.get("Idempotency-Key"),
            connect_user_id=request.headers.get("X-Runmesh-User"),
        )
    except HTTPException as e:
        return JSONResponse(status_code=e.status_code, content={"error": e.detail})

    data = (result or {}).get("data") or {}
    if data.get("decision") == "allow":
        media_type = "application/json"
        return Response(
            content=data.get("body") or "",
            status_code=int(data.get("status") or 200),
            media_type=media_type,
        )
    # A decision that is not "allow" is a client-visible refusal, not a crash.
    status = {"deny": 403, "consent": 402, "escalate": 409}.get(data.get("decision"), 403)
    return JSONResponse(status_code=status, content={
        "error": data.get("decision"),
        "reason": data.get("reason"),
        "provider": data.get("provider"),
    })
