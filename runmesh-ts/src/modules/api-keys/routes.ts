import { Router } from "express";
import { z } from "zod";
import { success } from "../../core/http/responses.js";
import { currentUser, requireJwt } from "../../core/middleware/auth.js";
import { validateBody } from "../../core/middleware/validate.js";
import { resolveRequestWorkspace } from "../workspace/index.js";
import { createApiKey, deleteApiKey, listApiKeys } from "./service.js";
import type { CreateApiKeyInput } from "./service.js";

export const apiKeysRouter = Router();

const createApiKeySchema = z.object({
  name: z.string(),
  permissions: z.array(z.string()).default(["read"]),
  expires_at: z.string().nullish(),
});

apiKeysRouter.post(
  "/api-keys",
  requireJwt(),
  validateBody(createApiKeySchema),
  (req, res) => {
    const workspaceId = resolveRequestWorkspace(req, currentUser(req));
    const result = createApiKey(
      req.ctx.db,
      currentUser(req).id,
      workspaceId,
      req.body as CreateApiKeyInput,
    );
    res.json(success(result.data, result.message));
  },
);

apiKeysRouter.get("/api-keys", requireJwt(), (req, res) => {
  const workspaceId = resolveRequestWorkspace(req, currentUser(req));
  const keys = listApiKeys(req.ctx.db, workspaceId);
  res.json(success(keys, undefined, { total: keys.length }));
});

apiKeysRouter.delete("/api-keys/:key_id", requireJwt(), (req, res) => {
  const result = deleteApiKey(req.ctx.db, currentUser(req).id, String(req.params.key_id));
  res.json(success(result.data, result.message));
});
