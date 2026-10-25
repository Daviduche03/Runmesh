import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { success } from "../../core/http/responses.js";
import { currentUser, requireAuth } from "../../core/middleware/auth.js";
import { validateBody } from "../../core/middleware/validate.js";
import { resolveRequestWorkspace } from "../workspace/index.js";
import type { WorkflowGraph } from "./graph.js";
import { saveWorkflowGraph } from "./graph.js";
import { cancelWorkflowRun, listWorkflowRuns, startWorkflowRun } from "./runner.js";
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
} from "./service.js";
import { triggerWorkflowForUser } from "./triggers.js";

export const workflowsRouter = Router();

const workflowStepSchema = z.object({
  url: z.string().nullish(),
  payload: z.record(z.string(), z.unknown()).default({}),
  payload_template: z.string().nullish(),
  url_template: z.string().nullish(),
  type: z.string().default("task"),
  execution_type: z.string().default("queue"),
  scheduled_at: z.string().nullish(),
});

const workflowCreateSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  trigger_type: z.string().default("manual"),
  trigger_config: z.string().nullish(),
  agent_id: z.string().nullish(),
  thread_id: z.string().nullish(),
  workspace_project_id: z.string().nullish(),
  connect_app_id: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  tasks: z.array(workflowStepSchema).default([]),
});

const workflowUpdateSchema = z.object({
  description: z.string().nullish(),
  name: z.string().nullish(),
  trigger_type: z.string().nullish(),
  trigger_config: z.string().nullish(),
});

const graphNodeSchema = z.record(z.string(), z.unknown());
const workflowGraphSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphNodeSchema),
});

function workspaceOf(req: Request): string {
  return resolveRequestWorkspace(req, currentUser(req));
}

type CreateBody = z.infer<typeof workflowCreateSchema>;
type UpdateBody = z.infer<typeof workflowUpdateSchema>;

workflowsRouter.get("/api/v1/workflows", requireAuth("read"), (req, res) => {
  const items = listWorkflows(req.ctx.db, currentUser(req).id, workspaceOf(req));
  res.json(success(items, undefined, { total: items.length }));
});

workflowsRouter.post(
  "/api/v1/workflows",
  requireAuth("write"),
  validateBody(workflowCreateSchema),
  (req, res) => {
    const body = req.body as CreateBody;
    const result = createWorkflow(
      req.ctx.db,
      {
        name: body.name,
        description: body.description,
        triggerType: body.trigger_type,
        triggerConfig: body.trigger_config,
        agentId: body.agent_id,
        threadId: body.thread_id,
        workspaceProjectId: body.workspace_project_id,
        connectAppId: body.connect_app_id,
        metadata: body.metadata,
        tasks: (body.tasks ?? []).map((step) => ({
          url: step.url,
          payload: step.payload,
          payloadTemplate: step.payload_template,
          urlTemplate: step.url_template,
          type: step.type,
          executionType: step.execution_type,
          scheduledAt: step.scheduled_at,
        })),
      },
      currentUser(req).id,
      workspaceOf(req),
    );
    res.json(success({ workflow_id: result.workflowId }, result.message));
  },
);

workflowsRouter.get("/api/v1/workflows/:workflow_id", requireAuth("read"), (req, res) => {
  const data = getWorkflow(req.ctx.db, currentUser(req).id, String(req.params.workflow_id));
  res.json(success(data));
});

workflowsRouter.patch(
  "/api/v1/workflows/:workflow_id",
  requireAuth("write"),
  validateBody(workflowUpdateSchema),
  (req, res) => {
    const body = req.body as UpdateBody;
    const data = updateWorkflow(req.ctx.db, currentUser(req).id, String(req.params.workflow_id), {
      description: body.description,
      name: body.name,
      triggerType: body.trigger_type,
      triggerConfig: body.trigger_config,
    });
    res.json(success(data, "Workflow updated"));
  },
);

workflowsRouter.delete("/api/v1/workflows/:workflow_id", requireAuth("write"), (req, res) => {
  const id = deleteWorkflow(req.ctx.db, currentUser(req).id, String(req.params.workflow_id));
  res.json(success({ id }, "Workflow deleted"));
});

workflowsRouter.put(
  "/api/v1/workflows/:workflow_id/graph",
  requireAuth("write"),
  validateBody(workflowGraphSchema),
  (req: Request, res: Response) => {
    const body = req.body as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
    const graph = saveWorkflowGraph(
      req.ctx.db,
      currentUser(req).id,
      String(req.params.workflow_id),
      {
        nodes: body.nodes.map((node) => ({
          id: String(node.id ?? ""),
          type: String(node.type ?? ""),
          position: node.position as { x: number; y: number } | undefined,
          data: (node.data ?? {}) as Record<string, unknown>,
        })),
        edges: body.edges.map((edge) => ({
          id: edge.id != null ? String(edge.id) : undefined,
          source: edge.source != null ? String(edge.source) : undefined,
          target: edge.target != null ? String(edge.target) : undefined,
        })),
      } satisfies WorkflowGraph,
    );
    res.json(success(graph, "Workflow graph saved"));
  },
);

workflowsRouter.post("/api/v1/workflows/:workflow_id/run", requireAuth("write"), (req, res) => {
  const run = startWorkflowRun(
    req.ctx.db,
    req.ctx.taskQueue,
    currentUser(req).id,
    String(req.params.workflow_id),
  );
  res.json(success(run, "Workflow run started"));
});

workflowsRouter.post("/api/v1/workflows/:workflow_id/trigger", requireAuth("write"), (req, res) => {
  const run = triggerWorkflowForUser(
    req.ctx.db,
    req.ctx.taskQueue,
    currentUser(req).id,
    String(req.params.workflow_id),
    "webhook",
  );
  res.json(success(run, "Workflow triggered"));
});

workflowsRouter.get("/api/v1/workflows/:workflow_id/runs", requireAuth("read"), (req, res) => {
  const runs = listWorkflowRuns(req.ctx.db, currentUser(req).id, String(req.params.workflow_id));
  res.json(success(runs, undefined, { total: runs.length }));
});

workflowsRouter.post("/api/v1/workflows/:workflow_id/cancel", requireAuth("write"), (req, res) => {
  const result = cancelWorkflowRun(
    req.ctx.db,
    currentUser(req).id,
    String(req.params.workflow_id),
  );
  res.json(success(result, "Workflow run cancelled"));
});
