import asyncio
import json

from runtime import http_fetch
from services.scheduler import TaskScheduler
from services.task_queue import process_task_message
from services.workflow_runner import recover_stale_workflow_runs
from services.workflow_triggers import run_due_scheduled_workflows
from utils.log import log_error, log_info, log_warn

TASK_QUEUE_NAME = "runmesh-tasks"
WEBHOOK_QUEUE_NAME = "runmesh-webhooks"


async def _run_task(env, payload: dict) -> None:
    await process_task_message(env, payload, http_fetch.fetch)


async def _run_webhook(env, payload: dict) -> None:
    from services.webhooks import handle_webhook_queue_batch

    await handle_webhook_queue_batch(env.DB, env.WEBHOOK_QUEUE, http_fetch.fetch, [payload])


async def _drain(env, queue, handler, poll_interval: float) -> None:
    while True:
        worked = False
        try:
            for item in await queue.receive(limit=10):
                worked = True
                try:
                    await handler(env, json.loads(item["body"]))
                except Exception as exc:
                    log_error(
                        "queue_message_failed",
                        queue=queue.name,
                        attempts=item["attempts"],
                        error=str(exc),
                    )
                    if not await queue.retry(item["body"], item["attempts"]):
                        log_error("queue_message_exhausted", queue=queue.name, error=str(exc))
        except Exception as exc:
            log_error("queue_worker_error", queue=queue.name, error=str(exc))
        if not worked:
            await asyncio.sleep(poll_interval)


async def _sweep_step(label: str, coro) -> None:
    try:
        count = await coro
    except Exception as exc:
        log_error("sweep_step_failed", step=label, error=str(exc))
        return
    if count:
        log_info("sweep_step", step=label, count=count)


async def sweep(env) -> None:
    """The cron tick: pick up due work. Steps are isolated so one failure
    (e.g. a table that does not exist yet) does not starve the rest."""
    scheduler = TaskScheduler(env.DB, env.TASK_QUEUE)
    await _sweep_step("enqueue_due_tasks", scheduler.enqueue_due_tasks())
    await _sweep_step("run_due_scheduled_workflows", run_due_scheduled_workflows(env))

    try:
        from services.triggers import run_due_schedule_triggers

        await _sweep_step("run_due_schedule_triggers", run_due_schedule_triggers(env))
    except Exception as exc:
        log_warn("trigger_sweep_unavailable", error=str(exc))

    await _sweep_step("recover_stale_workflow_runs", recover_stale_workflow_runs(env))


async def _scheduler_loop(env, interval: float) -> None:
    while True:
        try:
            await sweep(env)
        except Exception as exc:
            log_error("sweep_failed", error=str(exc))
        await asyncio.sleep(interval)


async def start(env, poll_interval: float = 1.0, sweep_interval: float = 5.0) -> list[asyncio.Task]:
    return [
        asyncio.create_task(_drain(env, env.TASK_QUEUE, _run_task, poll_interval), name="runmesh-tasks"),
        asyncio.create_task(_drain(env, env.WEBHOOK_QUEUE, _run_webhook, poll_interval), name="runmesh-webhooks"),
        asyncio.create_task(_scheduler_loop(env, sweep_interval), name="runmesh-scheduler"),
    ]


async def stop(tasks: list[asyncio.Task]) -> None:
    for task in tasks:
        task.cancel()
    for task in tasks:
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
