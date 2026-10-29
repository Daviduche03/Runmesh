import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { ConnectAuditEventModel, ConnectGrantModel } from "../../core/db/orm.js";
import { TaskModel } from "../../core/db/orm.js";
import { parseJsonObject } from "../../core/types/helpers.js";
import { numericError, numericFromCaught, success } from "../../core/http/responses.js";
import { currentUser, requireAuth } from "../../core/middleware/auth.js";
import { validateBody } from "../../core/middleware/validate.js";
import { resolveRequestWorkspace } from "../workspace/index.js";
import {
  approveGrant,
  createGrant,
  denyGrant,
  getCurrentGrant,
  listWorkspaceGrants,
  revokeGrant,
} from "./grants.js";
import { CONNECT_LATENCY, CONNECT_METRICS } from "./common.js";
import { requireMembership } from "../workspace/index.js";

export const connectGrantsRouter = Router();

const grantCreateSchema = z.object({
  connection_id: z.string(),
  agent_id: z.string().nullish(),
  scopes: z.array(z.string()).default([]),
  resource_filters: z.record(z.string(), z.unknown()).nullish(),
  max_uses: z.number().nullish(),
  valid_until: z.string().nullish(),
  environment: z.string().nullish(),
  approval_status: z.string().default("pending_approval"),
});

const grantDecisionSchema = z.object({
  reason: z.string().nullish(),
});

const grantDenySchema = z.object({
  reason: z.string(),
});

const grantRevokeSchema = z.object({
  reason: z.string().nullish(),
});

function workspaceOf(req: Parameters<typeof resolveRequestWorkspace>[0]): string {
  return resolveRequestWorkspace(req, currentUser(req));
}

/**
 * These routes catch service errors and return the numeric-code `error(status, detail)`
 * body on HTTP 200, exactly like the Python handlers — the dashboard reads `ok`, not
 * the HTTP status, here.
 */
function numericCatch(res: Response, err: unknown): void {
  const { status, message } = numericFromCaught(err);
  res.json(numericError(status, message));
}

connectGrantsRouter.get("/api/v1/grants", requireAuth("read"), async (req, res) => {
  try {
    const query = req.query as Record<string, string | undefined>;
    const result = await listWorkspaceGrants(req.ctx.db, workspaceOf(req), {
      status: query.status,
      agentId: query.agent_id,
      provider: query.provider,
      page: query.page === undefined ? 1 : Number(query.page),
      limit: query.limit === undefined ? 50 : Number(query.limit),
    });
    res.json(
      success(result.items, undefined, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        pages: result.pages,
      }),
    );
  } catch (err) {
    numericCatch(res, err);
  }
});

connectGrantsRouter.post(
  "/api/v1/grants",
  requireAuth("write"),
  validateBody(grantCreateSchema),
  (req, res) => {
    try {
      const body = req.body as z.infer<typeof grantCreateSchema>;
      const item = createGrant(
        req.ctx.db,
        {
          connectionId: body.connection_id,
          agentId: body.agent_id,
          scopes: body.scopes,
          resourceFilters: body.resource_filters,
          maxUses: body.max_uses,
          validUntil: body.valid_until,
          environment: body.environment,
          approvalStatus: body.approval_status,
        },
        currentUser(req).id,
        workspaceOf(req),
      );
      res.json(success(item));
    } catch (err) {
      numericCatch(res, err);
    }
  },
);

connectGrantsRouter.post(
  "/api/v1/grants/:grant_id/revoke",
  requireAuth("write"),
  validateBody(grantRevokeSchema),
  (req, res) => {
    try {
      const body = req.body as z.infer<typeof grantRevokeSchema>;
      const item = revokeGrant(
        req.ctx.db,
        String(req.params.grant_id),
        currentUser(req).id,
        body.reason,
      );
      res.json(success(item));
    } catch (err) {
      numericCatch(res, err);
    }
  },
);

