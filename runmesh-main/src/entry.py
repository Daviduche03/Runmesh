import json
from datetime import datetime, timezone
from typing import Optional

from workers import WorkerEntrypoint, fetch
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.exceptions import RequestValidationError
from starlette.responses import RedirectResponse
from starlette.middleware.cors import CORSMiddleware
from db.orm import TaskModel, ApiKeyModel, WebhookModel, WebhookDeadLetterModel
from services.templating import apply_task_templates
from services.scheduler import TaskScheduler
from services.main import create_task, list_tasks, list_workflows, get_workflow, get_analytics, create_workflow, update_workflow, delete_workflow, delete_task
from services.workflow_graph import save_workflow_graph
from services.workflow_runner import (
    start_workflow_run,
    list_workflow_runs,
    recover_stale_workflow_runs,
)
from services.workflow_triggers import trigger_workflow_for_user, run_due_scheduled_workflows
from services.github import (
    exchange_code_for_token,
    fetch_github_user,
    fetch_primary_email,
    find_or_create_user,
    github_callback_redirect_uri,
)
from services import api_keys as api_keys_service
from services import connect as connect_service
from services import webhooks as webhooks_service
from services.task_queue import process_task_message
from db.connect_orm import (
    ConnectAppModel,
    ConnectAppUserModel,
    ConnectAuditEventModel,
    ConnectConnectionModel,
    ConnectGrantModel,
    ConnectIdentityModel,
    ConnectOtpChallengeModel,
    ConnectSessionModel,
    ConnectUserModel,
)
from utils.types import (
    TaskPublish,
    ScheduledTaskRequest, TaskRescheduleRequest,
    ApiKeyCreateRequest, WebhookCreateRequest, WorkflowCreate, WorkflowGraphUpdate, WorkflowUpdate,
    ConnectAppCreateRequest, ConnectSessionCreateRequest,
    ConnectConsentRequest, ConnectTokenRequest,
    ConnectOtpResendRequest, ConnectOtpVerifyRequest,
)
from utils.auth import encode_token
from utils.dual_auth import get_jwt_user, require_auth, get_authenticated_user
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
    "https://runmesh.vercel.app",
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


@app.get("/api/webhooks/dead-letters")
async def list_webhook_dead_letters(request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    include_replayed = request.query_params.get("include_replayed") == "1"
    items = await webhooks_service.list_dead_letters(
        WebhookDeadLetterModel(env.DB),
        current_user["id"],
        include_replayed=include_replayed,
    )
    return success(items, meta={"total": len(items)})


@app.post("/api/webhooks/dead-letters/{dead_letter_id}/replay")
async def replay_webhook_dead_letter(dead_letter_id: str, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    item = await webhooks_service.replay_dead_letter(
        WebhookDeadLetterModel(env.DB),
        env.WEBHOOK_QUEUE,
        dead_letter_id,
        current_user["id"],
    )
    return success(item, message="Dead letter replay queued")


@app.delete("/api/webhooks/dead-letters/{dead_letter_id}")
async def dismiss_webhook_dead_letter(dead_letter_id: str, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    deleted_id = await webhooks_service.dismiss_dead_letter(
        WebhookDeadLetterModel(env.DB),
        dead_letter_id,
        current_user["id"],
    )
    return success({"id": deleted_id}, message="Dead letter dismissed")


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
    try:
        page = int(request.query_params.get("page", 1))
        limit = int(request.query_params.get("limit", 50))
    except ValueError:
        raise HTTPException(status_code=400, detail="page and limit must be integers")
    if page < 1:
        raise HTTPException(status_code=400, detail="page must be at least 1")
    if limit < 1 or limit > 200:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 200")
    return await list_tasks(
        request.scope["env"].DB,
        user["id"],
        status=request.query_params.get("status"),
        workflow_id=request.query_params.get("workflow_id"),
        page=page,
        limit=limit,
    )


@app.post("/api/v1/tasks")
async def api_create_task(task: TaskPublish, request: Request, user: dict = Depends(require_auth("write"))):
    return await create_task(task, request.scope["env"], user["id"])


@app.delete("/api/v1/tasks/{task_id}")
async def api_delete_task(task_id: str, request: Request, user: dict = Depends(require_auth("write"))):
    return await delete_task(request.scope["env"], user["id"], task_id)


@app.post("/api/v1/tasks/schedule")
async def api_schedule_task(task: ScheduledTaskRequest, request: Request, user: dict = Depends(require_auth("write"))):
    env = request.scope["env"]
    scheduler = TaskScheduler(env.DB, env.TASK_QUEUE)

    if not task.url and not task.url_template:
        raise HTTPException(status_code=400, detail="url or url_template is required")

    try:
        scheduled_time = datetime.fromisoformat(task.scheduled_at.replace('Z', '+00:00'))
        if scheduled_time <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="scheduled_at must be in the future")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid scheduled_at format. Use ISO datetime.")

    idempotency_key = (task.idempotency_key or "").strip()
    if idempotency_key:
        existing = await TaskModel(env.DB).find_by_idempotency_key(user["id"], idempotency_key)
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
        "workflow_id": task.workflow_id,
    }
    if idempotency_key:
        task_data["idempotency_key"] = idempotency_key
    apply_task_templates(task_data, task.payload_template, task.url_template)

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

    cancelled = await scheduler.cancel_scheduled_task(task_id)
    if not cancelled:
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

    rescheduled = await scheduler.reschedule_task(task_id, scheduled_time)
    if not rescheduled:
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


@app.patch("/api/v1/workflows/{workflow_id}")
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
        body.description,
    )
    return success(data, message="Workflow updated")


