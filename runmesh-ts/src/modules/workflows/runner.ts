/**
 * Workflow runs: one active run per workflow, chaining steps one queue hop at a time.
 *
 * `startWorkflowRun` resets every step to pending, queues step one, and flips the workflow
 * to running. Each completed task resumes via `handleWorkflowTaskCompletion`, which advances
 * `current_step` and queues the next step — or closes the run when the chain ends or a step
 * fails. A stale running run with nothing left in flight is failed by the sweep.
 */
import createError from "http-errors";
import { randomUUID } from "node:crypto";
import type { Db } from "../../core/db/client.js";
import { TaskModel, WorkflowModel, WorkflowRunModel } from "../../core/db/orm.js";
import type { TaskRow, WorkflowRow, WorkflowRunRow } from "../../core/db/orm.js";
import { log } from "../../core/log.js";
import type { Queue } from "../../core/runtime/queue.js";
import { parseStoredResponse } from "../tasks/templating.js";
import { requireRowAccess } from "../workspace/index.js";
import { linearOrderFromTrigger, resolveGraph } from "./graph.js";

export interface StepOutput {
  task_id: string;
  step: number;
  status: number | null;
  body: unknown;
}

export function stepOutputFromTask(task: TaskRow): StepOutput {
  return {
    task_id: String(task.id ?? ""),
    step: Number(task.stepOrder ?? 0) + 1,
    status: task.responseStatus,
    body: parseStoredResponse(task.responseBody),
  };
}

/** Completed prior steps of this task's run, exposed to templates as `prev` / `steps`. */
export function buildStepChainContext(db: Db, taskRow: TaskRow): Record<string, unknown> {
  const workflowId = taskRow.workflowId;
  if (!workflowId) return {};

  const workflow = new WorkflowModel(db).findById(String(workflowId));
  if (!workflow) return {};

  const tasks = new TaskModel(db).listByWorkflowId(String(workflowId));
  const ordered = orderedWorkflowTasks(workflow, tasks);
  const currentId = String(taskRow.id ?? "");

  const priorSteps: StepOutput[] = [];
  for (const task of ordered) {
    if (String(task.id) === currentId) break;
    if ((task.status ?? "").toLowerCase() !== "completed") continue;
    priorSteps.push(stepOutputFromTask(task));
  }

  if (priorSteps.length === 0) return {};
  return { prev: priorSteps[priorSteps.length - 1], steps: priorSteps };
}

function setWorkflowStatus(db: Db, workflowId: string, status: string): void {
  new WorkflowModel(db).updateById(workflowId, { status });
}

/** Fail running runs whose tasks have all settled (crashed workers, lost queue rows). */
export function recoverStaleWorkflowRuns(db: Db): number {
  const taskModel = new TaskModel(db);
  const runModel = new WorkflowRunModel(db);
  const workflowModel = new WorkflowModel(db);
  let recovered = 0;

  for (const run of runModel.listRunning()) {
    const tasks = taskModel.listByWorkflowId(run.workflowId);
    const inFlight = tasks.some((task) =>
      ["queued", "running", "dispatched"].includes((task.status ?? "").toLowerCase()),
    );
    if (inFlight) continue;
    runModel.updateById(run.id, { status: "failed", completedAt: new Date().toISOString() });
    workflowModel.updateById(run.workflowId, { status: "failed" });
    recovered += 1;
  }

  return recovered;
}

export interface FormattedRun {
  id: string;
  workflowId: string;
  status: string;
  triggeredBy: string;
  currentStep: number;
  startedAt: string;
  completedAt: string;
  duration: string | null;
}

export function listWorkflowRuns(db: Db, userId: string, workflowId: string): FormattedRun[] {
  const workflow = new WorkflowModel(db).findById(workflowId);
  requireRowAccess(db, userId, workflow, { notFoundDetail: "Workflow not found" });
  return new WorkflowRunModel(db).listByWorkflowId(workflowId).map(formatRun);
}

