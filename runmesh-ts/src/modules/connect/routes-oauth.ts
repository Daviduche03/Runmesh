import { Router } from "express";
import { z } from "zod";
import createError from "http-errors";
import { config } from "../../core/config.js";
import { success } from "../../core/http/responses.js";
import { currentUser, requireAuth } from "../../core/middleware/auth.js";
import { validateBody } from "../../core/middleware/validate.js";
import { resolveRequestWorkspace } from "../workspace/index.js";
import {
  beginConnectAuthorize,
  connectOAuthErrorRedirect,
  exchangeConnectToken,
  getConnectConsentPage,
  handleConnectCallback,
  listConnectProviders,
  submitConnectConsent,
} from "./oauth.js";

export const connectOAuthRouter = Router();

const consentJsonSchema = z.object({
  state: z.string(),
  action: z.string(),
});

const tokenSchema = z
  .object({
    code: z.string().nullish(),
    grant_id: z.string().nullish(),
    task_id: z.string().nullish(),
    workflow_run_id: z.string().nullish(),
    workspace_project_id: z.string().nullish(),
    agent_id: z.string().nullish(),
  })
  .refine((body) => Boolean(body.code) !== Boolean(body.grant_id), {
    message: "provide exactly one of code or grant_id",
  });

connectOAuthRouter.get("/connect/authorize", async (req, res, next) => {
  try {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const result = await beginConnectAuthorize(req.ctx.db, state, config.publicUrl);
    res.redirect(result.url);
  } catch (err) {
    next(err);
  }
});

connectOAuthRouter.get("/connect/callback", async (req, res, next) => {
  try {
    const query = req.query as Record<string, string | undefined>;
    const error = query.error;
    const code = query.code;
    const state = query.state;
    if (error || !code || !state) {
      if (state) {
        res.redirect(connectOAuthErrorRedirect(req.ctx.db, state, error || "oauth_failed"));
        return;
      }
      throw createError(400, "Connect OAuth failed");
    }
    const result = await handleConnectCallback(
      req.ctx.db,
      { code, state, publicBaseUrl: config.publicUrl },
    );
    res.redirect(result.url);
  } catch (err) {
    next(err);
  }
});

connectOAuthRouter.get("/connect/consent", (req, res, next) => {
  try {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    res.type("html").send(getConnectConsentPage(req.ctx.db, state));
  } catch (err) {
    next(err);
  }
});

connectOAuthRouter.post("/connect/consent", async (req, res, next) => {
  try {
    const contentType = String(req.headers["content-type"] ?? "");
    let state: string;
    let action: string;
    if (contentType.includes("application/json")) {
      const parsed = consentJsonSchema.parse(req.body);
      state = parsed.state;
      action = parsed.action;
    } else {
      const body = (req.body ?? {}) as Record<string, unknown>;
      state = String(body.state ?? "");
      action = String(body.action ?? "");
    }
    const result = await submitConnectConsent(req.ctx.db, { state, action });
    res.redirect(result.url);
  } catch (err) {
    next(err);
  }
});

connectOAuthRouter.post(
  "/api/v1/connect/token",
  requireAuth("write"),
  validateBody(tokenSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof tokenSchema>;
      const result = await exchangeConnectToken(
        req.ctx.db,
        {
          code: body.code,
          grantId: body.grant_id,
          taskId: body.task_id,
          workflowRunId: body.workflow_run_id,
          workspaceProjectId: body.workspace_project_id,
          agentId: body.agent_id,
        },
        currentUser(req).id,
        resolveRequestWorkspace(req, currentUser(req)),
      );
      res.json(success(result, "Connect token exchanged"));
    } catch (err) {
      next(err);
    }
  },
);

connectOAuthRouter.get("/api/v1/connect/providers", (_req, res) => {
  res.json(success(listConnectProviders()));
});
