import { Router } from "express";
import { z } from "zod";
import { success } from "../../core/http/responses.js";
import { currentUser, requireJwt } from "../../core/middleware/auth.js";
import { validateBody } from "../../core/middleware/validate.js";
import { resolveRequestWorkspace } from "../workspace/index.js";
import {
  capabilityMatrix,
  coverageGaps,
  createRule,
  deleteRule,
  evaluateRequest,
  listRules,
  reorderRules,
  updateRule,
} from "./service.js";
import type { CreateRuleInput, UpdateRuleInput } from "./service.js";

export const policiesRouter = Router();

const conditionSchema = z.object({
  field: z.string().default("action"),
  operator: z.string().default("is"),
  value: z.string().default(""),
});

const createRuleSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  conditions: z.array(conditionSchema).default([]),
  action: z.string().default("escalate"),
  scope: z.string().default("all scopes"),
  mode: z.string().default("log-only"),
  caps: z.record(z.string(), z.unknown()).default({}),
  reversibility: z.string().default("reversible"),
  enabled: z.boolean().default(false),
});

const updateRuleSchema = z.object({
  name: z.string().nullish(),
  description: z.string().nullish(),
  enabled: z.boolean().nullish(),
  conditions: z.array(conditionSchema).nullish(),
  action: z.string().nullish(),
  scope: z.string().nullish(),
  mode: z.string().nullish(),
  caps: z.record(z.string(), z.unknown()).nullish(),
  reversibility: z.string().nullish(),
});

const reorderSchema = z.object({
  ids: z.array(z.string()).default([]),
});

const evaluateSchema = z.object({
  agent: z.string().default(""),
  action: z.string().default(""),
  resource: z.string().default(""),
  user: z.string().default(""),
  amount: z.string().default("0"),
});

policiesRouter.get("/api/v1/policies/rules", requireJwt(), (req, res) => {
  const workspaceId = resolveRequestWorkspace(req, currentUser(req));
  const rules = listRules(req.ctx.db, workspaceId);
  res.json(success(rules, undefined, { total: rules.length }));
});

policiesRouter.post(
  "/api/v1/policies/rules",
  requireJwt(),
  validateBody(createRuleSchema),
  (req, res) => {
    const workspaceId = resolveRequestWorkspace(req, currentUser(req));
    const result = createRule(
      req.ctx.db,
      currentUser(req).id,
      workspaceId,
      req.body as CreateRuleInput,
    );
    res.json(success(result.data, result.message));
  },
);

policiesRouter.patch(
  "/api/v1/policies/rules/:rule_id",
  requireJwt(),
  validateBody(updateRuleSchema),
  (req, res) => {
    const workspaceId = resolveRequestWorkspace(req, currentUser(req));
    const result = updateRule(
      req.ctx.db,
      currentUser(req).id,
      workspaceId,
      String(req.params.rule_id),
      req.body as UpdateRuleInput,
    );
    res.json(success(result.data, result.message));
  },
);

policiesRouter.delete("/api/v1/policies/rules/:rule_id", requireJwt(), (req, res) => {
  const workspaceId = resolveRequestWorkspace(req, currentUser(req));
  const result = deleteRule(
    req.ctx.db,
    currentUser(req).id,
    workspaceId,
    String(req.params.rule_id),
  );
  res.json(success(result.data, result.message));
});

policiesRouter.post(
  "/api/v1/policies/rules/reorder",
  requireJwt(),
  validateBody(reorderSchema),
  (req, res) => {
    const workspaceId = resolveRequestWorkspace(req, currentUser(req));
    const result = reorderRules(
      req.ctx.db,
      currentUser(req).id,
      workspaceId,
      (req.body as { ids: string[] }).ids,
    );
    res.json(success(result.data, result.message));
  },
);

policiesRouter.post(
  "/api/v1/policies/evaluate",
  requireJwt(),
  validateBody(evaluateSchema),
  (req, res) => {
    const workspaceId = resolveRequestWorkspace(req, currentUser(req));
    res.json(
      success(
        evaluateRequest(
          req.ctx.db,
          workspaceId,
          req.body as z.infer<typeof evaluateSchema>,
        ),
      ),
    );
  },
);

policiesRouter.get("/api/v1/policies/coverage-gaps", requireJwt(), (req, res) => {
  const workspaceId = resolveRequestWorkspace(req, currentUser(req));
  res.json(success(coverageGaps(req.ctx.db, workspaceId)));
});

policiesRouter.get("/api/v1/policies/capability-matrix", requireJwt(), (req, res) => {
  const workspaceId = resolveRequestWorkspace(req, currentUser(req));
  res.json(success(capabilityMatrix(req.ctx.db, workspaceId)));
});
