import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import createError from "http-errors";
import { TaskModel } from "../../core/db/orm.js";
import type { TaskRow } from "../../core/db/orm.js";
import { success } from "../../core/http/responses.js";
import { currentUser, requireAuth } from "../../core/middleware/auth.js";
import { validateBody } from "../../core/middleware/validate.js";
import { resolveRequestWorkspace, requireRowAccess } from "../workspace/index.js";
import {
  cancelScheduledTask,
  getScheduledTasks,
  rescheduleTask,
  scheduleTask,
} from "./scheduler.js";
import { createTask, deleteTask, listTasks } from "./service.js";

export const tasksRouter = Router();

const taskPublishSchema = z.object({
  url: z.string().nullish(),
  payload: z.record(z.string(), z.unknown()).default({}),
  payload_template: z.string().nullish(),
  url_template: z.string().nullish(),
  type: z.string().default("task"),
  workflow_id: z.string().nullish(),
  execution_type: z.string().default("queue"),
  scheduled_at: z.string().nullish(),
  max_retries: z.number().default(5),
  idempotency_key: z.string().nullish(),
  signing_secret: z.string().nullish(),
  connect_grant_id: z.string().nullish(),
});

const scheduledTaskSchema = taskPublishSchema.extend({
  scheduled_at: z.string(),
});

const rescheduleSchema = z.object({
  scheduled_at: z.string(),
});

type TaskPublishBody = z.infer<typeof taskPublishSchema>;

function toCreateInput(body: TaskPublishBody) {
  return {
    url: body.url,
    payload: body.payload,
    payloadTemplate: body.payload_template,
    urlTemplate: body.url_template,
    type: body.type,
    workflowId: body.workflow_id,
    executionType: body.execution_type,
    scheduledAt: body.scheduled_at,
    maxRetries: body.max_retries,
    idempotencyKey: body.idempotency_key,
    signingSecret: body.signing_secret,
    connectGrantId: body.connect_grant_id,
  };
}

function toSnakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** The scheduled-task endpoints return full rows, so keys go out snake_case like Python. */
function toWireTask(row: TaskRow): Record<string, unknown> {
  const wire: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    wire[toSnakeKey(key)] = value;
  }
  return wire;
}

function parsePageLimit(req: Request): {
  page: number;
  limit: number;
} {
  const rawPage = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
  const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const page = rawPage === undefined ? 1 : Number(rawPage);
  const limit = rawLimit === undefined ? 50 : Number(rawLimit);
  if (!Number.isInteger(page) || !Number.isInteger(limit)) {
    throw createError(400, "page and limit must be integers");
  }
  if (page < 1) throw createError(400, "page must be at least 1");
  if (limit < 1 || limit > 200) throw createError(400, "limit must be between 1 and 200");
  return { page, limit };
}

function parseFutureIso(value: string): string {
  const millis = Date.parse(value);
  if (Number.isNaN(millis)) {
    throw createError(400, "Invalid scheduled_at format. Use ISO datetime.");
  }
  if (millis <= Date.now()) {
    throw createError(400, "scheduled_at must be in the future");
  }
  return new Date(millis).toISOString();
}

function workspaceOf(req: Request): string {
  return resolveRequestWorkspace(req, currentUser(req));
}

tasksRouter.get("/api/v1/tasks", requireAuth("read"), (req, res) => {
  const { page, limit } = parsePageLimit(req);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const workflowId = typeof req.query.workflow_id === "string" ? req.query.workflow_id : undefined;
  const result = listTasks(
    req.ctx.db,
    currentUser(req).id,
    { status, workflowId, page, limit },
    workspaceOf(req),
  );
  res.json(success(result.items, undefined, { page, limit, total: result.total }));
});

tasksRouter.post(
  "/api/v1/tasks",
  requireAuth("write"),
  validateBody(taskPublishSchema),
  (req, res) => {
    const result = createTask(
      req.ctx.db,
      req.ctx.taskQueue,
      toCreateInput(req.body as TaskPublishBody),
      currentUser(req).id,
      workspaceOf(req),
    );
    res.json(success({ task_id: result.taskId }, result.message));
  },
);

tasksRouter.delete("/api/v1/tasks/:task_id", requireAuth("write"), (req, res) => {
  const id = deleteTask(req.ctx.db, currentUser(req).id, String(req.params.task_id));
  res.json(success({ id }, "Task deleted"));
});

tasksRouter.post(
  "/api/v1/tasks/schedule",
  requireAuth("write"),
  validateBody(scheduledTaskSchema),
  (req, res) => scheduleHandler(req as never, res),
);

