import createError from "http-errors";

export { createError };

interface StatusCarrier {
  status?: unknown;
  expose?: unknown;
}

export function isHttpError(err: unknown): err is Error & { status: number; expose?: boolean } {
  if (!(err instanceof Error)) return false;
  const carrier = err as unknown as StatusCarrier;
  return typeof carrier.status === "number" && carrier.status >= 400 && carrier.status <= 599;
}

/** Message for a client-visible error. 5xx details stay server-side unless explicitly exposed. */
export function clientMessage(err: unknown, status: number): string {
  if (isHttpError(err)) {
    if (status >= 500 && err.expose !== true) return "Internal server error";
    return err.message || "Request failed";
  }
  return status >= 500 ? "Internal server error" : "Request failed";
}
