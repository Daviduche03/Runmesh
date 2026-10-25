/**
 * Workflow entry points: manual runs, webhook deliveries, and the schedule sweep.
 *
 * Webhook triggering is gated on the workflow opting into a `queue`/`webhook` trigger type;
 * the schedule sweep starts every due schedule workflow, skipping (not failing) runs that are
 * already in progress.
 */
import createError from "http-errors";
import type { Db } from "../../core/db/client.js";
import { WorkflowModel } from "../../core/db/orm.js";
import { log } from "../../core/log.js";
import type { Queue } from "../../core/runtime/queue.js";
import { requireRowAccess } from "../workspace/index.js";
import { startWorkflowRun } from "./runner.js";
import type { FormattedRun } from "./runner.js";
import { isWebhookTrigger, isWorkflowScheduleDue } from "./trigger-config.js";

export function triggerWorkflowForUser(
  db: Db,
  taskQueue: Queue,
  userId: string,
  workflowId: string,
  triggeredBy: string,
): FormattedRun {
  const workflow = new WorkflowModel(db).findById(workflowId);
  requireRowAccess(db, userId, workflow, { notFoundDetail: "Workflow not found" });

  if (triggeredBy === "webhook" && !isWebhookTrigger(workflow!.triggerType ?? "manual")) {
    throw createError(400, "Workflow is not configured for webhook triggers");
  }

  return startWorkflowRun(db, taskQueue, userId, workflowId, triggeredBy);
}

export function runDueScheduledWorkflows(db: Db, taskQueue: Queue): number {
  const now = new Date();
  let started = 0;

  for (const workflow of new WorkflowModel(db).listByTriggerType("schedule")) {
    if (!isWorkflowScheduleDue(workflow, now)) continue;
    try {
      startWorkflowRun(db, taskQueue, workflow.userId, String(workflow.id), "schedule");
      started += 1;
    } catch (err) {
      if ((err as { status?: number }).status === 409) {
        log("info", "scheduled_workflow_skipped", {
          workflow_id: workflow.id,
          reason: "run_in_progress",
        });
      } else {
        log("error", "scheduled_workflow_failed", {
          workflow_id: workflow.id,
          error: String(err),
        });
      }
    }
  }

  return started;
}