@app.delete("/api/v1/workflows/{workflow_id}")
async def api_delete_workflow(
    workflow_id: str,
    request: Request,
    user: dict = Depends(require_auth("write")),
):
    return await delete_workflow(request.scope["env"], user["id"], workflow_id)


@app.put("/api/v1/workflows/{workflow_id}/graph")
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


@app.post("/api/v1/workflows/{workflow_id}/run")
async def api_run_workflow(
    workflow_id: str,
    request: Request,
    user: dict = Depends(require_auth("write")),
):
    run = await start_workflow_run(request.scope["env"], user["id"], workflow_id)
    return success(run, message="Workflow run started")


@app.post("/api/v1/workflows/{workflow_id}/trigger")
async def api_trigger_workflow(workflow_id: str, request: Request):
    user = await get_authenticated_user(request, ["write"])
    run = await trigger_workflow_for_user(
        request.scope["env"],
        user["id"],
        workflow_id,
        triggered_by="webhook",
    )
    return success(run, message="Workflow triggered")


@app.get("/api/v1/workflows/{workflow_id}/runs")
async def api_list_workflow_runs(
    workflow_id: str,
    request: Request,
    user: dict = Depends(require_auth("read")),
):
    runs = await list_workflow_runs(request.scope["env"], user["id"], workflow_id)
    return success(runs, meta={"total": len(runs)})


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


@app.post("/api/v1/connect/apps")
async def api_create_connect_app(
    req: ConnectAppCreateRequest,
    request: Request,
    current_user: dict = Depends(get_jwt_user),
):
    env = request.scope["env"]
    return await connect_service.create_connect_app(
        ConnectAppModel(env.DB),
        ConnectAuditEventModel(env.DB),
        req,
        current_user["id"],
    )


