import json

from fastapi import HTTPException

from db.orm import TaskModel, WorkflowRunModel
from services.templating import resolve_task_request, read_fetch_response_body
from services.webhooks import dispatch_event, _ack_message, _queue_message_body
from services.workflow_runner import handle_workflow_task_completion

TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})


async def _maybe_resume_workflow(env, task_id: str, workflow_run_id: str, final_status: str) -> None:
    run_model = WorkflowRunModel(env.DB)
    run = await run_model.find_by_id(workflow_run_id)
    if not run or run.get("status") != "running":
        return
    await handle_workflow_task_completion(env, task_id, workflow_run_id, final_status)


async def _finalize_task(
    env,
    task_id: str,
    task_row: dict,
    workflow_run_id: str | None,
    final_status: str,
    response_body: str,
    target_status_code: int | None,
) -> None:
    task_model = TaskModel(env.DB)
    await task_model.complete_execution(
        task_id,
        final_status,
        response_body=response_body or "",
        response_status=target_status_code or 0,
    )
    if task_row.get("user_id"):
        event = "task.completed" if final_status == "completed" else "task.failed"
        terminal_task = {
            **task_row,
            "status": final_status,
            "retries": (task_row.get("retries") or 0),
        }
        await dispatch_event(
            env.DB,
            env.WEBHOOK_QUEUE,
            task_row["user_id"],
            event,
            terminal_task,
            {"target_status_code": target_status_code},
        )
    if workflow_run_id:
        await handle_workflow_task_completion(
            env,
            task_id,
            workflow_run_id,
            final_status,
        )


async def process_task_message(env, message, fetch_fn) -> None:
    task_model = TaskModel(env.DB)
    task_id = None
    task_row = None
    workflow_run_id = None

    try:
        payload = _queue_message_body(message)
        task_id = payload.get("task_id")
        workflow_run_id = payload.get("workflow_run_id")
        if not task_id:
            _ack_message(message)
            return

        task_row = await task_model.find_by_id(task_id)
        if not task_row:
            _ack_message(message)
            return

        existing_status = (task_row.get("status") or "").lower()
        if existing_status in TERMINAL_STATUSES:
            if workflow_run_id:
                await _maybe_resume_workflow(env, task_id, workflow_run_id, existing_status)
            _ack_message(message)
            return

        await task_model.update_status(task_id, "running")
        user_id = task_row.get("user_id")
        if user_id:
            running_task = {**task_row, "status": "running"}
            await dispatch_event(
                env.DB,
                env.WEBHOOK_QUEUE,
                user_id,
                "task.running",
                running_task,
            )

        final_status = "failed"
        target_status_code = None
        response_body = ""

        try:
            from services.workflow_runner import build_step_chain_context

            chain_context = {}
            if workflow_run_id:
                chain_context = await build_step_chain_context(env, task_row)
            target_url, task_payload = resolve_task_request(task_row, chain_context)
        except HTTPException as exc:
            print(f"Task template error for {task_id}: {exc.detail}")
            raise ValueError(str(exc.detail)) from exc

        fetch_body = (
            json.dumps(task_payload)
            if isinstance(task_payload, (dict, list))
            else task_payload
        )
        res = await fetch_fn(
            target_url,
            method="POST",
            headers={"content-type": "application/json"},
            body=fetch_body,
        )
        target_status_code = res.status
        response_body = await read_fetch_response_body(res)
        final_status = "completed" if res.status < 400 else "failed"

        if final_status == "failed":
            retries = task_row.get("retries") or 0
            max_retries = task_row.get("max_retries") or 5
            if retries < max_retries:
                await task_model.increment_retries(task_id, "queued")
                await env.TASK_QUEUE.send(
                    {"task_id": task_id, "workflow_run_id": workflow_run_id}
                )
                _ack_message(message)
                return

        await _finalize_task(
            env,
            task_id,
            task_row,
            workflow_run_id,
            final_status,
            response_body,
            target_status_code,
        )
        _ack_message(message)
    except Exception as exc:
        print(f"Task execution error for {task_id}: {exc}")
        if not task_id or not task_row:
            _ack_message(message)
            return

        retries = task_row.get("retries") or 0
        max_retries = task_row.get("max_retries") or 5
        if retries < max_retries:
            await task_model.increment_retries(task_id, "queued")
            await env.TASK_QUEUE.send(
                {"task_id": task_id, "workflow_run_id": workflow_run_id}
            )
            _ack_message(message)
            return

        try:
            await _finalize_task(
                env,
                task_id,
                task_row,
                workflow_run_id,
                "failed",
                "",
                None,
            )
            _ack_message(message)
        except Exception as finalize_exc:
            print(f"Task completion handler error for {task_id}: {finalize_exc}")
