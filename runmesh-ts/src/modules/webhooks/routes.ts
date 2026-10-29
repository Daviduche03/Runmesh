import { Router } from "express";
import { z } from "zod";
import { success } from "../../core/http/responses.js";
import { currentUser, requireJwt } from "../../core/middleware/auth.js";
import { validateBody } from "../../core/middleware/validate.js";
import { resolveRequestWorkspace } from "../workspace/index.js";
import {
  createWebhook,
  deleteWebhook,
  dismissDeadLetter,
  listDeadLetters,
  listWebhooks,
  replayDeadLetter,
  rotateWebhookSecret,
} from "./service.js";

export const webhooksRouter = Router();

const webhookCreateSchema = z.object({
  name: z.string().min(1, "Webhook name is required"),
  url: z.string(),
  events: z.string().optional(),
});

function workspaceOf(req: Parameters<typeof resolveRequestWorkspace>[0]): string {
  return resolveRequestWorkspace(req, currentUser(req));
}

webhooksRouter.get("/api/webhooks", requireJwt(), (req, res) => {
  const items = listWebhooks(req.ctx.db, workspaceOf(req));
  res.json(success(items, undefined, { total: items.length }));
});

webhooksRouter.post("/api/webhooks", requireJwt(), validateBody(webhookCreateSchema), (req, res) => {
  const body = req.body as { name: string; url: string; events?: string };
  const item = createWebhook(req.ctx.db, body, currentUser(req).id, workspaceOf(req));
  res.status(201).json(success(item));
});

webhooksRouter.delete("/api/webhooks/:webhookId", requireJwt(), (req, res) => {
  const deleted = deleteWebhook(req.ctx.db, currentUser(req).id, String(req.params.webhookId));
  res.json(success({ id: deleted, deleted: true }));
});

webhooksRouter.post("/api/webhooks/:webhookId/rotate-secret", requireJwt(), (req, res) => {
  const item = rotateWebhookSecret(req.ctx.db, currentUser(req).id, String(req.params.webhookId));
  res.json(success(item));
});

webhooksRouter.get("/api/webhooks/dead-letters", requireJwt(), (req, res) => {
  const includeReplayed = req.query.include_replayed === "true";
  const items = listDeadLetters(req.ctx.db, workspaceOf(req), includeReplayed);
  res.json(success(items, undefined, { total: items.length }));
});

webhooksRouter.post("/api/webhooks/dead-letters/:deadLetterId/replay", requireJwt(), (req, res) => {
  const item = replayDeadLetter(
    req.ctx.db,
    req.ctx.webhookQueue,
    currentUser(req).id,
    String(req.params.deadLetterId),
  );
  res.json(success(item));
});

webhooksRouter.delete("/api/webhooks/dead-letters/:deadLetterId", requireJwt(), (req, res) => {
  const deleted = dismissDeadLetter(req.ctx.db, currentUser(req).id, String(req.params.deadLetterId));
  res.json(success({ id: deleted, deleted: true }));
});
