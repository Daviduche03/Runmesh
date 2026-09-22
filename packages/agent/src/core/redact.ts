/** Client-side safety before send. Mirrors the backend's server-side
 *  redaction; both layers apply so a secret never rests on a skipped hop. */

const SECRET_KEY_PATTERN =
  /(api[_-]?key|secret|token|password|passwd|authorization|bearer|private[_-]?key|client[_-]?secret)/i;

const MAX_DEPTH = 5;
const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";

/** Max serialized JSON chars per payload. Matches the backend cap. */
export const JSON_FIELD_MAX = 8192;

export function redactSecretValues(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return TRUNCATED;
  if (Array.isArray(value)) return value.map((item) => redactSecretValues(item, depth + 1));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] =
        typeof val === "string" && SECRET_KEY_PATTERN.test(key)
          ? REDACTED
          : redactSecretValues(val, depth + 1);
    }
    return out;
  }
  return value;
}

/** Serialize with an 8KB cap. Returns the payload and whether it was cut. */
export function cappedJson(value: unknown): { json: string; truncated: boolean } {
  const raw = JSON.stringify(value ?? {});
  if (raw.length > JSON_FIELD_MAX) return { json: raw.slice(0, JSON_FIELD_MAX), truncated: true };
  return { json: raw, truncated: false };
}
