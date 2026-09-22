from fastapi import (
    APIRouter,
    Depends,
    Request,
)

from services import collection as collection_service

from services.workspaces import resolve_request_workspace

from utils.dual_auth import require_auth

from utils.types import (
    AgentResolveRequest,
    IngestRequest,
    RunFinishRequest,
    RunStartRequest,
)

router = APIRouter()


@router.put("/api/v1/agents:resolve")
async def resolve_agent(req: AgentResolveRequest, request: Request, current_user: dict = Depends(require_auth("write"))):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await collection_service.resolve_agent(env.DB, current_user["id"], workspace_id, req)


@router.post("/api/v1/runs")
async def start_run(req: RunStartRequest, request: Request, current_user: dict = Depends(require_auth("write"))):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await collection_service.start_run(env.DB, current_user["id"], workspace_id, req)


@router.post("/api/v1/runs/{run_id}/finish")
async def finish_run(run_id: str, req: RunFinishRequest, request: Request, current_user: dict = Depends(require_auth("write"))):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await collection_service.finish_run(env.DB, current_user["id"], workspace_id, run_id, req)


@router.get("/api/v1/agents/{agent_id}/runs")
async def list_agent_runs(agent_id: str, request: Request, limit: int = 50, current_user: dict = Depends(require_auth("read"))):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await collection_service.list_agent_runs(env.DB, current_user["id"], workspace_id, agent_id, limit)


@router.get("/api/v1/runs/{run_id}")
async def get_run(run_id: str, request: Request, current_user: dict = Depends(require_auth("read"))):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await collection_service.get_run(env.DB, current_user["id"], workspace_id, run_id)


@router.post("/api/v1/ingest")
async def ingest(req: IngestRequest, request: Request, current_user: dict = Depends(require_auth("write"))):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await collection_service.ingest_events(env.DB, current_user["id"], workspace_id, req)
