import { Router } from "express";
import { z } from "zod";
import { success } from "../../core/http/responses.js";
import { currentUser, requireJwt } from "../../core/middleware/auth.js";
import { validateBody } from "../../core/middleware/validate.js";
import { resolveRequestWorkspace } from "../workspace/index.js";
import { archiveAgent, createAgent, listAgents } from "./service.js";
import type { CreateAgentInput } from "./service.js";

export const agentsRouter = Router();

const createAgentSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  parent_agent_id: z.string().nullish(),
  project_id: z.string().nullish(),
  environment: z.string().nullish(),
  public_key: z.string().nullish(),
});

agentsRouter.post(
  "/api/v1/agents",
  requireJwt(),
  validateBody(createAgentSchema),
  (req, res) => {
    const workspaceId = resolveRequestWorkspace(req, currentUser(req));
    const result = createAgent(
      req.ctx.db,
      currentUser(req).id,
      workspaceId,
      req.body as CreateAgentInput,
    );
    res.json(success(result.data, result.message));
  },
);

agentsRouter.get("/api/v1/agents", requireJwt(), (req, res) => {
  const workspaceId = resolveRequestWorkspace(req, currentUser(req));
  const items = listAgents(req.ctx.db, workspaceId);
  res.json(success(items, undefined, { total: items.length }));
});

agentsRouter.delete("/api/v1/agents/:agent_id", requireJwt(), (req, res) => {
  const workspaceId = resolveRequestWorkspace(req, currentUser(req));
  const result = archiveAgent(req.ctx.db, workspaceId, String(req.params.agent_id));
  res.json(success(result.data, result.message));
});