connectGrantsRouter.post(
  "/api/v1/connect/grants/:grant_id/approve",
  requireAuth("write"),
  validateBody(grantDecisionSchema),
  (req, res) => {
    try {
      const body = req.body as z.infer<typeof grantDecisionSchema>;
      const result = approveGrant(
        req.ctx.db,
        req.ctx.taskQueue,
        String(req.params.grant_id),
        currentUser(req).id,
        body.reason,
      );
      res.json(success(result));
    } catch (err) {
      numericCatch(res, err);
    }
  },
);

connectGrantsRouter.post(
  "/api/v1/connect/grants/:grant_id/deny",
  requireAuth("write"),
  validateBody(grantDenySchema),
  (req, res) => {
    try {
      const body = req.body as z.infer<typeof grantDenySchema>;
      const result = denyGrant(
        req.ctx.db,
        req.ctx.taskQueue,
        String(req.params.grant_id),
        currentUser(req).id,
        body.reason,
      );
      res.json(success(result));
    } catch (err) {
      numericCatch(res, err);
    }
  },
);

connectGrantsRouter.get("/api/v1/tasks/:task_id/grant_status", requireAuth("read"), (req, res) => {
  const task = new TaskModel(req.ctx.db).findById(String(req.params.task_id));
  if (!task || task.userId !== currentUser(req).id) {
    res.json(numericError(404, "Task not found"));
    return;
  }
  const grantId = task.connectGrantId;
  if (!grantId) {
    res.json(success({ task_id: task.id, grant_id: null, approval_status: null }));
    return;
  }
  const grant = new ConnectGrantModel(req.ctx.db).findById(grantId);
  if (!grant) {
    res.json(success({ task_id: task.id, grant_id: grantId, approval_status: "not_found" }));
    return;
  }
  res.json(
    success({
      task_id: task.id,
      grant_id: grantId,
      approval_status: grant.approvalStatus,
      agent_id: grant.agentId,
    }),
  );
});

connectGrantsRouter.get("/api/v1/connect/metrics", requireAuth("read"), (req, res) => {
  const db = req.ctx.db;
  const userId = currentUser(req).id;
  const workspaceId = workspaceOf(req);
  requireMembership(db, userId, workspaceId);

  const pendingCount = new ConnectGrantModel(db).countByWorkspace(workspaceId, {
    uiStatus: "pending",
  });

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60_1000).toISOString();
  const tokenEvents = new ConnectAuditEventModel(db).findTokenExchanges(workspaceId, {
    limit: 1000,
  });
  const recentTokens = tokenEvents.filter(
    (event) => event.createdAt && event.createdAt >= twentyFourHoursAgo,
  );

  const sorted = [...CONNECT_LATENCY].sort((a, b) => a - b);
  const p50 = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : 0;
  const p99 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.99)]! : 0;
  res.json(
    success({
      pending_approvals: pendingCount,
      token_requests_24h: recentTokens.length,
      metrics: { ...CONNECT_METRICS },
      latency_p50_ms: Math.round(p50 * 10000) / 100,
      latency_p99_ms: Math.round(p99 * 10000) / 100,
    }),
  );
});

connectGrantsRouter.get("/api/v1/connect/tokens", requireAuth("read"), (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const rows = new ConnectAuditEventModel(req.ctx.db).findTokenExchanges(workspaceOf(req), {
    taskId: query.task_id,
    workflowRunId: query.workflow_run_id,
    workspaceProjectId: query.workspace_project_id,
  });
  res.json(
    success(
      rows.map((row) => ({
        id: row.id,
        event_type: row.eventType,
        connect_app_id: row.connectAppId,
        connect_user_id: row.connectUserId,
        resource_id: row.resourceId,
        metadata: parseJsonObject(row.metadata, {}),
        created_at: row.createdAt,
      })),
    ),
  );
});

connectGrantsRouter.get("/api/v1/connect/grants/current", async (req, res, next) => {
  try {
    const token = req.headers["x-connect-grant-token"];
    const raw = Array.isArray(token) ? token[0] : token;
    if (!raw) throw Object.assign(new Error("X-Connect-Grant-Token header required"), { status: 401 });
    res.json(success(await getCurrentGrant(req.ctx.db, raw)));
  } catch (err) {
    next(err);
  }
});
