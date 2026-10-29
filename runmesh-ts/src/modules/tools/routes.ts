import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { numericError, numericFromCaught, success } from "../../core/http/responses.js";
import { currentUser, requireAuth } from "../../core/middleware/auth.js";
import { validateBody } from "../../core/middleware/validate.js";
import { resolveRequestWorkspace } from "../workspace/index.js";
import { FORWARD_METHODS, forwardTool, invokeTool, listTools } from "./invoke.js";

export const toolsRouter = Router();

const invokeSchema = z.object({
  run_id: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  idempotency_key: z.string().nullish(),
  connect_user_id: z.string().nullish(),
});

const forwardSchema = z.object({
  run_id: z.string(),
  method: z.string().default("GET"),
  path: z.string(),
  headers: z.record(z.string(), z.string()).nullish(),
  body: z.unknown().nullish(),
  query: z.record(z.string(), z.unknown()).nullish(),
  idempotency_key: z.string().nullish(),
  connect_user_id: z.string().nullish(),
});

function workspaceOf(req: Request): string {
  return resolveRequestWorkspace(req, currentUser(req));
}

/**
 * The JSON routes catch service errors into the numeric `error(status, detail)` body on
 * HTTP 200, like the Python handlers. The path-forward route instead mirrors the upstream
 * response (or a plain `{error}` object) with a real HTTP status.
 */
function numericCatch(res: Response, err: unknown): void {
  const { status, message } = numericFromCaught(err);
  res.json(numericError(status, message));
}

toolsRouter.get("/api/v1/tools", requireAuth("read"), (req, res) => {
  const items = listTools(req.ctx.db, currentUser(req).id, workspaceOf(req));
  res.json(success(items));
});

toolsRouter.post(
  "/api/v1/tools/:ref/invoke",
  requireAuth("write"),
  validateBody(invokeSchema),
  async (req, res) => {
    try {
      const body = req.body as z.infer<typeof invokeSchema>;
      const result = await invokeTool(req.ctx.db, {
        userId: currentUser(req).id,
        workspaceId: workspaceOf(req),
        ref: String(req.params.ref),
        runId: body.run_id,
        args: body.args,
        idempotencyKey: body.idempotency_key,
        connectUserId: body.connect_user_id,
      });
      res.json(success(result));
    } catch (err) {
      numericCatch(res, err);
    }
  },
);

toolsRouter.post(
  "/api/v1/tools/:ref/forward",
  requireAuth("write"),
  validateBody(forwardSchema),
  async (req, res) => {
    try {
      const body = req.body as z.infer<typeof forwardSchema>;
      const result = await forwardTool(req.ctx.db, {
        userId: currentUser(req).id,
        workspaceId: workspaceOf(req),
        ref: String(req.params.ref),
        method: body.method,
        path: body.path,
        headers: body.headers,
        body: body.body,
        query: body.query,
        runId: body.run_id,
        idempotencyKey: body.idempotency_key,
        connectUserId: body.connect_user_id,
      });
      sendForwardResult(res, result);
    } catch (err) {
      numericCatch(res, err);
    }
  },
);

type RouterVerb = "get" | "post" | "put" | "patch" | "delete" | "head" | "options";

const FORWARD_PATH = "/api/v1/tools/:ref/forward/{*path}";

async function forwardPathHandler(req: Request, res: Response): Promise<void> {
  try {
    const rawBody: unknown = req.body;
    const bodyText =
      rawBody === undefined || rawBody === null
        ? ""
        : typeof rawBody === "string"
          ? rawBody
          : JSON.stringify(rawBody);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers[key] = value;
      else if (Array.isArray(value)) headers[key] = value.join(", ");
    }
    const query: Record<string, unknown> = {};
    for (const [key, value] of Object.entries((req.query ?? {}) as Record<string, unknown>)) {
      query[key] = value;
    }
    const pathParam = (req.params as Record<string, string | string[] | undefined>).path;
    const result = await forwardTool(req.ctx.db, {
      userId: currentUser(req).id,
      workspaceId: workspaceOf(req),
      ref: String(req.params.ref),
      method: req.method,
      path: `/${Array.isArray(pathParam) ? pathParam.join("/") : (pathParam ?? "")}`,
      headers,
      body: bodyText,
      query,
      runId: String(req.headers["x-runmesh-run"] ?? ""),
      idempotencyKey:
        typeof req.headers["idempotency-key"] === "string"
          ? req.headers["idempotency-key"]
          : undefined,
      connectUserId:
        typeof req.headers["x-runmesh-user"] === "string" ? req.headers["x-runmesh-user"] : undefined,
    });
    sendForwardResult(res, result);
  } catch (err) {
    const { status, message } = numericFromCaught(err);
    res.status(status).json({ error: message });
  }
}

for (const method of FORWARD_METHODS) {
  toolsRouter[method.toLowerCase() as RouterVerb](FORWARD_PATH, requireAuth("write"), (req, res) => {
    void forwardPathHandler(req, res);
  });
}

function sendForwardResult(res: Response, result: Record<string, unknown>): void {
  if (result.decision === "allow") {
    const status = Number(result.status ?? 200) || 200;
    res.status(status).type("application/json").send(result.body as string);
    return;
  }
  const statusByDecision: Record<string, number> = { deny: 403, consent: 402, escalate: 409 };
  res.status(statusByDecision[String(result.decision)] ?? 403).json({
    error: result.decision,
    reason: result.reason,
    provider: result.provider,
    consent_url: result.consent_url,
  });
}
