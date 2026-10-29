from fastapi import (
    APIRouter,
    Depends,
    Request,
)

from services.main import (
    create_workflow,
    delete_workflow,
    get_workflow,
    list_workflows,
    update_workflow,
)

from services.workflow_graph import save_workflow_graph

from services.workflow_runner import (
    cancel_workflow_run,
    list_workflow_runs,
    start_workflow_run,
)

from services.workflow_triggers import trigger_workflow_for_user

from services.workspaces import resolve_request_workspace

from utils.dual_auth import (
    get_authenticated_user,
    require_auth,
)

from utils.responses import success

from utils.types import (
    WorkflowCreate,
    WorkflowGraphUpdate,
    WorkflowUpdate,
)

router = APIRouter()


@router.get("/api/v1/workflows")
async def api_list_workflows(request: Request, user: dict = Depends(require_auth("read"))):
    workspace_id = await resolve_request_workspace(request, user)
    workflows = await list_workflows(request.scope["env"], user["id"], workspace_id)
    return success(workflows, meta={"total": len(workflows)})


@router.post("/api/v1/workflows")
async def api_create_workflow(workflow: WorkflowCreate, request: Request, user: dict = Depends(require_auth("write"))):
    workspace_id = await resolve_request_workspace(request, user)
    return await create_workflow(workflow, request.scope["env"], user["id"], workspace_id)


@router.get("/api/v1/workflows/{workflow_id}")
async def api_get_workflow(workflow_id: str, request: Request, user: dict = Depends(require_auth("read"))):
    return success(await get_workflow(request.scope["env"], user["id"], workflow_id))


@router.patch("/api/v1/workflows/{workflow_id}")
async def api_update_workflow(
    workflow_id: str,
    body: WorkflowUpdate,
    request: Request,
    user: dict = Depends(require_auth("write")),
):
    data = await update_workflow(
        request.scope["env"],
        user["id"],
        workflow_id,
        description=body.description,
        name=body.name,
        trigger_type=body.trigger_type,
        trigger_config=body.trigger_config,
    )
    return success(data, message="Workflow updated")


@router.delete("/api/v1/workflows/{workflow_id}")
async def api_delete_workflow(
    workflow_id: str,
    request: Request,
    user: dict = Depends(require_auth("write")),
):
    return await delete_workflow(request.scope["env"], user["id"], workflow_id)


@router.put("/api/v1/workflows/{workflow_id}/graph")
async def api_save_workflow_graph(
    workflow_id: str,
    body: WorkflowGraphUpdate,
    request: Request,
    user: dict = Depends(require_auth("write")),
):
    graph = await save_workflow_graph(
        request.scope["env"],
        user["id"],
        workflow_id,
        {"nodes": body.nodes, "edges": body.edges},
    )
    return success(graph, message="Workflow graph saved")


@router.post("/api/v1/workflows/{workflow_id}/run")
async def api_run_workflow(
    workflow_id: str,
    request: Request,
    user: dict = Depends(require_auth("write")),
):
    run = await start_workflow_run(request.scope["env"], user["id"], workflow_id)
    return success(run, message="Workflow run started")


@router.post("/api/v1/workflows/{workflow_id}/trigger")
async def api_trigger_workflow(workflow_id: str, request: Request):
    user = await get_authenticated_user(request, ["write"])
    run = await trigger_workflow_for_user(
        request.scope["env"],
        user["id"],
        workflow_id,
        triggered_by="webhook",
    )
    return success(run, message="Workflow triggered")


@router.get("/api/v1/workflows/{workflow_id}/runs")
async def api_list_workflow_runs(
    workflow_id: str,
    request: Request,
    user: dict = Depends(require_auth("read")),
):
    runs = await list_workflow_runs(request.scope["env"], user["id"], workflow_id)
    return success(runs, meta={"total": len(runs)})


@router.post("/api/v1/workflows/{workflow_id}/cancel")
async def api_cancel_workflow(
    workflow_id: str,
    request: Request,
    user: dict = Depends(require_auth("write")),
):
    result = await cancel_workflow_run(request.scope["env"], user["id"], workflow_id)
    return success(result, message="Workflow run cancelled")
