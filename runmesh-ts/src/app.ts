import express from "express";
import type { Express } from "express";
import cors from "cors";
import type { AppContext } from "./core/http/context.js";
import { withContext } from "./core/middleware/context.js";
import { errorHandler, notFound } from "./core/middleware/error.js";
import { registerRoutes } from "./routes.js";

const ALLOWED_ORIGINS = [
  "http://localhost:5174",
  "http://localhost:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:5173",
  "https://runmesh.vercel.app",
];

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(
    cors({
      origin: ALLOWED_ORIGINS,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type", "X-API-Key", "X-Connect-Grant-Token"],
    }),
  );

  app.use(express.json({ limit: "10mb" }));
  // The Connect consent page posts a plain HTML form.
  app.use(express.urlencoded({ extended: true }));
  app.use(withContext(ctx));

  registerRoutes(app);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
