import type { Express } from "express";
import { systemRouter } from "./modules/system/routes.js";

/**
 * Registration order mirrors runmesh-main/src/entry.py: FastAPI matched routers in the order
 * they were included, and Express matches in mount order, so the list is not alphabetical.
 */
export function registerRoutes(app: Express): void {
  app.use(systemRouter);
}
