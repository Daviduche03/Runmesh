import { Router } from "express";
import { z } from "zod";
import { success } from "../../core/http/responses.js";
import { currentUser, requireAuth } from "../../core/middleware/auth.js";
import { validateBody } from "../../core/middleware/validate.js";
import { resolveRequestWorkspace } from "../workspace/index.js";
import {
  createTrigger,
  deleteTrigger,
  fireTrigger,
  getTrigger,
  listTriggerRuns,
  listTriggers,
  updateTrigger,
} from "./service.js";

export const triggersRouter = Router();

const triggerCreateSchema = z.object({
  agent_id: z.string(),
  type: z.string().default("api"),
  name: z.string(),
  config: z.record(z.string(), z.unknown()).default({}),
  endpoint: z.string().nullish(),
  endpoint_secret: z.string().nullish(),
});

const triggerUpdateSchema = z.object({
  name: z.string().nullish(),
  config: z.record(z.string(), z.unknown()).nullish(),
  enabled: z.boolean().nullish(),
  endpoint: z.string().nullish(),
  endpoint_secret: z.string().nullish(),
});

const triggerFireSchema = z.object({
  input: z.unknown().nullish(),
});

function workspaceOf(req: Parameters<typeof resolveRequestWorkspace>[0]): string {
  return resolveRequestWorkspace(req, currentUser(req));
}

triggersRouter.get("/api/v1/triggers", requireAuth("read"), (req, res) => {
  const agentId = typeof req.query.agent_id === "string" ? req.query.agent_id : undefined;
  const result = listTriggers(req.ctx.db, workspaceOf(req), agentId);
  res.json(success(result.data, undefined, { total: result.total }));
});

triggersRouter.post(
  "/api/v1/triggers",
  requireAuth("write"),
  validateBody(triggerCreateSchema),
  (req, res) => {
    const body = req.body as z.infer<typeof triggerCreateSchema>;
    const result = createTrigger(req.ctx.db, currentUser(req).id, workspaceOf(req), {
      agentId: body.agent_id,
      type: body.type,
      name: body.name,
      config: body.config,
      endpoint: body.endpoint,
      endpointSecret: body.endpoint_secret,
    });
    res.json(success(result.data, result.message));
  },
);

triggersRouter.get("/api/v1/triggers/:trigger_id", requireAuth("read"), (req, res) => {
  res.json(success(getTrigger(req.ctx.db, workspaceOf(req), String(req.params.trigger_id))));
});

triggersRouter.patch(
  "/api/v1/triggers/:trigger_id",
  requireAuth("write"),
  validateBody(triggerUpdateSchema),
  (req, res) => {
    const body = req.body as z.infer<typeof triggerUpdateSchema>;
    const result = updateTrigger(req.ctx.db, workspaceOf(req), String(req.params.trigger_id), {
      name: body.name,
      config: body.config,
      enabled: body.enabled,
      endpoint: body.endpoint,
      endpointSecret: body.endpoint_secret,
    });
    res.json(success(result.data, result.message));
  },
);

triggersRouter.delete("/api/v1/triggers/:trigger_id", requireAuth("write"), (req, res) => {
  const id = deleteTrigger(req.ctx.db, workspaceOf(req), String(req.params.trigger_id));
  res.json(success({ id }, "Trigger deleted"));
});

triggersRouter.post(
  "/api/v1/triggers/:trigger_id/activate",
  requireAuth("write"),
  (req, res) => {
    const result = updateTrigger(req.ctx.db, workspaceOf(req), String(req.params.trigger_id), {
      enabled: true,
    });
    res.json(success(result.data, result.message));
  },
);

triggersRouter.post(
  "/api/v1/triggers/:trigger_id/deactivate",
  requireAuth("write"),
  (req, res) => {
    const result = updateTrigger(req.ctx.db, workspaceOf(req), String(req.params.trigger_id), {
      enabled: false,
    });
    res.json(success(result.data, result.message));
  },
);

triggersRouter.post(
  "/api/v1/triggers/:trigger_id/fire",
  requireAuth("write"),
  validateBody(triggerFireSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof triggerFireSchema>;
      const result = await fireTrigger(
        req.ctx.db,
        currentUser(req).id,
        workspaceOf(req),
        String(req.params.trigger_id),
        body.input,
      );
      res.json(success(result.data, result.message));
    } catch (err) {
      next(err);
    }
  },
);

triggersRouter.get("/api/v1/triggers/:trigger_id/runs", requireAuth("read"), (req, res) => {
  const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const result = listTriggerRuns(
    req.ctx.db,
    workspaceOf(req),
    String(req.params.trigger_id),
    rawLimit === undefined ? 50 : Number(rawLimit),
  );
  res.json(success(result.data, undefined, { total: result.total }));
});
