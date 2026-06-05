import json
import asyncio
from datetime import datetime, timezone
from typing import Optional
from db.orm import TaskModel, WorkflowModel
from fastapi import HTTPException
from utils.types import TaskPublish, WorkflowCreate
from utils.responses import success


def to_dict_row(r):
    if r is None:
        return {}
    if hasattr(r, "as_py"):
        return r.as_py()
    if hasattr(r, "to_py"):
        return r.to_py()
    if isinstance(r, dict):
        return r
    return {}


def format_duration(row: dict) -> Optional[str]:
    if row.get("status") in ("running", "queued"):
        return None
    updated = row.get("updated_at")
    created = row.get("created_at")
    if updated and created:
        try:
            c = datetime.fromisoformat(created.replace("Z", "+00:00"))
            u = datetime.fromisoformat(updated.replace("Z", "+00:00"))
            diff = (u - c).total_seconds()
            if diff < 1:
                return f"{int(diff * 1000)}ms"
            return f"{diff:.1f}s"
        except Exception:
            return None
    return None


async def create_task(task: TaskPublish, env, user_id: str) -> dict:
    task_model = TaskModel(env.DB)
    if not task.url:
        raise HTTPException(status_code=400, detail="url is required")
    task_data = {
        "type": task.type,
        "payload": json.dumps(task.payload),
        "url": task.url,
        "status": "queued",
        "retries": 0,
        "max_retries": 5,
        "scheduled_at": task.scheduled_at if task.scheduled_at else datetime.now(timezone.utc).isoformat(),
        "execution_type": task.execution_type,
        "user_id": user_id,
    }
    if task.workflow_id:
        workflow_model = WorkflowModel(env.DB)
        workflow = await workflow_model.find_by_id(task.workflow_id)
        if not workflow or workflow.get("user_id") != user_id:
            raise HTTPException(status_code=404, detail="Workflow not found")
        existing = await task_model.list_by_workflow_id(task.workflow_id)
        task_data["workflow_id"] = task.workflow_id
        task_data["step_order"] = len(existing)
    task_id = await task_model.create(task_data)
    await env.TASK_QUEUE.send({"task_id": task_id})
    return success({"task_id": task_id}, message="Task queued")

async def create_workflow(workflow: WorkflowCreate, env, user_id: str) -> dict:
    workflow_model = WorkflowModel(env.DB)
    task_model = TaskModel(env.DB)
    tasks = workflow.tasks or []

    trigger_config = workflow.trigger_config
    if trigger_config is not None and not isinstance(trigger_config, str):
        trigger_config = json.dumps(trigger_config)

    workflow_data = {
        "name": workflow.name,
        "description": workflow.description,
        "user_id": user_id,
        "status": "draft",
        "trigger_type": workflow.trigger_type,
        "trigger_config": trigger_config,
    }
    workflow_id = await workflow_model.create(workflow_data)

    for index, task in enumerate(tasks):
        task_data = {
            "type": task.type,
            "payload": json.dumps(task.payload),
            "url": task.url,
            "status": "queued",
            "retries": 0,
            "max_retries": 5,
            "scheduled_at": task.scheduled_at if task.scheduled_at else None,
            "execution_type": task.execution_type,
            "user_id": user_id,
            "workflow_id": workflow_id,
            "step_order": index,
        }
        task_id = await task_model.create(task_data)
        await env.TASK_QUEUE.send({"task_id": task_id})

    return success({"workflow_id": workflow_id}, message="Workflow created")

TRIGGER_LABELS = {
    "manual": "Manual",
    "queue": "Webhook",
    "webhook": "Webhook",
    "schedule": "Schedule",
}


def format_workflow(workflow: dict, tasks: list) -> dict:
    workflow_id = str(workflow["id"])
    latest_task = max(
        tasks,
        key=lambda task: task.get("updated_at") or task.get("created_at") or "",
        default=None,
    )

    return {
        "id": workflow_id,
        "name": workflow.get("name", ""),
        "description": workflow.get("description") or "",
        "trigger": TRIGGER_LABELS.get(workflow.get("trigger_type", "manual"), "Manual"),
        "triggerType": workflow.get("trigger_type", "manual"),
        "triggerConfig": workflow.get("trigger_config") or "{}",
        "endpoint": tasks[0].get("url", "") if tasks else "",
        "status": (workflow.get("status") or "draft").capitalize(),
        "lastRun": (latest_task or {}).get("updated_at") or (latest_task or {}).get("created_at") or "",
        "runs": len(tasks),
        "createdAt": workflow.get("created_at") or "",
        "tasks": [
            {
                "id": str(task["id"]),
                "url": task.get("url", ""),
                "status": (task.get("status") or "queued").capitalize(),
                "stepOrder": task.get("step_order") or 0,
            }
            for task in tasks
        ],
    }


