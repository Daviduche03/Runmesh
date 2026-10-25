/**
 * Workflow records: validation, trigger config normalization, and the list/detail shapes the
 * dashboard renders. Step tasks are created alongside the workflow and rolled back together —
 * a workflow with an invalid step leaves no rows behind.
 */
import createError from "http-errors";
import { randomUUID } from "node:crypto";
import type { Db } from "../../core/db/client.js";
import { TaskModel, WorkflowModel, WorkflowRunModel } from "../../core/db/orm.js";
import type { TaskRow, WorkflowInsert, WorkflowRow } from "../../core/db/orm.js";
import type { Queue } from "../../core/runtime/queue.js";
import { applyTaskTemplates } from "../tasks/templating.js";
import { requireRowAccess, resolveWorkspaceId } from "../workspace/index.js";
import { resolveGraph } from "./graph.js";
import { buildStepChainContext, handleWorkflowTaskCompletion } from "./runner.js";
import { formatTriggerConfigForApi, normalizeTriggerConfig, parseTriggerConfig } from "./trigger-config.js";

export const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  queue: "Webhook",
  webhook: "Webhook",
  schedule: "Schedule",
};

export interface WorkflowStepInput {
  url?: string | null;
  payload?: unknown;
  payloadTemplate?: string | null;
  urlTemplate?: string | null;
  type?: string;
  executionType?: string;
  scheduledAt?: string | null;
  maxRetries?: number;
  idempotencyKey?: string | null;
  signingSecret?: string | null;
}

export interface WorkflowCreateInput {
  name: string;
  description?: string | null;
  triggerType?: string;
  triggerConfig?: string | Record<string, unknown> | null;
  agentId?: string | null;
  threadId?: string | null;
  workspaceProjectId?: string | null;
  connectAppId?: string | null;
  metadata?: Record<string, unknown> | null;
  tasks?: WorkflowStepInput[];
}

export interface WorkflowUpdateInput {
  description?: string | null;
  name?: string | null;
  triggerType?: string | null;
  triggerConfig?: string | Record<string, unknown> | null;
}

export function createWorkflow(
  db: Db,
  input: WorkflowCreateInput,
  userId: string,
  workspaceId?: string | null,
): { workflowId: string; message: string } {
  const description = (input.description ?? "").trim();
  if (description.length < 8) {
    throw createError(400, "Description is required (at least 8 characters)");
  }
  if (description.toLowerCase() === input.name.trim().toLowerCase()) {
    throw createError(400, "Description must be different from the workflow name");
  }

  const steps = input.tasks ?? [];
  if (steps.length === 0) {
    throw createError(400, "Workflow must include at least one task");
  }

  const triggerType = input.triggerType ?? "manual";
  const triggerConfigStr = normalizeTriggerConfig(triggerType, input.triggerConfig ?? null);

  const now = new Date().toISOString();
  const data: WorkflowInsert = {
    id: randomUUID(),
    name: input.name,
    description,
    userId,
    workspaceId: resolveWorkspaceId(db, userId, workspaceId ?? null),
    status: "draft",
    triggerType,
    triggerConfig: triggerConfigStr,
    createdAt: now,
    updatedAt: now,
    agentId: input.agentId ?? null,
    threadId: input.threadId ?? null,
    workspaceProjectId: input.workspaceProjectId ?? null,
    connectAppId: input.connectAppId ?? null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
  };
  const workflowId = new WorkflowModel(db).create(data);

  try {
    const taskModel = new TaskModel(db);
    steps.forEach((step, index) => {
      if (!step.url && !step.urlTemplate) {
        throw createError(400, "Each workflow task needs url or url_template");
      }
      const taskData = {
        type: step.type ?? "task",
        payload:
          typeof step.payload === "string" ? step.payload : JSON.stringify(step.payload ?? {}),
        url: step.url ?? "",
        status: "pending",
        retries: 0,
        maxRetries: 5,
        scheduledAt: step.scheduledAt ?? now,
        executionType: step.executionType ?? "queue",
        userId,
        workspaceId: data.workspaceId,
        workflowId,
        stepOrder: index,
      };
      applyTaskTemplates(
        taskData as { payloadTemplate?: string | null; urlTemplate?: string | null },
        step.payloadTemplate ?? null,
        step.urlTemplate ?? null,
      );
      taskModel.create(taskData);
    });
  } catch (err) {
    new TaskModel(db).deleteByWorkflowId(workflowId);
    new WorkflowModel(db).deleteWorkflow(workflowId);
    throw err;
  }

  return { workflowId, message: "Workflow created" };
}