export function startWorkflowRun(
  db: Db,
  taskQueue: Queue,
  userId: string,
  workflowId: string,
  triggeredBy = "manual",
): FormattedRun {
  const workflowModel = new WorkflowModel(db);
  const taskModel = new TaskModel(db);
  const runModel = new WorkflowRunModel(db);

  const workflow = workflowModel.findById(workflowId);
  requireRowAccess(db, userId, workflow, { notFoundDetail: "Workflow not found" });

  const tasks = taskModel.listByWorkflowId(workflowId);
  const active = runModel.findActiveForWorkflow(workflowId);
  if (active) {
    const inFlight = tasks.some((task) =>
      ["queued", "running"].includes((task.status ?? "").toLowerCase()),
    );
    if (inFlight) {
      throw createError(409, "Workflow already has a run in progress");
    }
    runModel.updateById(active.id, { status: "failed", completedAt: new Date().toISOString() });
  }

  if (tasks.length === 0) throw createError(400, "Workflow has no steps to run");

  const ordered = orderedWorkflowTasks(workflow!, tasks);
  if (ordered.length === 0) throw createError(400, "Workflow has no runnable HTTP steps");

  for (const task of ordered) {
    if (!(task.url ?? "").trim() && !task.urlTemplate) {
      throw createError(
        400,
        `Step ${Number(task.stepOrder ?? 0) + 1} needs a URL before running`,
      );
    }
  }

  const now = new Date().toISOString();
  const runId = runModel.create({
    id: randomUUID(),
    workflowId,
    status: "running",
    triggeredBy,
    currentStep: 0,
    startedAt: now,
    userId,
  });

  for (const task of ordered) {
    taskModel.resetForWorkflowRun(String(task.id));
  }

  const firstTaskId = String(ordered[0]!.id);
  taskModel.updateStatus(firstTaskId, "queued");
  taskQueue.send({ task_id: firstTaskId, workflow_run_id: runId });
  setWorkflowStatus(db, workflowId, "running");

  const run = runModel.findById(runId);
  return formatRun(run);
}

export function cancelWorkflowRun(
  db: Db,
  userId: string,
  workflowId: string,
): { id: string; status: string; completedAt: string } {
  const workflowModel = new WorkflowModel(db);
  const taskModel = new TaskModel(db);
  const runModel = new WorkflowRunModel(db);

  const workflow = workflowModel.findById(workflowId);
  requireRowAccess(db, userId, workflow, { notFoundDetail: "Workflow not found" });

  const active = runModel.findActiveForWorkflow(workflowId);
  if (!active) throw createError(400, "No active run to cancel");

  const now = new Date().toISOString();
  for (const task of taskModel.listByWorkflowId(workflowId)) {
    if (["queued", "running", "dispatched"].includes((task.status ?? "").toLowerCase())) {
      taskModel.updateStatus(String(task.id), "cancelled");
    }
  }

  runModel.updateById(active.id, { status: "cancelled", completedAt: now });
  setWorkflowStatus(db, workflowId, "paused");

  return { id: String(active.id), status: "Cancelled", completedAt: now };
}

