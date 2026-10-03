from fastapi import (
    APIRouter,
    Depends,
    Request,
)

from services import triggers as triggers_service
from services.workspaces import resolve_request_workspace
from utils.dual_auth import require_auth
from utils.types import (
    TriggerCreateRequest,
    TriggerFireRequest,
    TriggerUpdateRequest,
)

router = APIRouter()


@router.get("/api/v1/triggers")
async def api_list_triggers(request: Request, agent_id: str | None = None, user: dict = Depends(require_auth("read"))):
    workspace_id = await resolve_request_workspace(request, user)
    return await triggers_service.list_triggers(
        request.scope["env"].DB, user["id"], workspace_id, agent_id=agent_id
    )


@router.post("/api/v1/triggers")
async def api_create_trigger(body: TriggerCreateRequest, request: Request, user: dict = Depends(require_auth("write"))):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, user)
    return await triggers_service.create_trigger(
        env.DB, user["id"], workspace_id,
        agent_id=body.agent_id, trigger_type=body.type, name=body.name, config=body.config,
        endpoint=body.endpoint, endpoint_secret=body.endpoint_secret, env=env,
    )


@router.get("/api/v1/triggers/{trigger_id}")
async def api_get_trigger(trigger_id: str, request: Request, user: dict = Depends(require_auth("read"))):
    workspace_id = await resolve_request_workspace(request, user)
    return await triggers_service.get_trigger(request.scope["env"].DB, user["id"], workspace_id, trigger_id)


@router.patch("/api/v1/triggers/{trigger_id}")
async def api_update_trigger(trigger_id: str, body: TriggerUpdateRequest, request: Request, user: dict = Depends(require_auth("write"))):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, user)
    return await triggers_service.update_trigger(
        env.DB, user["id"], workspace_id, trigger_id,
        name=body.name, config=body.config, enabled=body.enabled,
        endpoint=body.endpoint, endpoint_secret=body.endpoint_secret, env=env,
    )


@router.delete("/api/v1/triggers/{trigger_id}")
async def api_delete_trigger(trigger_id: str, request: Request, user: dict = Depends(require_auth("write"))):
    workspace_id = await resolve_request_workspace(request, user)
    return await triggers_service.delete_trigger(request.scope["env"].DB, user["id"], workspace_id, trigger_id)


@router.post("/api/v1/triggers/{trigger_id}/activate")
async def api_activate_trigger(trigger_id: str, request: Request, user: dict = Depends(require_auth("write"))):
    workspace_id = await resolve_request_workspace(request, user)
    return await triggers_service.update_trigger(
        request.scope["env"].DB, user["id"], workspace_id, trigger_id, enabled=True
    )


@router.post("/api/v1/triggers/{trigger_id}/deactivate")
async def api_deactivate_trigger(trigger_id: str, request: Request, user: dict = Depends(require_auth("write"))):
    workspace_id = await resolve_request_workspace(request, user)
    return await triggers_service.update_trigger(
        request.scope["env"].DB, user["id"], workspace_id, trigger_id, enabled=False
    )


@router.post("/api/v1/triggers/{trigger_id}/fire")
async def api_fire_trigger(trigger_id: str, body: TriggerFireRequest, request: Request, user: dict = Depends(require_auth("write"))):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, user)
    return await triggers_service.fire_trigger(
        env.DB, user["id"], workspace_id, trigger_id, body.input, env=env
    )


@router.get("/api/v1/triggers/{trigger_id}/runs")
async def api_list_trigger_runs(trigger_id: str, request: Request, limit: int = 50, user: dict = Depends(require_auth("read"))):
    workspace_id = await resolve_request_workspace(request, user)
    return await triggers_service.list_trigger_runs(
        request.scope["env"].DB, user["id"], workspace_id, trigger_id, limit
    )
