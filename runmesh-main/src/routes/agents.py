from fastapi import (
    APIRouter,
    Depends,
    Request,
)

from services import agents as agents_service

from services.workspaces import resolve_request_workspace

from utils.dual_auth import get_jwt_user

from utils.types import AgentCreateRequest

router = APIRouter()


@router.post("/api/v1/agents")
async def create_agent(req: AgentCreateRequest, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await agents_service.create_agent(env.DB, current_user["id"], workspace_id, req)


@router.get("/api/v1/agents")
async def list_agents(request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await agents_service.list_agents(env.DB, current_user["id"], workspace_id)
