import { Router } from "express";
import { z } from "zod";
import { success } from "../../core/http/responses.js";
import { currentUser, requireAuth } from "../../core/middleware/auth.js";
import { validateBody } from "../../core/middleware/validate.js";
import { resolveRequestWorkspace } from "../workspace/index.js";
import { HOOK_EVENTS, handleHook } from "./service.js";
import type { HookInput, HookResult } from "./service.js";

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
 * Claude Code posts its own payload and parses the response body as hook output, so this route
 * cannot use the Runmesh envelope. It is the one place where the wire shape is dictated by the
 * host rather than by us.
 */
const claudeSchema = z.object({
  hook_event_name: z.string().min(1),
  session_id: z.string().min(1),
  cwd: z.string().max(1024).optional(),
  tool_name: z.string().max(128).optional(),
  tool_input: z.unknown().optional(),
  tool_response: z.unknown().optional(),
  error: z.string().max(4000).optional(),
  agent_type: z.string().max(128).optional(),
});

function mapClaudeEvent(body: z.infer<typeof claudeSchema>): HookInput | null {
  const base = {
    source: "claude-code",
    sessionId: body.session_id,
    agentLabel: body.agent_type,
    cwd: body.cwd,
  } satisfies Partial<HookInput>;

  switch (body.hook_event_name) {
    case "PreToolUse":
      return {
        ...base,
        event: "tool.before",
        tool: body.tool_name,
        input: body.tool_input,
      };
    case "PostToolUse":
      return {
        ...base,
        event: "tool.after",
        tool: body.tool_name,
        output: body.tool_response,
      };
    case "PostToolUseFailure":
      return {
        ...base,
        event: "tool.after",
        tool: body.tool_name,
        error: body.error ?? "tool failed",
      };
    case "SessionStart":
      return { ...base, event: "session.start" };
    case "SessionEnd":
      return { ...base, event: "session.end" };
    default:
      return null;
  }
}

/**
 * Confidence rule: only an *enforced* allow may say `allow`. If policy is not configured, or
 * the rule was log-only, we return no decision so Claude Code's own permission flow still runs.
 * We never make a call looser than the host would have made it.
 */
function claudeResponse(result: HookResult): Record<string, unknown> {
  const decision = result.decision;
  if (!decision || !decision.enforced) return {};

  const permissionDecision =
    decision.decision === "allow" ? "allow" : decision.decision === "deny" ? "deny" : "ask";

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision,
      permissionDecisionReason: decision.reason,
    },
  };
}

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

hooksRouter.post(
  "/api/v1/agent-hooks/claude-code",
  requireAuth("write"),
  validateBody(claudeSchema),
  (req, res) => {
    const body = req.body as z.infer<typeof claudeSchema>;
    const mapped = mapClaudeEvent(body);
    if (mapped === null) {
      res.json({});
      return;
    }
    const workspaceId = resolveRequestWorkspace(req, currentUser(req));
    const result = handleHook(req.ctx.db, currentUser(req).id, workspaceId, mapped);
    res.json(claudeResponse(result));
  },
);
