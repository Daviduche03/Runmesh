/**
 * Secret scrubbing for stored tool arguments and results. Values under secret-shaped keys
 * are replaced before persistence; anything nested deeper than five levels is dropped rather
 * than stored raw. Used by the tool call ledger and the collection ingest path alike.
 */
const SECRET_KEY_PATTERN =
  /api[-_]?key|secret|token|password|passwd|authorization|bearer|private[-_]?key|client[-_]secret/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[TRUNCATED]";
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] =
        typeof val === "string" && isSecretKey(String(key)) ? "[REDACTED]" : redactSecrets(val, depth + 1);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, depth + 1));
  }
  return value;
}
