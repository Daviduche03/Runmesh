/**
 * Task execution. A queue message carries `{ task_id, workflow_run_id }`; this processor loads
 * the task, renders its templates, signs the outbound call the same way webhooks are signed,
 * and finalizes the row — retrying with `increment_retries` until `max_retries` is spent.
 *
 * Queue claiming is the ack: `Queue.receive` DELETEs the row up front, so there is no
 * separate ack step like the Python consumer had.
 */
import type { Db } from "../../core/db/client.js";
import { TaskModel } from "../../core/db/orm.js";
import type { TaskRow } from "../../core/db/orm.js";
import { log } from "../../core/log.js";
import type { Queue } from "../../core/runtime/queue.js";
import { isOutboundUrlAllowed } from "../../core/url-security.js";
import { dispatchEvent, signedDispatch } from "../webhooks/index.js";
import type { FetchLike } from "../webhooks/index.js";
import { resolveTaskRequest } from "./templating.js";

export const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

/**
 * Workflow callbacks. The workflows module registers these in `main.ts`; until it lands the
 * processor runs standalone tasks and skips the resume/chain-context steps.
 */
export interface TaskExecutionHooks {
  buildStepChainContext?: (task: TaskRow) => Promise<Record<string, unknown>>;
  onWorkflowTaskCompletion?: (
    taskId: string,
    workflowRunId: string,
    finalStatus: string,
  ) => Promise<void>;
}

interface QueueMessage {
  task_id?: unknown;
  workflow_run_id?: unknown;
}

async function maybeResumeWorkflow(
  db: Db,
  taskId: string,
  workflowRunId: string,
  finalStatus: string,
  hooks: TaskExecutionHooks,
): Promise<void> {
  if (!hooks.onWorkflowTaskCompletion) return;
  // Parity with the Python `_maybe_resume_workflow`: only running runs resume.
  // The workflows module owns that check, so this is best-effort until it lands.
  await hooks.onWorkflowTaskCompletion(taskId, workflowRunId, finalStatus);
}

async function finalizeTask(
  db: Db,
  webhookQueue: Queue,
  taskId: string,
  taskRow: TaskRow,
  workflowRunId: string | null,
  finalStatus: string,
  responseBody: string,
  targetStatusCode: number | null,
  hooks: TaskExecutionHooks,
): Promise<void> {
  new TaskModel(db).completeExecution(taskId, finalStatus, responseBody, targetStatusCode ?? 0);

  if (taskRow.userId) {
    const terminalTask: TaskRow = {
      ...taskRow,
      status: finalStatus,
      retries: taskRow.retries ?? 0,
    };
    dispatchEvent(db, webhookQueue, taskRow.userId,
      finalStatus === "completed" ? "task.completed" : "task.failed",
      terminalTask,
      { target_status_code: targetStatusCode },
    );
  }
  if (workflowRunId && hooks.onWorkflowTaskCompletion) {
    await hooks.onWorkflowTaskCompletion(taskId, workflowRunId, finalStatus);
  }
}

function requeueTask(
  db: Db,
  taskQueue: Queue,
  taskId: string,
  workflowRunId: string | null,
  retries: number,
  maxRetries: number,
): boolean {
  if (retries >= maxRetries) return false;
  new TaskModel(db).incrementRetries(taskId, "queued");
  taskQueue.send({ task_id: taskId, workflow_run_id: workflowRunId });
  return true;
}

export async function processTaskMessage(
  db: Db,
  taskQueue: Queue,
  webhookQueue: Queue,
  fetchImpl: FetchLike,
  message: QueueMessage,
  hooks: TaskExecutionHooks = {},
): Promise<void> {
  const rawId = message.task_id;
  const taskId = typeof rawId === "string" ? rawId : null;
  const rawRunId = message.workflow_run_id;
  const workflowRunId =
    typeof rawRunId === "string" && rawRunId.length > 0 ? rawRunId : null;

  const taskModel = new TaskModel(db);
  let taskRow: TaskRow | null = null;

  try {
    if (!taskId) return;
    taskRow = taskModel.findById(taskId);
    if (!taskRow) return;

    const existingStatus = (taskRow.status ?? "").toLowerCase();
    if (TERMINAL_STATUSES.has(existingStatus)) {
      if (workflowRunId) {
        await maybeResumeWorkflow(db, taskId, workflowRunId, existingStatus, hooks);
      }
      return;
    }

    taskModel.updateStatus(taskId, "running");
    if (taskRow.userId) {
      dispatchEvent(db, webhookQueue, taskRow.userId, "task.running", {
        ...taskRow,
        status: "running",
      });
    }

    let finalStatus = "failed";
    let targetStatusCode: number | null = null;
    let responseBody = "";

    let targetUrl: string;
    let taskPayload: unknown;
    try {
      const chainContext =
        workflowRunId && hooks.buildStepChainContext
          ? await hooks.buildStepChainContext(taskRow)
          : {};
      [targetUrl, taskPayload] = resolveTaskRequest(taskRow, chainContext);
    } catch (err) {
      log("error", "task_template_error", { task_id: taskId, error: String(err) });
      throw err;
    }

    // SSRF guard: re-validate the (possibly template-rendered) target URL.
    // Blocked URLs are a permanent failure — retrying would never succeed.
    if (!isOutboundUrlAllowed(targetUrl)) {
      log("warn", "task_blocked_ssrf", { task_id: taskId });
      await finalizeTask(db, webhookQueue, taskId, taskRow, workflowRunId, "failed", "", null, hooks);
      return;
    }

    const fetchBody =
      typeof taskPayload === "object" && taskPayload !== null
        ? JSON.stringify(taskPayload)
        : (taskPayload as string | Buffer);
    const result = await signedDispatch(
      fetchImpl,
      targetUrl,
      taskRow.signingSecret ?? "",
      "task.execute",
      fetchBody,
      1,
      true,
    );
    targetStatusCode = result.status;

    if (result.ok) {
      finalStatus = "completed";
      responseBody = result.body ?? "";
    } else if (targetStatusCode !== null && result.body) {
      finalStatus = "failed";
      responseBody = result.body;
    } else if (targetStatusCode !== null) {
      finalStatus = "failed";
      responseBody = "";
    } else {
      log("error", "task_delivery_error", { task_id: taskId, error: result.body });
      throw new Error(result.body ?? "delivery failed");
    }

    if (finalStatus === "failed") {
      const requeued = requeueTask(
        db, taskQueue, taskId, workflowRunId,
        taskRow.retries ?? 0, taskRow.maxRetries ?? 5,
      );
      if (requeued) return;
    }

    await finalizeTask(
      db, webhookQueue, taskId, taskRow, workflowRunId,
      finalStatus, responseBody, targetStatusCode, hooks,
    );
  } catch (err) {
    log("error", "task_execution_error", { task_id: taskId, error: String(err) });
    if (!taskId || !taskRow) return;

    const requeued = requeueTask(
      db, taskQueue, taskId, workflowRunId,
      taskRow.retries ?? 0, taskRow.maxRetries ?? 5,
    );
    if (requeued) return;

    try {
      await finalizeTask(db, webhookQueue, taskId, taskRow, workflowRunId, "failed", "", null, hooks);
    } catch (finalizeErr) {
      log("error", "task_finalize_error", { task_id: taskId, error: String(finalizeErr) });
    }
  }
}
