/**
 * The workflow canvas graph and its sync to task rows.
 *
 * Two representations coexist: the stored graph (nodes/edges drawn in the UI) and the task
 * rows that actually execute. `resolveGraph` prefers the stored graph; `tasksToGraph` derives
 * one from bare task rows for workflows created before the canvas existed. `syncGraphToTasks`
 * is the write path — the graph is the source of truth and task rows follow it.
 *
 * Phase A supports a single linear path of HTTP steps after the trigger node.
 */
import createError from "http-errors";
import { randomUUID } from "node:crypto";
import type { Db } from "../../core/db/client.js";
import { TaskModel, WorkflowModel } from "../../core/db/orm.js";
import type { TaskInsert, TaskRow, WorkflowRow } from "../../core/db/orm.js";
import { requireRowAccess } from "../workspace/index.js";
import { applyTaskTemplates } from "../tasks/templating.js";
import { normalizeTriggerConfig, parseTriggerConfig } from "./trigger-config.js";

export const NODE_TRIGGER = "trigger";
export const NODE_HTTP = "http";
export const TRIGGER_NODE_ID = "trigger";

export interface GraphNode {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
}

export interface GraphEdge {
  id?: string;
  source?: string;
  target?: string;
}

export interface WorkflowGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function emptyGraph(triggerType = "manual"): WorkflowGraph {
  return {
    nodes: [
      {
        id: TRIGGER_NODE_ID,
        type: NODE_TRIGGER,
        position: { x: 40, y: 160 },
        data: { label: "Trigger", triggerType },
      },
    ],
    edges: [],
  };
}

export function parseGraphField(raw: unknown): WorkflowGraph | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as WorkflowGraph;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as WorkflowGraph;
    } catch {
      return null;
    }
  }
  return null;
}

export function tasksToGraph(
  workflow: Pick<WorkflowRow, "triggerType">,
  tasks: TaskRow[],
): WorkflowGraph {
  const graph = emptyGraph(workflow.triggerType ?? "manual");
  const ordered = [...tasks].sort((a, b) => {
    const order = (a.stepOrder ?? 0) - (b.stepOrder ?? 0);
    if (order !== 0) return order;
    return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
  });

  let prevId = TRIGGER_NODE_ID;
  let x = 260;

  ordered.forEach((task, index) => {
    const nodeId = `http-${task.id}`;
    let payload: unknown = task.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = {};
      }
    }

    const nodeData: Record<string, unknown> = {
      label: `Step ${index + 1}`,
      url: task.url ?? "",
      payload: typeof payload === "object" && payload !== null ? payload : {},
      execution_type: task.executionType ?? "queue",
      task_id: String(task.id),
    };
    if (typeof task.payloadTemplate === "string" && task.payloadTemplate) {
      nodeData.payload_template = task.payloadTemplate;
    }
    if (typeof task.urlTemplate === "string" && task.urlTemplate) {
      nodeData.url_template = task.urlTemplate;
    }

    graph.nodes.push({ id: nodeId, type: NODE_HTTP, position: { x, y: 160 }, data: nodeData });
    graph.edges.push({ id: `edge-${prevId}-${nodeId}`, source: prevId, target: nodeId });
    prevId = nodeId;
    x += 240;
  });

  return graph;
}

export function resolveGraph(
  workflow: Pick<WorkflowRow, "graph" | "triggerType">,
  tasks: TaskRow[],
): WorkflowGraph {
  const stored = parseGraphField(workflow.graph);
  if (stored && stored.nodes && stored.nodes.length > 0) return stored;
  if (tasks.length > 0) return tasksToGraph(workflow, tasks);
  return emptyGraph(workflow.triggerType ?? "manual");
}

function nodeMap(graph: WorkflowGraph): Map<string, GraphNode> {
  const nodes = new Map<string, GraphNode>();
  for (const node of graph.nodes ?? []) {
    if (node?.id) nodes.set(node.id, node);
  }
  return nodes;
}

function outgoingEdges(graph: WorkflowGraph): Map<string, string[]> {
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges ?? []) {
    if (!edge?.source || !edge?.target) continue;
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  }
  return outgoing;
}

/** Walk the single linear path from the trigger; anything else is a 400. */
export function linearOrderFromTrigger(graph: WorkflowGraph): string[] {
  const nodes = nodeMap(graph);
  const outgoing = outgoingEdges(graph);

  if (!nodes.has(TRIGGER_NODE_ID)) {
    throw createError(400, "Graph must include a trigger node");
  }
  const trigger = nodes.get(TRIGGER_NODE_ID)!;
  if (trigger.type !== NODE_TRIGGER) {
    throw createError(400, "Trigger node has invalid type");
  }

  const order: string[] = [];
  let current = TRIGGER_NODE_ID;
  const visited = new Set([TRIGGER_NODE_ID]);

  for (;;) {
    const nextTargets = outgoing.get(current) ?? [];
    if (nextTargets.length === 0) break;
    if (nextTargets.length > 1) {
      throw createError(400, "Phase A supports a single linear path only");
    }
    const next = nextTargets[0]!;
    if (visited.has(next)) throw createError(400, "Graph cannot contain cycles");
    const node = nodes.get(next);
    if (!node) throw createError(400, `Unknown node '${next}'`);
    if (node.type !== NODE_HTTP) {
      throw createError(400, "Only HTTP steps can follow the trigger in phase A");
    }
    order.push(next);
    visited.add(next);
    current = next;
    if ((outgoing.get(current) ?? []).length > 1) {
      throw createError(400, "Phase A supports a single linear path only");
    }
  }

  for (const [nodeId] of nodes) {
    if (nodeId === TRIGGER_NODE_ID) continue;
    if (!visited.has(nodeId)) {
      throw createError(400, "All nodes must be connected to the trigger");
    }
  }

  return order;
}

