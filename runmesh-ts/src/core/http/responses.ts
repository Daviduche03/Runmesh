/**
 * The one response envelope every endpoint returns. Do not hand-roll JSON at route level —
 * the frontend depends on `{ ok, data }` / `{ ok, error }`.
 */

export interface SuccessBody<T = unknown> {
  ok: true;
  data: T;
  message?: string;
  meta?: Record<string, unknown>;
}

export interface ErrorBody {
  ok: false;
  error: { code: string; message: string };
}

export function success<T>(data: T, message?: string, meta?: Record<string, unknown>): SuccessBody<T> {
  const body: SuccessBody<T> = { ok: true, data };
  if (message !== undefined) body.message = message;
  if (meta !== undefined) body.meta = meta;
  return body;
}

export function error(code: string, message: string): ErrorBody {
  return { ok: false, error: { code, message } };
}

const STATUS_CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "validation_error",
  429: "too_many_requests",
  500: "internal_error",
};

export function errorFromStatus(statusCode: number, message: string): ErrorBody {
  return error(STATUS_CODES[statusCode] ?? "error", message);
}

/**
 * Numeric-code error body. The Python connect/tools routes catch their own HTTPExceptions
 * and return `error(status, detail)` — a *number* code on an HTTP 200 — so these endpoints
 * keep that shape instead of the middleware's string-code envelope.
 */
export interface NumericErrorBody {
  ok: false;
  error: { code: number; message: string };
}

export function numericError(statusCode: number, message: string): NumericErrorBody {
  return { ok: false, error: { code: statusCode, message } };
}

/** Status/message out of a caught http-errors error for the numeric-error routes. */
export function numericFromCaught(err: unknown): { status: number; message: string } {
  if (err instanceof Error) {
    const status = (err as unknown as { status?: unknown }).status;
    if (typeof status === "number") {
      return { status, message: err.message || "Request failed" };
    }
    return { status: 500, message: err.message || "Request failed" };
  }
  return { status: 500, message: "Request failed" };
}
