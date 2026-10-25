import { Router } from "express";
import { z } from "zod";
import { config } from "../../core/config.js";
import { success } from "../../core/http/responses.js";
import { currentUser, requireAuth } from "../../core/middleware/auth.js";
import { validateBody } from "../../core/middleware/validate.js";
import { resolveRequestWorkspace } from "../workspace/index.js";
import { listWorkspaceConnections } from "./sessions.js";
import { createConnectSession, resendConnectOtp, verifyConnectOtp } from "./sessions.js";
import { listAuditStream } from "./audit-stream.js";

export const connectSessionsRouter = Router();

const otpVerifySchema = z.object({
  challenge_id: z.string(),
  code: z.string(),
});

const otpResendSchema = z.object({
  challenge_id: z.string(),
});

const sessionCreateSchema = z.object({
  mode: z.string(),
  redirect_uri: z.string(),
  external_user_id: z.string(),
  connect_user_id: z.string().nullish(),
  provider: z.string().nullish(),
  scopes: z.array(z.string()).default([]),
  email: z.string().nullish(),
});

function workspaceOf(req: Parameters<typeof resolveRequestWorkspace>[0]): string {
  return resolveRequestWorkspace(req, currentUser(req));
}

connectSessionsRouter.post(
  "/api/v1/connect/otp/verify",
  requireAuth("write"),
  validateBody(otpVerifySchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof otpVerifySchema>;
      const result = await verifyConnectOtp(
        req.ctx.db,
        body.challenge_id,
        body.code,
        currentUser(req).id,
      );
      res.json(success(result, "User verified"));
    } catch (err) {
      next(err);
    }
  },
);

connectSessionsRouter.post(
  "/api/v1/connect/otp/resend",
  requireAuth("write"),
  validateBody(otpResendSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof otpResendSchema>;
      const result = await resendConnectOtp(req.ctx.db, body.challenge_id, currentUser(req).id);
      res.json(success(result, "Verification code resent"));
    } catch (err) {
      next(err);
    }
  },
);

connectSessionsRouter.post(
  "/api/v1/connect/sessions",
  requireAuth("write"),
  validateBody(sessionCreateSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof sessionCreateSchema>;
      const session = await createConnectSession(
        req.ctx.db,
        {
          mode: body.mode,
          redirectUri: body.redirect_uri,
          externalUserId: body.external_user_id,
          connectUserId: body.connect_user_id,
          provider: body.provider,
          scopes: body.scopes,
          email: body.email,
        },
        currentUser(req).id,
        config.publicUrl,
        workspaceOf(req),
      );
      res.json(success(session, "Connect session created"));
    } catch (err) {
      next(err);
    }
  },
);

connectSessionsRouter.get("/api/v1/connect/audit", requireAuth("read"), (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const result = listAuditStream(req.ctx.db, workspaceOf(req), {
    eventType: query.event_type,
    connectUserId: query.connect_user_id,
    search: query.search,
    limit: query.limit === undefined ? 50 : Number(query.limit),
    offset: query.offset === undefined ? 0 : Number(query.offset),
  });
  res.json(
    success(result.items, undefined, {
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    }),
  );
});

connectSessionsRouter.get("/api/v1/connections", requireAuth("read"), (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const result = listWorkspaceConnections(req.ctx.db, workspaceOf(req), {
    provider: query.provider,
    status: query.status,
    page: query.page === undefined ? 1 : Number(query.page),
    limit: query.limit === undefined ? 50 : Number(query.limit),
  });
  res.json(
    success(result.items, undefined, {
      total: result.total,
      page: result.page,
      limit: result.limit,
      pages: result.limit ? Math.ceil(result.total / result.limit) : 0,
    }),
  );
});
