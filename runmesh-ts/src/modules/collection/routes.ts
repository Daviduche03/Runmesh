import { Router } from "express";
import { z } from "zod";
import { success } from "../../core/http/responses.js";
import { currentUser, requireAuth } from "../../core/middleware/auth.js";
import { validateBody } from "../../core/middleware/validate.js";
import { resolveRequestWorkspace } from "../workspace/index.js";
import {
  finishRun,
  getRun,
  ingestEvents,
  listAgentRuns,
  resolveAgent,
  startReplayRun,
  startRun,
} from "./service.js";

export const collectionRouter = Router();

const agentResolveSchema = z.object({
  external_key: z.string().nullish(),
  fingerprint: z.string().nullish(),
  name: z.string().nullish(),
  framework: z.string().nullish(),
  model: z.string().nullish(),
  system_prompt: z.string().nullish(),
  tools: z.array(z.record(z.string(), z.unknown())).nullish(),
});

const runStartSchema = z.object({
  agent_id: z.string(),
  parent_run_id: z.string().nullish(),
  input: z.string().nullish(),
  thread_id: z.string().nullish(),
  connect_user_id: z.string().nullish(),
});

const runFinishSchema = z.object({
  status: z.string().default("completed"),
  usage: z.record(z.string(), z.unknown()).nullish(),
});

const ingestEventSchema = z.object({
  run_id: z.string(),
  kind: z.string().default("log"),
  name: z.string().default(""),
  args: z.unknown().nullish(),
  result: z.unknown().nullish(),
  duration_ms: z.number().nullish(),
});

const ingestSchema = z.object({
  events: z.array(ingestEventSchema).default([]),
});

function workspaceOf(req: Parameters<typeof resolveRequestWorkspace>[0]): string {
  return resolveRequestWorkspace(req, currentUser(req));
}

collectionRouter.put(
  "/api/v1/agents:resolve",
  requireAuth("write"),
  validateBody(agentResolveSchema),
  (req, res) => {
    const body = req.body as z.infer<typeof agentResolveSchema>;
    const result = resolveAgent(req.ctx.db, currentUser(req).id, workspaceOf(req), {
      externalKey: body.external_key,
      fingerprint: body.fingerprint,
      name: body.name,
      framework: body.framework,
      model: body.model,
      systemPrompt: body.system_prompt,
      tools: body.tools,
    });
    res.json(success(result.data, result.message));
  },
);

collectionRouter.post(
  "/api/v1/runs",
  requireAuth("write"),
  validateBody(runStartSchema),
  (req, res) => {
    const body = req.body as z.infer<typeof runStartSchema>;
    const result = startRun(req.ctx.db, currentUser(req).id, workspaceOf(req), {
      agentId: body.agent_id,
      parentRunId: body.parent_run_id,
      input: body.input,
      threadId: body.thread_id,
      connectUserId: body.connect_user_id,
    });
    res.json(success(result.data, result.message));
  },
);

collectionRouter.post(
  "/api/v1/runs/:run_id/finish",
  requireAuth("write"),
  validateBody(runFinishSchema),
  (req, res) => {
    const body = req.body as z.infer<typeof runFinishSchema>;
    const result = finishRun(
      req.ctx.db,
      currentUser(req).id,
      workspaceOf(req),
      String(req.params.run_id),
      { status: body.status, usage: body.usage },
    );
    res.json(success(result.data, result.message));
  },
);

collectionRouter.post("/api/v1/runs/:run_id/replay", requireAuth("write"), (req, res) => {
  const result = startReplayRun(
    req.ctx.db,
    currentUser(req).id,
    workspaceOf(req),
    String(req.params.run_id),
  );
  res.json(success(result.data, result.message));
});

collectionRouter.get("/api/v1/agents/:agent_id/runs", requireAuth("read"), (req, res) => {
  const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const result = listAgentRuns(
    req.ctx.db,
    currentUser(req).id,
    workspaceOf(req),
    String(req.params.agent_id),
    rawLimit === undefined ? 50 : Number(rawLimit),
  );
  res.json(success(result.data, undefined, { total: result.total }));
});

collectionRouter.get("/api/v1/runs/:run_id", requireAuth("read"), (req, res) => {
  const data = getRun(req.ctx.db, currentUser(req).id, workspaceOf(req), String(req.params.run_id));
  res.json(success(data));
});

collectionRouter.post(
  "/api/v1/ingest",
  requireAuth("write"),
  validateBody(ingestSchema),
  (req, res) => {
    const body = req.body as z.infer<typeof ingestSchema>;
    const result = ingestEvents(
      req.ctx.db,
      currentUser(req).id,
      workspaceOf(req),
      body.events.map((event) => ({
        runId: event.run_id,
        kind: event.kind,
        name: event.name,
        args: event.args,
        result: event.result,
        durationMs: event.duration_ms,
      })),
    );
    res.json(success(result.data, result.message));
  },
);
