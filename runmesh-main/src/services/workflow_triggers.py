from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from db.orm import WorkflowModel
from services.workflow_runner import start_workflow_run
from services.workflow_trigger_config import (
    is_webhook_trigger,
    is_workflow_schedule_due,
)


async def trigger_workflow_for_user(
    env,
    user_id: str,
    workflow_id: str,
    triggered_by: str,
) -> dict[str, Any]:
    workflow_model = WorkflowModel(env.DB)
    workflow = await workflow_model.find_by_id(workflow_id)
    if not workflow or workflow.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if triggered_by == "webhook" and not is_webhook_trigger(workflow.get("trigger_type", "manual")):
        raise HTTPException(status_code=400, detail="Workflow is not configured for webhook triggers")

    return await start_workflow_run(env, user_id, workflow_id, triggered_by=triggered_by)


async def run_due_scheduled_workflows(env) -> int:
    workflow_model = WorkflowModel(env.DB)
    workflows = await workflow_model.list_by_trigger_type("schedule")
    now = datetime.now(timezone.utc)
    started = 0

    for workflow in workflows:
        if not is_workflow_schedule_due(workflow, now):
            continue
        try:
            await start_workflow_run(
                env,
                workflow["user_id"],
                str(workflow["id"]),
                triggered_by="schedule",
            )
            started += 1
        except HTTPException as e:
            if e.status_code == 409:
                print(f"Scheduled workflow {workflow['id']} skipped: run already in progress")
            else:
                print(f"Scheduled workflow {workflow['id']} failed: {e.detail}")
        except Exception as e:
            print(f"Scheduled workflow {workflow['id']} error: {e}")

    return started
