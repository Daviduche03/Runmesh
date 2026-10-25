import type { Express } from "express";
import { agentsRouter } from "./modules/agents/index.js";
import { apiKeysRouter } from "./modules/api-keys/index.js";
import { authRouter } from "./modules/auth/index.js";
import { policiesRouter } from "./modules/policies/index.js";
import { systemRouter } from "./modules/system/routes.js";
import { tasksRouter } from "./modules/tasks/index.js";
import {
  connectGrantsRouter,
  connectOAuthRouter,
  connectSessionsRouter,
} from "./modules/connect/index.js";
import { webhooksRouter } from "./modules/webhooks/index.js";
import { workflowsRouter } from "./modules/workflows/index.js";
import { workspaceRouter } from "./modules/workspace/index.js";

/**
 * Registration order mirrors runmesh-main/src/entry.py: FastAPI matched routers in the order
 * they were included, and Express matches in mount order, so the list is not alphabetical.
 * Mounted so far: system, api keys, agents, policies, workspaces, auth, webhooks,
 * tasks, workflows, connect (grants, sessions, oauth).
 */
export function registerRoutes(app: Express): void {
  app.use(systemRouter);
  app.use(apiKeysRouter);
  app.use(agentsRouter);
  app.use(policiesRouter);
  app.use(workspaceRouter);
  app.use(authRouter);
  app.use(webhooksRouter);
  app.use(tasksRouter);
  app.use(connectGrantsRouter);
  app.use(connectOAuthRouter);
  app.use(connectSessionsRouter);
  app.use(workflowsRouter);
}