/** Dashboard shape: trigger labels, step counts, per-step badges, and the canvas graph. */
export function formatWorkflow(workflow: WorkflowRow, tasks: TaskRow[]): Record<string, unknown> {
  const workflowId = String(workflow.id);
  let latestTask: TaskRow | null = null;
  for (const task of tasks) {
    const key = task.updatedAt ?? task.createdAt ?? "";
    const best = latestTask ? (latestTask.updatedAt ?? latestTask.createdAt ?? "") : "";
    if (!latestTask || key > best) latestTask = task;
  }

  let stepCount = resolveGraph(workflow, tasks).nodes.filter((node) => node.type === "http").length;
  if (stepCount === 0) stepCount = tasks.length;

  return {
    id: workflowId,
    name: workflow.name ?? "",
    description: workflow.description ?? "",
    stepCount,
    trigger: TRIGGER_LABELS[workflow.triggerType ?? "manual"] ?? "Manual",
    triggerType: workflow.triggerType ?? "manual",
    triggerConfig: formatTriggerConfigForApi(parseTriggerConfig(workflow)),
    endpoint: tasks.length > 0 ? (tasks[0]!.url ?? "") : "",
    status: capitalize(workflow.status ?? "draft"),
    lastRun: latestTask ? (latestTask.updatedAt ?? latestTask.createdAt ?? "") : "",
    runs: tasks.length,
    createdAt: workflow.createdAt ?? "",
    updatedAt: workflow.updatedAt ?? "",
    tasks: tasks.map((task) => ({
      id: String(task.id),
      url: task.url ?? "",
      status: capitalize(task.status ?? "queued"),
      stepOrder: task.stepOrder ?? 0,
    })),
    graph: resolveGraph(workflow, tasks),
  };
}

function capitalize(value: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function getWorkflow(db: Db, userId: string, workflowId: string): Record<string, unknown> {
  const workflow = new WorkflowModel(db).findById(workflowId);
  requireRowAccess(db, userId, workflow, { notFoundDetail: "Workflow not found" });
  const tasks = new TaskModel(db).listByWorkflowId(workflowId);
  return formatWorkflow(workflow!, tasks);
}

export function listWorkflows(
  db: Db,
  userId: string,
  workspaceId?: string | null,
): Record<string, unknown>[] {
  const workspace = resolveWorkspaceId(db, userId, workspaceId ?? null);
  const taskModel = new TaskModel(db);
  return new WorkflowModel(db)
    .list(workspace)
    .map((workflow) => formatWorkflow(workflow, taskModel.listByWorkflowId(workflow.id)));
}

export function updateWorkflow(
  db: Db,
  userId: string,
  workflowId: string,
  input: WorkflowUpdateInput,
): Record<string, unknown> {
  const workflowModel = new WorkflowModel(db);
  const workflow = workflowModel.findById(workflowId);
  requireRowAccess(db, userId, workflow, { notFoundDetail: "Workflow not found" });

  const updates: Partial<WorkflowInsert> = {};

  if (input.description !== undefined && input.description !== null) {
    const cleaned = input.description.trim();
    if (!cleaned) throw createError(400, "Description is required");
    updates.description = cleaned;
  }
  if (input.name !== undefined && input.name !== null) {
    const cleanedName = input.name.trim();
    if (!cleanedName) throw createError(400, "Name is required");
    updates.name = cleanedName;
  }
  if (input.triggerType !== undefined && input.triggerType !== null) {
    if (!["manual", "queue", "webhook", "schedule"].includes(input.triggerType)) {
      throw createError(400, "Invalid trigger type");
    }
    updates.triggerType = input.triggerType;
  }
  if (input.triggerConfig !== undefined && input.triggerConfig !== null) {
    updates.triggerConfig = normalizeTriggerConfig(
      input.triggerType ?? workflow!.triggerType ?? "manual",
      input.triggerConfig,
    );
  }

  if (Object.keys(updates).length === 0) {
    throw createError(400, "No fields to update");
  }

  workflowModel.updateById(workflowId, updates);
  return getWorkflow(db, userId, workflowId);
}

export function deleteWorkflow(db: Db, userId: string, workflowId: string): string {
  const workflowModel = new WorkflowModel(db);
  const taskModel = new TaskModel(db);
  const runModel = new WorkflowRunModel(db);

  const workflow = workflowModel.findById(workflowId);
  requireRowAccess(db, userId, workflow, { notFoundDetail: "Workflow not found" });

  const active = runModel.findActiveForWorkflow(workflowId);
  if (active) {
    const inFlight = taskModel
      .listByWorkflowId(workflowId)
      .some((task) => ["queued", "running", "dispatched"].includes((task.status ?? "").toLowerCase()));
    if (inFlight) {
      throw createError(409, "Cannot delete workflow while a run is in progress");
    }
  }

  taskModel.deleteByWorkflowId(workflowId);
  runModel.deleteByWorkflowId(workflowId);
  const deleted = workflowModel.deleteWorkflow(workflowId);
  if (deleted === 0) throw createError(404, "Workflow not found");
  return workflowId;
}

/** Queue injection point for the task processor; wired in `main.ts` once this module loads. */
export function workflowTaskHooks(
  db: Db,
  taskQueue: Queue,
): {
  buildStepChainContext: (task: TaskRow) => Promise<Record<string, unknown>>;
  onWorkflowTaskCompletion: (taskId: string, runId: string, status: string) => Promise<void>;
} {
  return {
    buildStepChainContext: async (task) => buildStepChainContext(db, task),
    onWorkflowTaskCompletion: async (taskId, runId, status) =>
      handleWorkflowTaskCompletion(db, taskQueue, taskId, runId, status),
  };
}
