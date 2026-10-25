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

export type ResponseBody<T = unknown> = SuccessBody<T> | ErrorBody;

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
