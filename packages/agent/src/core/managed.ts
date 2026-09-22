import type { ManagedToolSpec } from "./types.js";

const MANAGED = "__runmeshManaged";

export type ManagedTool = ManagedToolSpec & { __runmeshManaged: true };

/**
 * Declare a managed tool: no local `execute`, because Runmesh runs it and
 * injects the connection credential. A tool with a local `execute` is local —
 * observed and cooperative, never proxied.
 */
export function managedTool(spec: ManagedToolSpec): ManagedTool {
  return { ...spec, __runmeshManaged: true };
}

export function isManagedTool(value: unknown): value is ManagedTool {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[MANAGED] === true
  );
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",");
  return `{${body}}`;
}

/** Deterministic idempotency key so retries never double-execute a call. */
export function invokeKey(runId: string, name: string, args: unknown): string {
  const raw = `${runId}:${name}:${stableStringify(args)}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  }
  return `idem_${hash.toString(16)}`;
}