@app.get("/api/v1/connect/apps")
async def api_list_connect_apps(request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    return await connect_service.list_connect_apps(
        ConnectAppModel(env.DB),
        current_user["id"],
    )


@app.get("/api/v1/connect/apps/{app_id}")
async def api_get_connect_app(
    app_id: str,
    request: Request,
    current_user: dict = Depends(get_jwt_user),
):
    env = request.scope["env"]
    return await connect_service.get_connect_app(
        ConnectAppModel(env.DB),
        current_user["id"],
        app_id,
    )


@app.delete("/api/v1/connect/apps/{app_id}")
async def api_delete_connect_app(
    app_id: str,
    request: Request,
    current_user: dict = Depends(get_jwt_user),
):
    env = request.scope["env"]
    return await connect_service.delete_connect_app(
        ConnectAppModel(env.DB),
        current_user["id"],
        app_id,
    )


@app.get("/api/v1/connect/providers")
async def api_list_connect_providers():
    return await connect_service.list_connect_providers()


@app.post("/api/v1/connect/otp/verify")
async def api_verify_connect_otp(
    req: ConnectOtpVerifyRequest,
    request: Request,
    current_user: dict = Depends(require_auth()),
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


@app.post("/api/v1/connect/otp/resend")
async def api_resend_connect_otp(
    req: ConnectOtpResendRequest,
    request: Request,
    current_user: dict = Depends(require_auth()),
):
    env = request.scope["env"]
    return await connect_service.resend_connect_otp(
        env,
        ConnectAppModel(env.DB),
        ConnectOtpChallengeModel(env.DB),
        req,
        current_user["id"],
    )


@app.post("/api/v1/connect/sessions")
async def api_create_connect_session(
    req: ConnectSessionCreateRequest,
    request: Request,
    current_user: dict = Depends(require_auth()),
):
    env = request.scope["env"]
    base = getattr(env, "PUBLIC_URL", str(request.base_url).rstrip("/"))
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
    )


@app.get("/connect/authorize")
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


@app.get("/connect/callback")
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


@app.get("/connect/consent")
async def connect_consent_page(state: str, request: Request):
    env = request.scope["env"]
    return await connect_service.get_connect_consent_page(
        ConnectAppModel(env.DB),
        ConnectSessionModel(env.DB),
        ConnectConnectionModel(env.DB),
        state,
    )


@app.post("/connect/consent")
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


@app.post("/api/v1/connect/token")
async def api_exchange_connect_token(
    req: ConnectTokenRequest,
    request: Request,
    current_user: dict = Depends(require_auth()),
):
    env = request.scope["env"]
    return await connect_service.exchange_connect_token(
        ConnectAppModel(env.DB),
        ConnectSessionModel(env.DB),
        ConnectGrantModel(env.DB),
        req,
        current_user["id"],
        env.JWT_SECRET,
    )


@app.get("/api/v1/connect/grants/current")
async def api_get_current_grant(request: Request):
    env = request.scope["env"]
    token = request.headers.get("X-Connect-Grant-Token")
    if not token:
        raise HTTPException(status_code=401, detail="X-Connect-Grant-Token header required")
    return await connect_service.get_current_grant(
        ConnectGrantModel(env.DB),
        ConnectConnectionModel(env.DB),
        token,
        env.JWT_SECRET,
    )


@app.get("/api/v1/connect/apps/{app_id}/grants")
async def api_list_connect_app_grants(
    app_id: str,
    request: Request,
    current_user: dict = Depends(get_jwt_user),
):
    env = request.scope["env"]
    return await connect_service.list_connect_app_grants(
        ConnectAppModel(env.DB),
        ConnectGrantModel(env.DB),
        current_user["id"],
        app_id,
    )


# GitHub OAuth
@app.get("/auth/github/login")
async def github_login(request: Request):
    env = request.scope["env"]
    redirect_uri = github_callback_redirect_uri(env, str(request.base_url))
    from urllib.parse import quote
    encoded_redirect = quote(redirect_uri, safe="")
    return success({
        "url": f"https://github.com/login/oauth/authorize?client_id={env.GITHUB_CLIENT_ID}&redirect_uri={encoded_redirect}&scope=user:email"
    })


@app.get("/auth/github/callback")
async def github_callback(code: str, request: Request):
    env = request.scope["env"]
    redirect_uri = github_callback_redirect_uri(env, str(request.base_url))

    try:
        access_token = await exchange_code_for_token(env, code, redirect_uri)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        github_user = await fetch_github_user(access_token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        github_id = str(github_user["id"])
        name = github_user.get("name") or github_user["login"]
        avatar_url = github_user.get("avatar_url", "")
        github_email = github_user.get("email") or ""

        if not github_email:
            github_email = await fetch_primary_email(access_token)

        user_id = await find_or_create_user(env.DB, github_id, name, avatar_url, github_email, github_user["login"])
        token = encode_token({"id": user_id, "email": github_email, "name": name}, env.JWT_SECRET)
        frontend_url = getattr(env, "FRONTEND_URL", str(request.base_url).replace("/auth/github/callback", ""))
        return RedirectResponse(url=f"{frontend_url}/auth/callback?token={token}")
    except HTTPException:
        raise
    except Exception as e:
        print(f"GitHub callback error: {e}")
        raise HTTPException(status_code=500, detail="Failed to complete GitHub login")


# Dashboard-only (JWT)
@app.get("/api/analytics")
async def dashboard(request: Request, current_user: dict = Depends(get_jwt_user)):
    return await get_analytics(request.scope["env"].DB, current_user["id"])


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        import asgi
        return await asgi.fetch(app, request.js_object, self.env)

    async def scheduled(self, event, *_):
        scheduler = TaskScheduler(self.env.DB, self.env.TASK_QUEUE)
        try:
            enqueued_count = await scheduler.enqueue_due_tasks()
            if enqueued_count > 0:
                print(f"Enqueued {enqueued_count} scheduled tasks for execution")
            workflow_count = await run_due_scheduled_workflows(self.env)
            if workflow_count > 0:
                print(f"Started {workflow_count} scheduled workflow runs")
            recovered = await recover_stale_workflow_runs(self.env)
            if recovered > 0:
                print(f"Recovered {recovered} stale workflow run(s)")
        except Exception as e:
            print(f"Scheduler error: {e}")
            raise

    async def queue(self, batch, *_):
        queue_name = getattr(batch, "queue", None)
        if queue_name == webhooks_service.WEBHOOK_QUEUE_NAME:
            await webhooks_service.handle_webhook_queue_batch(
                self.env.DB,
                self.env.WEBHOOK_QUEUE,
                fetch,
                batch.messages,
            )
            return

        for message in batch.messages:
            await process_task_message(self.env, message, fetch)
