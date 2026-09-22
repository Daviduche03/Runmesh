import uuid

from datetime import (
    datetime,
    timezone,
)

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
)

from utils.dual_auth import get_jwt_user

from utils.responses import success

from utils.types import WorkspaceOnboardRequest

router = APIRouter()


@router.post("/api/v1/workspaces/onboard")
async def api_onboard_workspace(
    req: WorkspaceOnboardRequest,
    request: Request,
    current_user: dict = Depends(get_jwt_user),
):
    from services import workspaces as workspaces_service

    env = request.scope["env"]
    return await workspaces_service.onboard_workspace(env.DB, current_user["id"], req)


@router.get("/api/v1/workspaces")
async def api_list_workspaces(request: Request, current_user: dict = Depends(get_jwt_user)):
    from services import workspaces as workspaces_service

    env = request.scope["env"]
    return await workspaces_service.list_user_workspaces(env.DB, current_user["id"])


@router.post("/api/v1/workspaces/invites/{token}/accept")
async def api_accept_workspace_invite(
    token: str,
    request: Request,
    current_user: dict = Depends(get_jwt_user),
):
    from services import workspaces as workspaces_service

    env = request.scope["env"]
    return await workspaces_service.accept_workspace_invite(env.DB, current_user["id"], token)


# CLI Auth — device code flow
@router.get("/api/workspace/projects")
async def workspace_list_projects(request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    rows = await env.DB.prepare("""
        SELECT * FROM workspace_projects WHERE user_id = ? ORDER BY created_at DESC
    """).bind(current_user["id"]).all()
    if not rows:
        return success([])
    results = rows.results if hasattr(rows, 'results') else []
    projects = []
    for r in results:
        row = r.as_py() if hasattr(r, 'as_py') else dict(r)
        projects.append(row)
    return success(projects, meta={"total": len(projects)})


@router.post("/api/workspace/projects")
async def workspace_link_project(request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    body = await request.json()
    prefix = body.get("prefix", "").strip()
    bucket = body.get("bucket", "").strip()
    local_path = body.get("local_path", "").strip() or None
    if not prefix:
        raise HTTPException(status_code=400, detail="prefix is required")
    if not bucket:
        raise HTTPException(status_code=400, detail="bucket is required")
    now = datetime.now(timezone.utc).isoformat()
    project_id = str(uuid.uuid4())
    await env.DB.prepare("""
        INSERT INTO workspace_projects (id, user_id, prefix, bucket, local_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """).bind(project_id, current_user["id"], prefix, bucket, local_path, now, now).run()
    return success({
        "id": project_id,
        "prefix": prefix,
        "bucket": bucket,
        "local_path": local_path,
        "created_at": now,
    }, message="Project linked")


@router.delete("/api/workspace/projects/{project_id}")
async def workspace_unlink_project(project_id: str, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    await env.DB.prepare("DELETE FROM workspace_projects WHERE id = ? AND user_id = ?").bind(project_id, current_user["id"]).run()
    return success({"id": project_id}, message="Project unlinked")


# Dashboard-only (JWT)
