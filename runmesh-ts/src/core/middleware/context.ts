import type { RequestHandler } from "express";
import type { AppContext } from "../http/context.js";

export function withContext(ctx: AppContext): RequestHandler {
  return (req, _res, next) => {
    req.ctx = ctx;
    next();
  };
}
