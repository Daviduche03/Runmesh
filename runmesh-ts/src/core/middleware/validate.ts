import type { Request, RequestHandler } from "express";
import createError from "http-errors";
import type { ZodType } from "zod";

interface Issue {
  path: PropertyKey[];
  message: string;
}

/** FastAPI-style rendering: `field.sub: message; other: message`. */
function formatIssues(issues: Issue[]): string {
  const parts = issues.map((issue) => {
    const path = issue.path.filter((part) => typeof part !== "symbol").join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return parts.join("; ") || "Validation failed";
}

function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw createError(422, formatIssues(result.error.issues as Issue[]));
  }
  return result.data;
}

/** Replaces `req.body` with the parsed value so handlers see typed input. */
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    try {
      req.body = parseOrThrow(schema, req.body);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Express 5 exposes `req.query` as a getter, so query parsing returns a value instead. */
export function parseQuery<T>(schema: ZodType<T>, req: Request): T {
  return parseOrThrow(schema, req.query);
}

export function parseParams<T>(schema: ZodType<T>, req: Request): T {
  return parseOrThrow(schema, req.params);
}
