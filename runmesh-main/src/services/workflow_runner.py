import json
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

from db.orm import TaskModel, WorkflowModel, WorkflowRunModel
from services.templating import parse_stored_response
from services.workflow_graph import resolve_graph, linear_order_from_trigger, _node_map


def _step_output_from_task(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "task_id": str(task.get("id") or ""),
        "step": int(task.get("step_order") or 0) + 1,
        "status": task.get("response_status"),
        "body": parse_stored_response(task.get("response_body")),
    }


async def build_step_chain_context(env, task_row: dict[str, Any]) -> dict[str, Any]:
    workflow_id = task_row.get("workflow_id")
    if not workflow_id:
        return {}

    workflow_model = WorkflowModel(env.DB)
    task_model = TaskModel(env.DB)
    workflow = await workflow_model.find_by_id(str(workflow_id))
    if not workflow:
        return {}

    tasks = await task_model.list_by_workflow_id(str(workflow_id))
    ordered = _ordered_workflow_tasks(workflow, tasks)
    current_id = str(task_row.get("id") or "")

    prior_steps: list[dict[str, Any]] = []
    for task in ordered:
        if str(task.get("id")) == current_id:
            break
        if (task.get("status") or "").lower() != "completed":
            continue
        prior_steps.append(_step_output_from_task(task))

    if not prior_steps:
        return {}

    return {
        "prev": prior_steps[-1],
        "steps": prior_steps,
    }


