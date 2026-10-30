import { Router } from "express";
import { z } from "zod";
import { success } from "../../core/http/responses.js";
import { currentUser, requireAuth } from "../../core/middleware/auth.js";
import { validateBody } from "../../core/middleware/validate.js";
import { resolveRequestWorkspace } from "../workspace/index.js";
import { HOOK_EVENTS, handleHook } from "./service.js";

export const hooksRouter = Router();

const normalizedSchema = z.object({
  source: z.string().min(1).max(64),
  event: z.enum(HOOK_EVENTS).default("tool.before"),
  session_id: z.string().min(1).max(128),
  agent: z.string().max(128).optional(),
  tool: z.string().max(128).optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().max(4000).optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  cwd: z.string().max(1024).optional(),
});

/**
 * The narrow shell fallback. Native tool calls go through the MCP server; this endpoint
 * exists for the one thing MCP cannot see — a shell command — and its only client is the
 * `runmesh exec` shim, which forwards the command before running it. Host-specific
 * serializers do not belong here: there is exactly one shape in and one shape out.
 */
hooksRouter.post(
  "/api/v1/agent-hooks/tool",
  requireAuth("write"),
  validateBody(normalizedSchema),
  (req, res) => {
    const body = req.body as z.infer<typeof normalizedSchema>;
    const workspaceId = resolveRequestWorkspace(req, currentUser(req));
    const result = handleHook(req.ctx.db, currentUser(req).id, workspaceId, {
      source: body.source,
      event: body.event,
      sessionId: body.session_id,
      agentLabel: body.agent,
      tool: body.tool,
      input: body.input,
      output: body.output,
      error: body.error,
      durationMs: body.duration_ms,
      cwd: body.cwd,
    });
    res.json(success(result));
  },
);
