/**
 * Scheduled tasks. Standalone tasks run immediately through the queue; tasks with
 * `execution_type = 'scheduled'` wait for `scheduled_at`, and the runner sweep calls
 * `enqueueDueTasks` to flip due ones to `dispatched` and hand them to the queue.
 */
import { and, asc, eq, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "../../core/db/client.js";
import { TaskModel } from "../../core/db/orm.js";
import type { TaskInsert, TaskRow } from "../../core/db/orm.js";
import { tasks } from "../../core/db/schema.js";
import { log } from "../../core/log.js";
import type { Queue } from "../../core/runtime/queue.js";
import { applyTaskTemplates } from "./templating.js";

export interface ScheduledTaskData {
  userId: string;
  url?: string;
  type?: string;
  payload?: unknown;
  maxRetries?: number;
  workflowId?: string | null;
  workspaceId?: string | null;
  payloadTemplate?: string | null;
  urlTemplate?: string | null;
  signingSecret?: string | null;
  idempotencyKey?: string | null;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function getDueTasks(db: Db): TaskRow[] {
  return db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.status, "queued"),
        lte(tasks.scheduledAt, new Date().toISOString()),
        eq(tasks.executionType, "scheduled"),
      ),
    )
    .orderBy(asc(tasks.scheduledAt))
    .all();
}

export function enqueueDueTasks(db: Db, taskQueue: Queue): number {
  const taskModel = new TaskModel(db);
  let enqueued = 0;

  for (const task of getDueTasks(db)) {
    try {
      taskQueue.send({ task_id: task.id });
      taskModel.updateStatus(task.id, "dispatched");
      enqueued += 1;
    } catch (err) {
      log("error", "task_enqueue_failed", { task_id: task.id, error: String(err) });
      // Keep the task as 'queued' so a later sweep retries it.
    }
  }

  return enqueued;
}

export function scheduleTask(db: Db, taskData: ScheduledTaskData, scheduledAt: string | Date): string {
  const now = new Date().toISOString();
  const payload =
    typeof taskData.payload === "string" ? taskData.payload : JSON.stringify(taskData.payload ?? {});

  const data: TaskInsert = {
    id: randomUUID(),
    type: taskData.type ?? "task",
    payload,
    url: taskData.url ?? "",
    status: "queued",
    retries: 0,
    maxRetries: taskData.maxRetries ?? 5,
    scheduledAt: toIso(scheduledAt),
    idempotencyKey: taskData.idempotencyKey ?? randomUUID(),
    executionType: "scheduled",
    createdAt: now,
    updatedAt: now,
    userId: taskData.userId,
    workflowId: taskData.workflowId ?? null,
    workspaceId: taskData.workspaceId ?? null,
    signingSecret: taskData.signingSecret ?? null,
  };
  applyTaskTemplates(data, taskData.payloadTemplate ?? null, taskData.urlTemplate ?? null);

  new TaskModel(db).create(data);
  return data.id!;
}

export function cancelScheduledTask(db: Db, taskId: string): boolean {
  const task = new TaskModel(db).findById(taskId);
  if (!task) return false;

  if (task.status === "queued" && task.executionType === "scheduled") {
    new TaskModel(db).updateStatus(taskId, "cancelled");
    return true;
  }
  return false;
}

export function rescheduleTask(db: Db, taskId: string, newScheduledAt: string | Date): boolean {
  const task = new TaskModel(db).findById(taskId);
  if (!task) return false;

  if (task.executionType === "scheduled" && (task.status === "queued" || task.status === "failed")) {
    db
      .update(tasks)
      .set({
        scheduledAt: toIso(newScheduledAt),
        updatedAt: new Date().toISOString(),
        status: "queued",
      })
      .where(eq(tasks.id, taskId))
      .run();
    return true;
  }
  return false;
}

export interface ScheduledTaskFilter {
  userId?: string;
  status?: string;
  limit?: number;
  workspaceId?: string;
}

/** Workspace filter wins when both are set; `userId` is the legacy fallback. */
export function getScheduledTasks(db: Db, filter: ScheduledTaskFilter = {}): TaskRow[] {
  const conditions = [eq(tasks.executionType, "scheduled")];
  if (filter.workspaceId) {
    conditions.push(eq(tasks.workspaceId, filter.workspaceId));
  } else if (filter.userId) {
    conditions.push(eq(tasks.userId, filter.userId));
  }
  if (filter.status) {
    conditions.push(eq(tasks.status, filter.status));
  }

  return db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(asc(tasks.scheduledAt))
    .limit(filter.limit ?? 50)
    .all();
}
