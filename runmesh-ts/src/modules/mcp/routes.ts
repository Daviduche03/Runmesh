import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { currentUser, requireAuth } from "../../core/middleware/auth.js";
import { resolveRequestWorkspace } from "../workspace/index.js";
import { handleMcp } from "./service.js";

export const mcpRouter = Router();

function bodyMethods(body: unknown): unknown[] {
  if (Array.isArray(body)) return body.map((entry) => (entry as { method?: unknown })?.method);
  return [(body as { method?: unknown } | null)?.method];
}

/**
 * One credential rule for both verbs: listing is reading, calling is writing. The auth
 * middleware runs first so an unauthenticated client gets a 401 before any JSON-RPC shape.
 */
function mcpAuth(req: Request, res: Response, next: NextFunction): void {
  const write = bodyMethods(req.body).some((method) => method === "tools/call");
  const guard = write ? requireAuth("write") : requireAuth();
  guard(req, res, next);
}

function workspaceOf(req: Request): string {
  return resolveRequestWorkspace(req, currentUser(req));
}

mcpRouter.post("/mcp", mcpAuth, async (req, res) => {
  try {
    const outcome = await handleMcp(req.ctx.db, currentUser(req).id, workspaceOf(req), req.body);
    if (outcome.httpStatus === 202) {
      res.status(202).end();
      return;
    }
    res.status(outcome.httpStatus).json(outcome.payload);
  } catch {
    res.status(200).json({
      jsonrpc: "2.0",
      id:
        typeof (req.body as { id?: unknown })?.id === "string" ||
        typeof (req.body as { id?: unknown })?.id === "number"
          ? (req.body as { id: string | number }).id
          : null,
      error: { code: -32603, message: "Internal error." },
    });
  }
});

function onlyPost(_req: Request, res: Response): void {
  res.status(405).json({
    jsonrpc: "2.0",
    id: null,
    error: { code: -32601, message: "Method not allowed: POST a JSON-RPC request to /mcp." },
  });
}

mcpRouter.get("/mcp", onlyPost);
mcpRouter.delete("/mcp", onlyPost);
