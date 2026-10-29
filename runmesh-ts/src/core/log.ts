/** Structured logging: one JSON object per line, so log collectors can index the fields. */

type Fields = Record<string, unknown>;

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, val: unknown) => {
      if (typeof val === "bigint") return val.toString();
      if (val instanceof Error) return { name: val.name, message: val.message };
      return val;
    });
  } catch {
    return JSON.stringify({ level: "error", event: "log_serialization_failed" });
  }
}

export function log(level: "info" | "warn" | "error", event: string, fields: Fields = {}): void {
  const line = stringify({ level, event, ts: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}
