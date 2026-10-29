import { Router } from "express";
import { z } from "zod";
import { success } from "../../core/http/responses.js";
import { currentUser, requireJwt } from "../../core/middleware/auth.js";
import { validateBody } from "../../core/middleware/validate.js";
import {
  acceptWorkspaceInvite,
  linkProject,
  listProjects,
  listUserWorkspaces,
  onboardWorkspace,
  unlinkProject,
} from "./service.js";
import type { OnboardInput } from "./service.js";

export const workspaceRouter = Router();

const onboardSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  slug: z.string().nullish(),
  avatar_url: z.string().nullish(),
  plan: z.string().optional(),
  seats: z.coerce.number().int().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  invites: z
    .array(z.object({ email: z.string().optional(), role: z.string().optional() }))
    .optional(),
});

const projectSchema = z.object({
  prefix: z.string().optional(),
  bucket: z.string().optional(),
  local_path: z.string().optional(),
});

workspaceRouter.post(
  "/api/v1/workspaces/onboard",
  requireJwt(),
  validateBody(onboardSchema),
  (req, res) => {
    const result = onboardWorkspace(
      req.ctx.db,
      currentUser(req).id,
      req.body as OnboardInput,
    );
    res.json(success(result.data, result.message));
  },
);

workspaceRouter.get("/api/v1/workspaces", requireJwt(), (req, res) => {
  const items = listUserWorkspaces(req.ctx.db, currentUser(req).id);
  res.json(success(items, undefined, { total: items.length }));
});

workspaceRouter.post(
  "/api/v1/workspaces/invites/:token/accept",
  requireJwt(),
  (req, res) => {
    const result = acceptWorkspaceInvite(
      req.ctx.db,
      currentUser(req).id,
      String(req.params.token),
    );
    res.json(success(result.data, result.message));
  },
);

workspaceRouter.get("/api/workspace/projects", requireJwt(), (req, res) => {
  const projects = listProjects(req.ctx.db, currentUser(req).id);
  res.json(success(projects, undefined, { total: projects.length }));
});

workspaceRouter.post(
  "/api/workspace/projects",
  requireJwt(),
  validateBody(projectSchema),
  (req, res) => {
    const result = linkProject(req.ctx.db, currentUser(req).id, req.body);
    res.json(success(result.data, result.message));
  },
);

workspaceRouter.delete("/api/workspace/projects/:project_id", requireJwt(), (req, res) => {
  const result = unlinkProject(req.ctx.db, currentUser(req).id, String(req.params.project_id));
  res.json(success(result.data, result.message));
});
