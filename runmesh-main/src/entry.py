import json
from datetime import datetime, timezone
from typing import Optional

from workers import WorkerEntrypoint, fetch
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.exceptions import RequestValidationError
from starlette.responses import RedirectResponse
from starlette.middleware.cors import CORSMiddleware
from db.orm import TaskModel, ApiKeyModel, WebhookModel
from services.scheduler import TaskScheduler
from services.main import create_task, list_tasks, list_workflows, get_workflow, get_analytics, create_workflow
from services.github import exchange_code_for_token, fetch_github_user, fetch_primary_email, find_or_create_user
from services import api_keys as api_keys_service
from services import webhooks as webhooks_service
from utils.types import (
    TaskPublish,
    ScheduledTaskRequest, TaskRescheduleRequest,
    ApiKeyCreateRequest, WebhookCreateRequest, WorkflowCreate
)
from utils.auth import encode_token
from utils.dual_auth import get_jwt_user, require_auth
from utils.responses import success
from utils.errors import http_exception_handler, validation_exception_handler

app = FastAPI(
    title="Runmesh API",
    description="Task execution API for webhooks, queues, and scheduled jobs. "
    "Use /api/v1 for tasks and workflows. Dashboard-only routes live under /api/analytics.",
    version="1.0.0",
)

origins = [
    "http://localhost:5174",
    "http://localhost:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)


@app.get("/")
async def root():
    return success({"name": "Runmesh API", "version": "1.0.0"})


@app.get("/health")
async def health():
    return success({"status": "ok"})


# API Key Endpoints
@app.post("/api-keys")
async def create_api_key(req: ApiKeyCreateRequest, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    return await api_keys_service.create_api_key(ApiKeyModel(env.DB), req, current_user["id"])


@app.get("/api-keys")
async def list_api_keys(request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    return await api_keys_service.list_api_keys(ApiKeyModel(env.DB), current_user["id"])


@app.delete("/api-keys/{key_id}")
async def delete_api_key(key_id: str, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    return await api_keys_service.delete_api_key(ApiKeyModel(env.DB), key_id, current_user["id"])


@app.get("/api/webhooks")
async def list_webhooks(request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    items = await webhooks_service.list_webhooks(WebhookModel(env.DB), current_user["id"])
    return success(items, meta={"total": len(items)})


@app.post("/api/webhooks")
async def create_webhook(req: WebhookCreateRequest, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    item = await webhooks_service.create_webhook(
        WebhookModel(env.DB),
        req.name,
        req.url,
        req.events,
        current_user["id"],
    )
    return success(item, message="Webhook created")


@app.post("/api/webhooks/{webhook_id}/rotate-secret")
async def rotate_webhook_secret(webhook_id: str, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    item = await webhooks_service.rotate_webhook_secret(
        WebhookModel(env.DB),
        webhook_id,
        current_user["id"],
    )
    return success(item, message="Webhook secret rotated")


@app.delete("/api/webhooks/{webhook_id}")
async def delete_webhook(webhook_id: str, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    deleted_id = await webhooks_service.delete_webhook(
        WebhookModel(env.DB),
        webhook_id,
        current_user["id"],
    )
    return success({"id": deleted_id}, message="Webhook deleted")


# API v1 — tasks & workflows (JWT or API key)
@app.get("/api/v1/tasks")
async def api_list_tasks(request: Request, user: dict = Depends(require_auth("read"))):
    return await list_tasks(
        request.scope["env"].DB,
        user["id"],
        status=request.query_params.get("status"),
        workflow_id=request.query_params.get("workflow_id"),
        page=int(request.query_params.get("page", 1)),
        limit=int(request.query_params.get("limit", 50)),
    )


@app.post("/api/v1/tasks")
async def api_create_task(task: TaskPublish, request: Request, user: dict = Depends(require_auth("write"))):
    return await create_task(task, request.scope["env"], user["id"])


@app.post("/api/v1/tasks/schedule")
async def api_schedule_task(task: ScheduledTaskRequest, request: Request, user: dict = Depends(require_auth("write"))):
    env = request.scope["env"]
    scheduler = TaskScheduler(env.DB, env.TASK_QUEUE)

    if not task.url:
        raise HTTPException(status_code=400, detail="url is required")

    try:
        scheduled_time = datetime.fromisoformat(task.scheduled_at.replace('Z', '+00:00'))
        if scheduled_time <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="scheduled_at must be in the future")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid scheduled_at format. Use ISO datetime.")

    task_data = {
        "url": task.url,
        "payload": json.dumps(task.payload),
        "type": task.type,
        "max_retries": task.max_retries,
        "user_id": user["id"],
        "workflow_id": task.workflow_id,
    }

    task_id = await scheduler.schedule_task(task_data, scheduled_time)
    return success({"task_id": task_id, "scheduled_at": task.scheduled_at}, message="Task scheduled")


@app.get("/api/v1/tasks/scheduled")
async def api_get_scheduled_tasks(request: Request, user: dict = Depends(require_auth("read"))):
    env = request.scope["env"]
    scheduler = TaskScheduler(env.DB, env.TASK_QUEUE)
    tasks = await scheduler.get_scheduled_tasks(
        user_id=user["id"],
        status=request.query_params.get("status"),
        limit=int(request.query_params.get("limit", 50)),
    )
    return success(tasks, meta={"total": len(tasks)})


@app.post("/api/v1/tasks/{task_id}/cancel")
async def api_cancel_scheduled_task(task_id: str, request: Request, user: dict = Depends(require_auth("write"))):
    env = request.scope["env"]
    scheduler = TaskScheduler(env.DB, env.TASK_QUEUE)

    task = await TaskModel(env.DB).find_by_id(task_id)
    if not task or task.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Task not found")

    success = await scheduler.cancel_scheduled_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail="Task cannot be cancelled (may already be executed)")

    return success({"task_id": task_id}, message="Task cancelled")


@app.post("/api/v1/tasks/{task_id}/reschedule")
async def api_reschedule_task(task_id: str, reschedule_data: TaskRescheduleRequest, request: Request, user: dict = Depends(require_auth("write"))):
    env = request.scope["env"]
    scheduler = TaskScheduler(env.DB, env.TASK_QUEUE)

    task = await TaskModel(env.DB).find_by_id(task_id)
    if not task or task.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Task not found")

    try:
        scheduled_time = datetime.fromisoformat(reschedule_data.scheduled_at.replace('Z', '+00:00'))
        if scheduled_time <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="scheduled_at must be in the future")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid scheduled_at format. Use ISO datetime.")

    success = await scheduler.reschedule_task(task_id, scheduled_time)
    if not success:
        raise HTTPException(status_code=400, detail="Task cannot be rescheduled")

    return success(
        {"task_id": task_id, "scheduled_at": reschedule_data.scheduled_at},
        message="Task rescheduled",
    )


@app.get("/api/v1/workflows")
async def api_list_workflows(request: Request, user: dict = Depends(require_auth("read"))):
    workflows = await list_workflows(request.scope["env"], user["id"])
    return success(workflows, meta={"total": len(workflows)})


@app.post("/api/v1/workflows")
async def api_create_workflow(workflow: WorkflowCreate, request: Request, user: dict = Depends(require_auth("write"))):
    return await create_workflow(workflow, request.scope["env"], user["id"])


@app.get("/api/v1/workflows/{workflow_id}")
async def api_get_workflow(workflow_id: str, request: Request, user: dict = Depends(require_auth("read"))):
    return success(await get_workflow(request.scope["env"], user["id"], workflow_id))


@app.post("/api/v1/task/publish")
async def api_publish_task_legacy(task: TaskPublish, request: Request, user: dict = Depends(require_auth("write"))):
    return await create_task(task, request.scope["env"], user["id"])


@app.post("/api/v1/task/schedule")
async def api_schedule_task_legacy(task: ScheduledTaskRequest, request: Request, user: dict = Depends(require_auth("write"))):
    return await api_schedule_task(task, request, user)


@app.post("/api/v1/task/{task_id}/cancel")
async def api_cancel_task_legacy(task_id: str, request: Request, user: dict = Depends(require_auth("write"))):
    return await api_cancel_scheduled_task(task_id, request, user)


@app.post("/api/v1/task/{task_id}/reschedule")
async def api_reschedule_task_legacy(task_id: str, reschedule_data: TaskRescheduleRequest, request: Request, user: dict = Depends(require_auth("write"))):
    return await api_reschedule_task(task_id, reschedule_data, request, user)


# GitHub OAuth
@app.get("/auth/github/login")
async def github_login(request: Request):
    env = request.scope["env"]
    base = getattr(env, "PUBLIC_URL", str(request.base_url).rstrip("/"))
    redirect_uri = f"{base}/auth/github/callback"
    return success({
        "url": f"https://github.com/login/oauth/authorize?client_id={env.GITHUB_CLIENT_ID}&redirect_uri={redirect_uri}&scope=user:email"
    })


@app.get("/auth/github/callback")
async def github_callback(code: str, request: Request):
    env = request.scope["env"]

    try:
        access_token = await exchange_code_for_token(env, code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        github_user = await fetch_github_user(access_token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    github_id = str(github_user["id"])
    name = github_user.get("name") or github_user["login"]
    avatar_url = github_user.get("avatar_url", "")
    github_email = github_user.get("email", "")

    if not github_email:
        github_email = await fetch_primary_email(access_token)

    user_id = await find_or_create_user(env.DB, github_id, name, avatar_url, github_email, github_user["login"])

    token = encode_token({"id": user_id, "email": github_email, "name": name}, env.JWT_SECRET)
    frontend_url = getattr(env, "FRONTEND_URL", str(request.base_url).replace("/auth/github/callback", ""))
    return RedirectResponse(url=f"{frontend_url}/auth/callback?token={token}")


# Dashboard-only (JWT)
@app.get("/api/analytics")
async def dashboard(request: Request, current_user: dict = Depends(get_jwt_user)):
    return await get_analytics(request.scope["env"].DB, current_user["id"])


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        import asgi
        return await asgi.fetch(app, request.js_object, self.env)

    async def queue(self, batch, env, ctx):
        queue_name = getattr(batch, "queue", None)
        if queue_name == webhooks_service.WEBHOOK_QUEUE_NAME:
            await webhooks_service.handle_webhook_queue_batch(
                self.env.DB,
                self.env.WEBHOOK_QUEUE,
                ctx.fetch,
                batch.messages,
            )
            return

        task_model = TaskModel(self.env.DB)

        for message in batch.messages:
            task_id = None
            task_row = None
            final_status = "failed"
            target_status_code = None
            try:
                payload = message.body
                task_id = payload.get("task_id")
                if not task_id:
                    await message.ack()
                    continue

                task_row = await task_model.find_by_id(task_id)
                if not task_row:
                    await message.ack()
                    continue

                await task_model.update_status(task_id, "running")
                user_id = task_row.get("user_id")
                if user_id:
                    running_task = {**task_row, "status": "running"}
                    await webhooks_service.dispatch_event(
                        self.env.DB,
                        self.env.WEBHOOK_QUEUE,
                        user_id,
                        "task.running",
                        running_task,
                    )

                task_payload = task_row.get("payload")
                if isinstance(task_payload, str):
                    task_payload = json.loads(task_payload)

                res = await ctx.fetch(
                    task_row["url"],
                    method="POST",
                    headers={"content-type": "application/json"},
                    body=task_payload,
                )
                target_status_code = res.status_code
                final_status = "completed" if res.status_code < 400 else "failed"
            except Exception as e:
                print(f"Task execution error: {e}")
                final_status = "failed"

            try:
                if task_id:
                    await task_model.increment_retries(task_id, final_status)
                    if task_row and task_row.get("user_id"):
                        event = "task.completed" if final_status == "completed" else "task.failed"
                        terminal_task = {
                            **task_row,
                            "status": final_status,
                            "retries": (task_row.get("retries") or 0),
                        }
                        await webhooks_service.dispatch_event(
                            self.env.DB,
                            self.env.WEBHOOK_QUEUE,
                            task_row["user_id"],
                            event,
                            terminal_task,
                            {"target_status_code": target_status_code},
                        )
                await message.ack()
            except Exception:
                pass