/** Advance the run after one of its tasks settles; any non-completed step fails the run. */
export function handleWorkflowTaskCompletion(
  db: Db,
  taskQueue: Queue,
  taskId: string,
  workflowRunId: string,
  finalStatus: string,
): void {
  const runModel = new WorkflowRunModel(db);
  const taskModel = new TaskModel(db);
  const workflowModel = new WorkflowModel(db);

  const run = runModel.findById(workflowRunId);
  if (!run || run.status !== "running") return;

  const taskRow = taskModel.findById(taskId);
  if (!taskRow || !taskRow.workflowId) return;

  const workflowId = String(taskRow.workflowId);
  if (String(run.workflowId) !== workflowId) return;

  const now = new Date().toISOString();
  const failRun = (): void => {
    runModel.updateById(workflowRunId, { status: "failed", completedAt: now });
    setWorkflowStatus(db, workflowId, "failed");
  };

  if (finalStatus !== "completed") {
    failRun();
    return;
  }

  const workflow = workflowModel.findById(workflowId);
  if (!workflow) {
    failRun();
    return;
  }

  const ordered = orderedWorkflowTasks(workflow, taskModel.listByWorkflowId(workflowId));
  const stepIndex = ordered.findIndex((task) => String(task.id) === String(taskId));
  if (stepIndex === -1) {
    failRun();
    return;
  }

  const nextIndex = stepIndex + 1;
  runModel.updateById(workflowRunId, { currentStep: nextIndex });

  if (nextIndex >= ordered.length) {
    runModel.updateById(workflowRunId, { status: "completed", completedAt: now });
    setWorkflowStatus(db, workflowId, "completed");
    return;
  }

  const nextTaskId = String(ordered[nextIndex]!.id);
  taskModel.updateStatus(nextTaskId, "queued");
  taskQueue.send({ task_id: nextTaskId, workflow_run_id: workflowRunId });
}

/**
 * Steps in execution order: the graph's linear path joined to task rows by `task_id`, falling
 * back to `step_order` position when a node carries no id (pre-canvas rows).
 */
export function orderedWorkflowTasks(workflow: WorkflowRow, tasks: TaskRow[]): TaskRow[] {
  const graph = resolveGraph(workflow, tasks);
  const httpOrder = linearOrderFromTrigger(graph);

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const byTaskId = new Map(tasks.map((task) => [String(task.id), task]));

  const ordered: TaskRow[] = [];
  for (const nodeId of httpOrder) {
    const rawTaskId = nodes.get(nodeId)?.data?.task_id;
    const taskId = rawTaskId != null ? String(rawTaskId) : null;
    if (taskId && byTaskId.has(taskId)) {
      ordered.push(byTaskId.get(taskId)!);
      continue;
    }
    const match = tasks.find((task) => Number(task.stepOrder ?? 0) === ordered.length);
    if (match) ordered.push(match);
  }

  if (ordered.length > 0) return ordered;
  return [...tasks].sort(compareTasks);
}

function compareTasks(a: TaskRow, b: TaskRow): number {
  const order = Number(a.stepOrder ?? 0) - Number(b.stepOrder ?? 0);
  if (order !== 0) return order;
  return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
}

export function formatRun(run: WorkflowRunRow | null): FormattedRun {
  if (!run) return {} as FormattedRun;
  const status = (run.status ?? "running").toLowerCase();
  return {
    id: String(run.id),
    workflowId: String(run.workflowId),
    status: status.charAt(0).toUpperCase() + status.slice(1),
    triggeredBy: run.triggeredBy ?? "manual",
    currentStep: Number(run.currentStep ?? 0),
    startedAt: run.startedAt ?? "",
    completedAt: run.completedAt ?? "",
    duration: runDuration(run),
  };
}

export function runDuration(run: WorkflowRunRow): string | null {
  if (["running", "pending"].includes((run.status ?? "").toLowerCase())) return null;
  if (!run.startedAt || !run.completedAt) return null;
  const started = Date.parse(run.startedAt);
  const completed = Date.parse(run.completedAt);
  if (Number.isNaN(started) || Number.isNaN(completed)) return null;
  const diffSeconds = (completed - started) / 1000;
  if (diffSeconds < 1) return `${Math.trunc(diffSeconds * 1000)}ms`;
  if (diffSeconds < 60) return `${diffSeconds.toFixed(1)}s`;
  return `${Math.trunc(diffSeconds / 60)}m ${Math.trunc(diffSeconds % 60)}s`;
}

export function logStaleRecovery(recovered: number): void {
  if (recovered > 0) log("info", "stale_workflow_runs_recovered", { recovered });
}