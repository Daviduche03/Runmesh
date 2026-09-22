from fastapi import (
    FastAPI,
    HTTPException,
)

from fastapi.exceptions import RequestValidationError

from services import webhooks as webhooks_service

from services.scheduler import TaskScheduler

from services.task_queue import process_task_message

from services.workflow_runner import recover_stale_workflow_runs

from services.workflow_triggers import run_due_scheduled_workflows

from starlette.middleware.cors import CORSMiddleware

from utils.errors import (
    http_exception_handler,
    validation_exception_handler,
)

from workers import (
    WorkerEntrypoint,
    fetch,
)

from routes.system import router as system_router
from routes.api_keys import router as api_keys_router
from routes.agents import router as agents_router
from routes.webhooks import router as webhooks_router
from routes.tasks import router as tasks_router
from routes.workflows import router as workflows_router
from routes.policies import router as policies_router
from routes.collection import router as collection_router
from routes.tools import router as tools_router
from routes.connect_sessions import router as connect_sessions_router
from routes.connect_oauth import router as connect_oauth_router
from routes.connect_grants import router as connect_grants_router
from routes.workspaces import router as workspaces_router
from routes.auth import router as auth_router
from routes.dashboard import router as dashboard_router

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
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key", "X-Connect-Grant-Token"],
)

app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)


app.include_router(system_router)
app.include_router(api_keys_router)
app.include_router(agents_router)
app.include_router(webhooks_router)
app.include_router(tasks_router)
app.include_router(workflows_router)
app.include_router(policies_router)
app.include_router(collection_router)
app.include_router(tools_router)
app.include_router(connect_sessions_router)
app.include_router(connect_oauth_router)
app.include_router(connect_grants_router)
app.include_router(workspaces_router)
app.include_router(auth_router)
app.include_router(dashboard_router)


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