tasksRouter.get("/api/v1/tasks/scheduled", requireAuth("read"), (req, res) => {
  const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = getScheduledTasks(req.ctx.db, {
    userId: currentUser(req).id,
    status,
    limit: rawLimit === undefined ? 50 : Number(rawLimit),
    workspaceId: workspaceOf(req),
  });
  res.json(success(rows.map(toWireTask), undefined, { total: rows.length }));
});

function scheduleHandler(
  req: Request & { body: TaskPublishBody & { scheduled_at: string } },
  res: Response,
): void {
  const body = req.body;
  const db = req.ctx.db;
  const userId = currentUser(req).id;
  const workspaceId = workspaceOf(req);

  const idempotencyKey = (body.idempotency_key ?? "").trim();
  if (idempotencyKey) {
    const existing = new TaskModel(db).findByIdempotencyKey(workspaceId, idempotencyKey);
    if (existing) {
      res.json(
        success(
          { task_id: existing.id, scheduled_at: existing.scheduledAt },
          "Task already scheduled",
        ),
      );
      return;
    }
  }

  const scheduledTime = parseFutureIso(body.scheduled_at);
  const taskId = scheduleTask(
    db,
    {
      userId,
      url: body.url ?? "",
      payload: body.payload,
      type: body.type,
      maxRetries: body.max_retries,
      workflowId: body.workflow_id,
      workspaceId,
      payloadTemplate: body.payload_template,
      urlTemplate: body.url_template,
      signingSecret: body.signing_secret,
      idempotencyKey: idempotencyKey || null,
    },
    scheduledTime,
  );
  res.json(success({ task_id: taskId, scheduled_at: body.scheduled_at }, "Task scheduled"));
}

function cancelHandler(req: Request, res: Response): void {
  const db = req.ctx.db;
  const task = new TaskModel(db).findById(String(req.params.task_id));
  requireRowAccess(db, currentUser(req).id, task, { notFoundDetail: "Task not found" });

  const cancelled = cancelScheduledTask(db, String(req.params.task_id));
  if (!cancelled) {
    throw createError(400, "Task cannot be cancelled (may already be executed)");
  }
  res.json(success({ task_id: String(req.params.task_id) }, "Task cancelled"));
}

tasksRouter.post("/api/v1/tasks/:task_id/cancel", requireAuth("write"), (req, res) =>
  cancelHandler(req, res),
);

function rescheduleHandler(
  req: Request & { body: { scheduled_at: string } },
  res: Response,
): void {
  const db = req.ctx.db;
  const taskId = String(req.params.task_id);
  const task = new TaskModel(db).findById(taskId);
  requireRowAccess(db, currentUser(req).id, task, { notFoundDetail: "Task not found" });

  const scheduledTime = parseFutureIso(req.body.scheduled_at);
  const rescheduled = rescheduleTask(db, taskId, scheduledTime);
  if (!rescheduled) {
    throw createError(400, "Task cannot be rescheduled");
  }
  res.json(success({ task_id: taskId, scheduled_at: req.body.scheduled_at }, "Task rescheduled"));
}

tasksRouter.post(
  "/api/v1/tasks/:task_id/reschedule",
  requireAuth("write"),
  validateBody(rescheduleSchema),
  (req, res) => rescheduleHandler(req as never, res),
);

// Legacy aliases. `publish` predates workspaces and resolves the default workspace;
// schedule/cancel/reschedule share the versioned handlers verbatim.
tasksRouter.post(
  "/api/v1/task/publish",
  requireAuth("write"),
  validateBody(taskPublishSchema),
  (req, res) => {
    const result = createTask(
      req.ctx.db,
      req.ctx.taskQueue,
      toCreateInput(req.body as TaskPublishBody),
      currentUser(req).id,
      null,
    );
    res.json(success({ task_id: result.taskId }, result.message));
  },
);

tasksRouter.post(
  "/api/v1/task/schedule",
  requireAuth("write"),
  validateBody(scheduledTaskSchema),
  (req, res) => scheduleHandler(req as never, res),
);

tasksRouter.post("/api/v1/task/:task_id/cancel", requireAuth("write"), (req, res) =>
  cancelHandler(req, res),
);

tasksRouter.post(
  "/api/v1/task/:task_id/reschedule",
  requireAuth("write"),
  validateBody(rescheduleSchema),
  (req, res) => rescheduleHandler(req as never, res),
);
