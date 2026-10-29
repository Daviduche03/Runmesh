/**
 * Task records. Tasks are the execution primitive: one durable HTTP call with retries,
 * optional scheduling, and an optional workflow step attachment.
 *
 * `createTask` mirrors the Python flow: validate the static URL, resolve the workspace,
 * honor idempotency keys, adopt the workflow's workspace, and park the task in
 * `waiting_for_grant` when its Connect grant is not approved. Only `queued` tasks are
 * handed to the queue.
 */
import { and, count, desc, eq } from "drizzle-orm";
import createError from "http-errors";
import { randomUUID } from "node:crypto";
import type { Db } from "../../core/db/client.js";
import { TaskModel, WorkflowModel, WorkflowRunModel } from "../../core/db/orm.js";
import type { TaskInsert, TaskRow } from "../../core/db/orm.js";
import { connectGrants, tasks } from "../../core/db/schema.js";
import type { Queue } from "../../core/runtime/queue.js";
import { validateOutboundUrl } from "../../core/url-security.js";
import { requireRowAccess, resolveWorkspaceId } from "../workspace/index.js";
import { applyTaskTemplates } from "./templating.js";

export interface CreateTaskInput {
  url?: string | null;
  payload?: unknown;
  payloadTemplate?: string | null;
  urlTemplate?: string | null;
  type?: string;
  workflowId?: string | null;
  executionType?: string;
  scheduledAt?: string | null;
  maxRetries?: number;
  idempotencyKey?: string | null;
  signingSecret?: string | null;
  connectGrantId?: string | null;
}

/** Human duration between row timestamps; running/queued tasks have none yet. */
export function formatDuration(row: {
  status?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}): string | null {
  if (row.status === "running" || row.status === "queued") return null;
  if (!row.updatedAt || !row.createdAt) return null;
  const created = Date.parse(row.createdAt);
  const updated = Date.parse(row.updatedAt);
  if (Number.isNaN(created) || Number.isNaN(updated)) return null;
  const diffSeconds = (updated - created) / 1000;
  if (diffSeconds < 1) return `${Math.trunc(diffSeconds * 1000)}ms`;
  return `${diffSeconds.toFixed(1)}s`;
}

export function createTask(
  db: Db,
  taskQueue: Queue,
  input: CreateTaskInput,
  userId: string,
  workspaceId?: string | null,
): { taskId: string; message: string } {
  if (!input.url && !input.urlTemplate) {
    throw createError(400, "url or url_template is required");
  }
  if (input.url && input.url.trim()) {
    // SSRF blocklist for static URLs (templated URLs are validated after render).
    validateOutboundUrl(input.url);
  }

  let workspace = resolveWorkspaceId(db, userId, workspaceId ?? null);

  const idempotencyKey = (input.idempotencyKey ?? "").trim();
  if (idempotencyKey) {
    const existing = new TaskModel(db).findByIdempotencyKey(workspace, idempotencyKey);
    if (existing) return { taskId: existing.id, message: "Task already queued" };
  }

  if (input.workflowId) {
    const workflow = new WorkflowModel(db).findById(input.workflowId);
    if (!workflow) throw createError(404, "Workflow not found");
    requireRowAccess(db, userId, workflow, { notFoundDetail: "Workflow not found" });
    if (workflow.workspaceId) workspace = workflow.workspaceId;
  }

  const now = new Date().toISOString();
  const data: TaskInsert = {
    id: randomUUID(),
    type: input.type ?? "task",
    payload: typeof input.payload === "string" ? input.payload : JSON.stringify(input.payload ?? {}),
    url: input.url ?? "",
    status: "queued",
    retries: 0,
    maxRetries: input.maxRetries ?? 5,
    scheduledAt: input.scheduledAt ?? now,
    idempotencyKey: idempotencyKey || undefined,
    executionType: input.executionType ?? "queue",
    createdAt: now,
    updatedAt: now,
    userId,
    workspaceId: workspace,
    signingSecret: input.signingSecret ?? null,
    connectGrantId: input.connectGrantId ?? null,
  };
  applyTaskTemplates(data, input.payloadTemplate ?? null, input.urlTemplate ?? null);

  if (input.connectGrantId) {
    const grant =
      db.select().from(connectGrants).where(eq(connectGrants.id, input.connectGrantId)).limit(1).get() ??
      null;
    if (grant && grant.approvalStatus !== "approved") {
      data.status = "waiting_for_grant";
    }
  }
  if (input.workflowId) {
    data.workflowId = input.workflowId;
    data.stepOrder = new TaskModel(db).listByWorkflowId(input.workflowId).length;
  }

  const taskId = new TaskModel(db).create(data);
  if (data.status === "waiting_for_grant") {
    return { taskId, message: "Task waiting for grant approval" };
  }
  taskQueue.send({ task_id: taskId });
  return { taskId, message: "Task queued" };
}

export function deleteTask(db: Db, userId: string, taskId: string): string {
  const task = new TaskModel(db).findById(taskId);
  requireRowAccess(db, userId, task, { notFoundDetail: "Task not found" });

  const workflowId = task!.workflowId;
  if (workflowId) {
    const active = new WorkflowRunModel(db).findActiveForWorkflow(String(workflowId));
    if (active) {
      const status = (task!.status ?? "").toLowerCase();
      if (status === "queued" || status === "running" || status === "dispatched") {
        throw createError(409, "Cannot delete task while workflow run is in progress");
      }
    }
  }

  const deleted = new TaskModel(db).deleteTask(taskId);
  if (deleted === 0) throw createError(404, "Task not found");
  return taskId;
}

export interface TaskListFilter {
  status?: string;
  workflowId?: string;
  page?: number;
  limit?: number;
}

/** Dashboard list shape: `endpoint`, capitalized `status`, `duration`, `retries`. */
export function listTasks(
  db: Db,
  userId: string,
  filter: TaskListFilter = {},
  workspaceId?: string | null,
): { items: Record<string, unknown>[]; page: number; limit: number; total: number } {
  const workspace = resolveWorkspaceId(db, userId, workspaceId ?? null);
  const page = filter.page ?? 1;
  const limit = filter.limit ?? 50;

  const conditions = [eq(tasks.workspaceId, workspace)];
  if (filter.status) conditions.push(eq(tasks.status, filter.status));
  if (filter.workflowId) conditions.push(eq(tasks.workflowId, filter.workflowId));
  const where = and(...conditions);

  const totalRow = db.select({ value: count() }).from(tasks).where(where).get();
  const total = Number(totalRow?.value ?? 0);

  const rows = db
    .select({
      id: tasks.id,
      url: tasks.url,
      status: tasks.status,
      retries: tasks.retries,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      executionType: tasks.executionType,
    })
    .from(tasks)
    .where(where)
    .orderBy(desc(tasks.createdAt))
    .offset((page - 1) * limit)
    .limit(limit)
    .all();

  const items = rows.map((row) => ({
    id: row.id,
    endpoint: row.url ?? "",
    status: row.status ? row.status.charAt(0).toUpperCase() + row.status.slice(1).toLowerCase() : "",
    scheduled: row.createdAt ?? "",
    duration: formatDuration(row),
    retries: row.retries ?? 0,
  }));

  return { items, page, limit, total };
}