async def _set_workflow_status(workflow_model: WorkflowModel, workflow_id: str, status: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    await workflow_model.update(
        "workflows",
        "id = ?",
        {"status": status, "updated_at": now},
        workflow_id,
    )


async def list_workflow_runs(env, user_id: str, workflow_id: str) -> list[dict[str, Any]]:
    workflow_model = WorkflowModel(env.DB)
    workflow = await workflow_model.find_by_id(workflow_id)
    if not workflow or workflow.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Workflow not found")

    run_model = WorkflowRunModel(env.DB)
    runs = await run_model.list_by_workflow_id(workflow_id)
    return [_format_run(run) for run in runs]


async def start_workflow_run(
    env,
    user_id: str,
    workflow_id: str,
    triggered_by: str = "manual",
) -> dict[str, Any]:
    workflow_model = WorkflowModel(env.DB)
    task_model = TaskModel(env.DB)
    run_model = WorkflowRunModel(env.DB)

    workflow = await workflow_model.find_by_id(workflow_id)
    if not workflow or workflow.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Workflow not found")

    tasks = await task_model.list_by_workflow_id(workflow_id)
    active = await run_model.find_active_for_workflow(workflow_id)
    if active:
        in_flight = any(
            (t.get("status") or "").lower() in ("queued", "running")
            for t in tasks
        )
        if in_flight:
            raise HTTPException(status_code=409, detail="Workflow already has a run in progress")
        await run_model.update(
            "workflow_runs",
            "id = ?",
            {"status": "failed", "completed_at": datetime.now(timezone.utc).isoformat()},
            str(active["id"]),
        )

    if not tasks:
        raise HTTPException(status_code=400, detail="Workflow has no steps to run")

    ordered = _ordered_workflow_tasks(workflow, tasks)
    if not ordered:
        raise HTTPException(status_code=400, detail="Workflow has no runnable HTTP steps")

    for task in ordered:
        url = (task.get("url") or "").strip()
        if not url and not task.get("url_template"):
            raise HTTPException(
                status_code=400,
                detail=f"Step {int(task.get('step_order') or 0) + 1} needs a URL before running",
            )

    now = datetime.now(timezone.utc).isoformat()
    run_id = await run_model.create({
        "workflow_id": workflow_id,
        "status": "running",
        "triggered_by": triggered_by,
        "current_step": 0,
        "started_at": now,
        "user_id": user_id,
    })

    for task in ordered:
        await task_model.reset_for_workflow_run(str(task["id"]))

    first_task_id = str(ordered[0]["id"])
    await task_model.update_status(first_task_id, "queued")
    await env.TASK_QUEUE.send({"task_id": first_task_id, "workflow_run_id": run_id})
    await _set_workflow_status(workflow_model, workflow_id, "running")

    run = await run_model.find_by_id(run_id)
    return _format_run(run)


async def handle_workflow_task_completion(
    env,
    task_id: str,
    workflow_run_id: str,
    final_status: str,
) -> None:
    run_model = WorkflowRunModel(env.DB)
    task_model = TaskModel(env.DB)
    workflow_model = WorkflowModel(env.DB)

    run = await run_model.find_by_id(workflow_run_id)
    if not run or run.get("status") != "running":
        return

    task_row = await task_model.find_by_id(task_id)
    if not task_row or not task_row.get("workflow_id"):
        return

    workflow_id = str(task_row["workflow_id"])
    if str(run.get("workflow_id")) != workflow_id:
        return

    now = datetime.now(timezone.utc).isoformat()

    if final_status != "completed":
        await run_model.update(
            "workflow_runs",
            "id = ?",
            {"status": "failed", "completed_at": now},
            workflow_run_id,
        )
        await _set_workflow_status(workflow_model, workflow_id, "failed")
        return

    workflow = await workflow_model.find_by_id(workflow_id)
    if not workflow:
        await run_model.update(
            "workflow_runs",
            "id = ?",
            {"status": "failed", "completed_at": now},
            workflow_run_id,
        )
        await _set_workflow_status(workflow_model, workflow_id, "failed")
        return

    ordered = _ordered_workflow_tasks(workflow, await task_model.list_by_workflow_id(workflow_id))
    step_index = next(
        (i for i, t in enumerate(ordered) if str(t["id"]) == str(task_id)),
        None,
    )
    if step_index is None:
        await run_model.update(
            "workflow_runs",
            "id = ?",
            {"status": "failed", "completed_at": now},
            workflow_run_id,
        )
        await _set_workflow_status(workflow_model, workflow_id, "failed")
        return

    next_index = step_index + 1
    await run_model.update(
        "workflow_runs",
        "id = ?",
        {"current_step": next_index},
        workflow_run_id,
    )

    if next_index >= len(ordered):
        await run_model.update(
            "workflow_runs",
            "id = ?",
            {"status": "completed", "completed_at": now},
            workflow_run_id,
        )
        await _set_workflow_status(workflow_model, workflow_id, "completed")
        return

    next_task_id = str(ordered[next_index]["id"])
    await task_model.update_status(next_task_id, "queued")
    await env.TASK_QUEUE.send({"task_id": next_task_id, "workflow_run_id": workflow_run_id})


def _ordered_workflow_tasks(workflow: dict[str, Any], tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    graph = resolve_graph(workflow, tasks)
    http_order = linear_order_from_trigger(graph)
    nodes = _node_map(graph)
    by_task_id = {str(t["id"]): t for t in tasks}

    ordered: list[dict[str, Any]] = []
    for node_id in http_order:
        task_id = (nodes.get(node_id) or {}).get("data", {}).get("task_id")
        if task_id and str(task_id) in by_task_id:
            ordered.append(by_task_id[str(task_id)])
            continue
        step_order = len(ordered)
        match = next(
            (t for t in tasks if int(t.get("step_order") or 0) == step_order),
            None,
        )
        if match:
            ordered.append(match)

    if ordered:
        return ordered

    return sorted(tasks, key=lambda t: (t.get("step_order") or 0, t.get("created_at") or ""))


def _format_run(run: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not run:
        return {}
    status = (run.get("status") or "running").capitalize()
    return {
        "id": str(run["id"]),
        "workflowId": str(run["workflow_id"]),
        "status": status,
        "triggeredBy": run.get("triggered_by") or "manual",
        "currentStep": int(run.get("current_step") or 0),
        "startedAt": run.get("started_at") or "",
        "completedAt": run.get("completed_at") or "",
    }