async def get_workflow(env, user_id: str, workflow_id: str) -> dict:
    workflow_model = WorkflowModel(env.DB)
    task_model = TaskModel(env.DB)
    workflow = await workflow_model.find_by_id(workflow_id)
    if not workflow or workflow.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Workflow not found")
    tasks = await task_model.list_by_workflow_id(workflow_id)
    return format_workflow(workflow, tasks)


async def list_workflows(env, user_id: str, page: int = 1, limit: int = 50) -> list:
    workflow_model = WorkflowModel(env.DB)
    task_model = TaskModel(env.DB)
    workflows = await workflow_model.list(user_id)
    result = []

    for workflow in workflows:
        workflow_id = str(workflow["id"])
        tasks = await task_model.list_by_workflow_id(workflow_id)
        result.append(format_workflow(workflow, tasks))

    return result

def _build_task_query(where: str, params: list, fields: str = "*", order: str = "created_at DESC", limit: Optional[int] = None, offset: Optional[int] = None) -> tuple:
    q = f"SELECT {fields} FROM tasks WHERE {where} ORDER BY {order}"
    if limit is not None:
        q += f" LIMIT {limit}"
    if offset is not None:
        q += f" OFFSET {offset}"
    return q


async def list_tasks(db, user_id: str, status: Optional[str] = None, workflow_id: Optional[str] = None, page: int = 1, limit: int = 50) -> dict:
    where = "user_id = ?"
    params = [user_id]
    if status:
        where += " AND status = ?"
        params.append(status)
    if workflow_id:
        where += " AND workflow_id = ?"
        params.append(workflow_id)

    offset = (page - 1) * limit

    count_r = await db.prepare(f"SELECT COUNT(*) as c FROM tasks WHERE {where}").bind(*params).first()
    total = to_dict_row(count_r).get("c", 0)

    q = _build_task_query(where, params,
        "id, url, status, retries, created_at, updated_at, execution_type",
        limit=limit, offset=offset)
    rows = await db.prepare(q).bind(*params).all()
    tasks = [to_dict_row(r) for r in (rows.results if rows and hasattr(rows, "results") else [])]

    items = [{
        "id": t["id"],
        "endpoint": t.get("url", ""),
        "status": t.get("status", "").capitalize(),
        "scheduled": t.get("created_at", ""),
        "duration": format_duration(t),
        "retries": t.get("retries", 0),
    } for t in tasks]

    return success(items, meta={"page": page, "limit": limit, "total": total})



async def get_analytics(db, user_id: str) -> dict:
    days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    async def val(r):
        return to_dict_row(r).get("c", 0)

    async def run(q, *params):
        return await db.prepare(q).bind(*params).first()

    async def all_rows(q, *params):
        r = await db.prepare(q).bind(*params).all()
        if r and hasattr(r, "results"):
            return [to_dict_row(row) for row in r.results]
        return []

    total_q = run("SELECT COUNT(*) as c FROM tasks WHERE user_id = ?", user_id)
    active_q = run("SELECT COUNT(*) as c FROM tasks WHERE user_id = ? AND status IN ('queued','running')", user_id)
    completed_today_q = run("SELECT COUNT(*) as c FROM tasks WHERE user_id = ? AND status = 'completed' AND date(created_at) = date('now')", user_id)
    failed_q = run("SELECT COUNT(*) as c FROM tasks WHERE user_id = ? AND status = 'failed'", user_id)
    exec_q = all_rows(
        "SELECT cast(strftime('%w', created_at) as integer) as day_idx, COUNT(*) as tasks "
        "FROM tasks WHERE user_id = ? AND created_at >= datetime('now', '-7 days') "
        "GROUP BY day_idx ORDER BY day_idx", user_id
    )
    status_q = all_rows(
        "SELECT date(created_at) as date, "
        "SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful, "
        "SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed "
        "FROM tasks WHERE user_id = ? AND created_at >= datetime('now', '-7 days') "
        "GROUP BY date(created_at) ORDER BY date", user_id
    )
    recent_q = all_rows(
        "SELECT id, url, status, created_at FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 5", user_id
    )

    total_r, active_r, completed_r, failed_r, exec_rows, status_rows, recent_rows = await asyncio.gather(
        total_q, active_q, completed_today_q, failed_q, exec_q, status_q, recent_q
    )

    return success({
        "stats": {
            "total_tasks": await val(total_r),
            "active_runs": await val(active_r),
            "completed_today": await val(completed_r),
            "failed": await val(failed_r),
        },
        "execution_chart": [{"day": days[r["day_idx"]], "tasks": r["tasks"]} for r in exec_rows],
        "run_status_chart": [{"date": r["date"], "successful": r["successful"], "failed": r["failed"]} for r in status_rows],
        "recent_tasks": [{"id": r["id"], "endpoint": r.get("url", ""), "status": r.get("status", ""), "scheduled": r.get("created_at", "")} for r in recent_rows],
    })
