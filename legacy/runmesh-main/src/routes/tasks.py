import json

from datetime import (
    datetime,
    timezone,
)

from db.orm import TaskModel

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
)

from services.main import (
    create_task,
    delete_task,
    list_tasks,
)

from services.scheduler import TaskScheduler

from services.templating import apply_task_templates

from services.workspaces import (
    require_row_access,
    resolve_request_workspace,
)

from utils.dual_auth import require_auth

from utils.responses import success

from utils.types import (
    ScheduledTaskRequest,
    TaskPublish,
    TaskRescheduleRequest,
)

from utils.url_security import validate_outbound_url

router = APIRouter()


@router.get("/api/v1/tasks")
async def api_list_tasks(request: Request, user: dict = Depends(require_auth("read"))):
    try:
        page = int(request.query_params.get("page", 1))
        limit = int(request.query_params.get("limit", 50))
    except ValueError:
        raise HTTPException(status_code=400, detail="page and limit must be integers")
    if page < 1:
        raise HTTPException(status_code=400, detail="page must be at least 1")
    if limit < 1 or limit > 200:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 200")
    workspace_id = await resolve_request_workspace(request, user)
    return await list_tasks(
        request.scope["env"].DB,
        user["id"],
        status=request.query_params.get("status"),
        workflow_id=request.query_params.get("workflow_id"),
        page=page,
        limit=limit,
        workspace_id=workspace_id,
    )


@router.post("/api/v1/tasks")
async def api_create_task(task: TaskPublish, request: Request, user: dict = Depends(require_auth("write"))):
    workspace_id = await resolve_request_workspace(request, user)
    return await create_task(task, request.scope["env"], user["id"], workspace_id)


@router.delete("/api/v1/tasks/{task_id}")
async def api_delete_task(task_id: str, request: Request, user: dict = Depends(require_auth("write"))):
    return await delete_task(request.scope["env"], user["id"], task_id)


@router.post("/api/v1/tasks/schedule")
async def api_schedule_task(task: ScheduledTaskRequest, request: Request, user: dict = Depends(require_auth("write"))):
    env = request.scope["env"]
    scheduler = TaskScheduler(env.DB, env.TASK_QUEUE)

    if not task.url and not task.url_template:
        raise HTTPException(status_code=400, detail="url or url_template is required")
    if task.url and task.url.strip():
        # SSRF blocklist for static URLs (templated URLs are validated after render)
        validate_outbound_url(task.url)

    try:
        scheduled_time = datetime.fromisoformat(task.scheduled_at.replace('Z', '+00:00'))
        if scheduled_time <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="scheduled_at must be in the future")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid scheduled_at format. Use ISO datetime.")

    idempotency_key = (task.idempotency_key or "").strip()
    workspace_id = await resolve_request_workspace(request, user)
    if idempotency_key:
        existing = await TaskModel(env.DB).find_by_idempotency_key(workspace_id, idempotency_key)
        if existing:
            return success(
                {"task_id": existing["id"], "scheduled_at": existing.get("scheduled_at")},
                message="Task already scheduled",
            )

    task_data = {
        "url": task.url or "",
        "payload": json.dumps(task.payload),
        "type": task.type,
        "max_retries": task.max_retries,
        "user_id": user["id"],
        "workspace_id": workspace_id,
        "workflow_id": task.workflow_id,
    }
    if task.signing_secret:
        task_data["signing_secret"] = task.signing_secret
    if idempotency_key:
        task_data["idempotency_key"] = idempotency_key
    apply_task_templates(task_data, task.payload_template, task.url_template)

    task_id = await scheduler.schedule_task(task_data, scheduled_time)
    return success({"task_id": task_id, "scheduled_at": task.scheduled_at}, message="Task scheduled")


@router.get("/api/v1/tasks/scheduled")
async def api_get_scheduled_tasks(request: Request, user: dict = Depends(require_auth("read"))):
    env = request.scope["env"]
    scheduler = TaskScheduler(env.DB, env.TASK_QUEUE)
    workspace_id = await resolve_request_workspace(request, user)
    tasks = await scheduler.get_scheduled_tasks(
        user_id=user["id"],
        status=request.query_params.get("status"),
        limit=int(request.query_params.get("limit", 50)),
        workspace_id=workspace_id,
    )
    return success(tasks, meta={"total": len(tasks)})


@router.post("/api/v1/tasks/{task_id}/cancel")
async def api_cancel_scheduled_task(task_id: str, request: Request, user: dict = Depends(require_auth("write"))):
    env = request.scope["env"]
    scheduler = TaskScheduler(env.DB, env.TASK_QUEUE)

    task = await TaskModel(env.DB).find_by_id(task_id)
    await require_row_access(env.DB, user["id"], task, not_found_detail="Task not found")

    cancelled = await scheduler.cancel_scheduled_task(task_id)
    if not cancelled:
        raise HTTPException(status_code=400, detail="Task cannot be cancelled (may already be executed)")

    return success({"task_id": task_id}, message="Task cancelled")


@router.post("/api/v1/tasks/{task_id}/reschedule")
async def api_reschedule_task(task_id: str, reschedule_data: TaskRescheduleRequest, request: Request, user: dict = Depends(require_auth("write"))):
    env = request.scope["env"]
    scheduler = TaskScheduler(env.DB, env.TASK_QUEUE)

    task = await TaskModel(env.DB).find_by_id(task_id)
    await require_row_access(env.DB, user["id"], task, not_found_detail="Task not found")

    try:
        scheduled_time = datetime.fromisoformat(reschedule_data.scheduled_at.replace('Z', '+00:00'))
        if scheduled_time <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="scheduled_at must be in the future")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid scheduled_at format. Use ISO datetime.")

    rescheduled = await scheduler.reschedule_task(task_id, scheduled_time)
    if not rescheduled:
        raise HTTPException(status_code=400, detail="Task cannot be rescheduled")

    return success(
        {"task_id": task_id, "scheduled_at": reschedule_data.scheduled_at},
        message="Task rescheduled",
    )


@router.post("/api/v1/task/publish")
async def api_publish_task_legacy(task: TaskPublish, request: Request, user: dict = Depends(require_auth("write"))):
    return await create_task(task, request.scope["env"], user["id"])


@router.post("/api/v1/task/schedule")
async def api_schedule_task_legacy(task: ScheduledTaskRequest, request: Request, user: dict = Depends(require_auth("write"))):
    return await api_schedule_task(task, request, user)


@router.post("/api/v1/task/{task_id}/cancel")
async def api_cancel_task_legacy(task_id: str, request: Request, user: dict = Depends(require_auth("write"))):
    return await api_cancel_scheduled_task(task_id, request, user)


@router.post("/api/v1/task/{task_id}/reschedule")
async def api_reschedule_task_legacy(task_id: str, reschedule_data: TaskRescheduleRequest, request: Request, user: dict = Depends(require_auth("write"))):
    return await api_reschedule_task(task_id, reschedule_data, request, user)