export function validateGraph(graph: WorkflowGraph): void {
  if (!graph.nodes || graph.nodes.length === 0) {
    throw createError(400, "Graph must include nodes");
  }
  linearOrderFromTrigger(graph);
}

/**
 * Rewrite the workflow's task rows from the graph. Steps keep their task ids when the node
 * carries one; dropped nodes delete their rows. Returns the graph with ids filled in.
 */
export function syncGraphToTasks(
  db: Db,
  workflowId: string,
  userId: string,
  graph: WorkflowGraph,
  workspaceId?: string | null,
): WorkflowGraph {
  validateGraph(graph);
  const nodes = nodeMap(graph);
  const httpOrder = linearOrderFromTrigger(graph);
  const taskModel = new TaskModel(db);
  const existingById = new Map(taskModel.listByWorkflowId(workflowId).map((t) => [String(t.id), t]));
  const referenced = new Set<string>();
  const now = new Date().toISOString();

  httpOrder.forEach((nodeId, stepOrder) => {
    const node = nodes.get(nodeId)!;
    const data = node.data ?? {};
    const url = String(data.url ?? "").trim();
    const urlTemplate = data.url_template;
    if (!url && !urlTemplate) {
      throw createError(400, `HTTP step '${nodeId}' needs url or url_template`);
    }

    const payload = data.payload ?? {};
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw createError(400, `HTTP step '${nodeId}' payload must be an object`);
    }

    const data_: { payloadTemplate?: string | null; urlTemplate?: string | null } = {};
    applyTaskTemplates(
      data_,
      typeof data.payload_template === "string" ? data.payload_template : null,
      typeof urlTemplate === "string" ? urlTemplate : null,
    );

    const taskId = data.task_id != null ? String(data.task_id) : null;
    if (taskId && existingById.has(taskId)) {
      referenced.add(taskId);
      const patch: Partial<TaskInsert> = {
        url,
        payload: JSON.stringify(payload),
        executionType: String(data.execution_type ?? "queue"),
        stepOrder,
      };
      const signingSecret = String(data.signing_secret ?? "").trim();
      if (signingSecret) patch.signingSecret = signingSecret;
      if (data_.payloadTemplate) patch.payloadTemplate = data_.payloadTemplate;
      if (data_.urlTemplate) patch.urlTemplate = data_.urlTemplate;
      taskModel.updateById(taskId, patch);
      node.data = { ...data, task_id: taskId };
    } else {
      const insert: TaskInsert = {
        id: randomUUID(),
        type: "task",
        payload: JSON.stringify(payload),
        url,
        status: "pending",
        retries: 0,
        maxRetries: 5,
        scheduledAt: now,
        executionType: String(data.execution_type ?? "queue"),
        createdAt: now,
        updatedAt: now,
        userId,
        workspaceId: workspaceId ?? null,
        workflowId,
        stepOrder,
        signingSecret: String(data.signing_secret ?? "").trim() || null,
        payloadTemplate: data_.payloadTemplate ?? null,
        urlTemplate: data_.urlTemplate ?? null,
      };
      const createdId = taskModel.create(insert);
      referenced.add(createdId);
      node.data = { ...data, task_id: createdId };
    }
  });

  for (const [taskId] of existingById) {
    if (!referenced.has(taskId)) {
      taskModel.deleteTask(taskId);
    }
  }

  return graph;
}

/** Persist the canvas graph: sync task rows, adopt the trigger node's type, save. */
export function saveWorkflowGraph(
  db: Db,
  userId: string,
  workflowId: string,
  graph: WorkflowGraph,
): WorkflowGraph {
  const workflowModel = new WorkflowModel(db);
  const workflow = workflowModel.findById(workflowId);
  requireRowAccess(db, userId, workflow, { notFoundDetail: "Workflow not found" });

  const synced = syncGraphToTasks(db, workflowId, userId, graph, workflow!.workspaceId);

  const triggerNode = nodeMap(synced).get(TRIGGER_NODE_ID);
  const triggerData = triggerNode?.data ?? {};
  const triggerType =
    String(triggerData.triggerType ?? "") || workflow!.triggerType || "manual";

  let triggerConfigRaw = workflow!.triggerConfig ?? "{}";
  if (triggerType === "schedule") {
    const nodeCron = triggerData.cron;
    const config = parseTriggerConfig(workflow!);
    if (nodeCron) config.cron = String(nodeCron).trim();
    triggerConfigRaw = normalizeTriggerConfig(triggerType, JSON.stringify(config));
  }

  workflowModel.updateById(workflowId, {
    graph: JSON.stringify(synced),
    triggerType,
    triggerConfig: triggerConfigRaw,
  });
  return synced;
}
