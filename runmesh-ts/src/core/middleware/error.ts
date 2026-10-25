import type { ErrorRequestHandler, RequestHandler } from "express";
import { clientMessage, isHttpError } from "../http/errors.js";
import { errorFromStatus } from "../http/responses.js";
import { log } from "../log.js";

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json(errorFromStatus(404, "Not Found"));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  // Malformed JSON is a client validation problem, not a crash.
  const maybeType = (err as { type?: string }).type;
  if (maybeType === "entity.parse.failed") {
    res.status(422).json(errorFromStatus(422, "Invalid JSON body"));
    return;
  }

  const status = isHttpError(err) ? err.status : 500;
  if (status >= 500) {
    log("error", "request_failed", {
      method: req.method,
      path: req.path,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }

  res.status(status).json(errorFromStatus(status, clientMessage(err, status)));
};
