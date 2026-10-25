/**
 * Workflow trigger configuration: schedule (cron or one-shot `scheduled_at`) and webhook
 * (`queue` / `webhook`) triggers, plus the trigger node read from a stored graph.
 *
 * Secrets are stripped from anything returned to the API; validation happens at write time so
 * the sweep can evaluate stored configs without throwing on legacy rows.
 */
import createError from "http-errors";

export const WEBHOOK_TRIGGER_TYPES = new Set(["queue", "webhook"]);

export type TriggerConfig = Record<string, unknown>;

export function parseTriggerConfig(workflow: {
  triggerConfig?: string | TriggerConfig | null;
}): TriggerConfig {
  const raw = workflow.triggerConfig;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Stored configs may carry secrets internally; the API never sees them. */
export function formatTriggerConfigForApi(config: TriggerConfig): string {
  if (!config || Object.keys(config).length === 0) return "{}";
  const { secret: _secret, secret_hint: _hint, ...rest } = config;
  void _secret;
  void _hint;
  return JSON.stringify(rest);
}

/** Validate a trigger config for `triggerType` and return the canonical stored JSON. */
export function normalizeTriggerConfig(
  triggerType: string,
  triggerConfig?: string | TriggerConfig | null,
): string {
  let config: TriggerConfig = {};
  if (triggerConfig) {
    try {
      const parsed =
        typeof triggerConfig === "string" ? JSON.parse(triggerConfig) : triggerConfig;
      if (typeof parsed === "object" && parsed !== null) config = { ...parsed };
    } catch {
      throw createError(400, "trigger_config must be valid JSON");
    }
  }

  delete config.secret;
  delete config.secret_hint;

  if (triggerType === "schedule") {
    const cron = String(config.cron ?? "").trim();
    const scheduledAt = String(config.scheduled_at ?? "").trim();
    if (!cron && !scheduledAt) {
      throw createError(
        400,
        "Schedule workflows require trigger_config.cron or trigger_config.scheduled_at",
      );
    }
    if (cron && !validateCronExpression(cron)) {
      throw createError(400, "Invalid cron expression in trigger_config");
    }
    if (scheduledAt && !parseScheduledAt(scheduledAt)) {
      throw createError(400, "Invalid scheduled_at in trigger_config");
    }
  }

  return JSON.stringify(config);
}

export function parseScheduledAt(value: string): Date | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const millis = Date.parse(raw);
  return Number.isNaN(millis) ? null : new Date(millis);
}

/** One-shot schedules fire once their time passes while the workflow is still a draft. */
export function isWorkflowScheduleDue(
  workflow: { status?: string | null; triggerConfig?: string | TriggerConfig | null },
  now: Date = new Date(),
): boolean {
  const config = parseTriggerConfig(workflow);
  const scheduledAt = String(config.scheduled_at ?? "").trim();
  if (scheduledAt) {
    const at = parseScheduledAt(scheduledAt);
    if (at && at.getTime() <= now.getTime() && (workflow.status ?? "draft").toLowerCase() === "draft") {
      return true;
    }
  }
  const cron = String(config.cron ?? "").trim();
  if (cron && cronMatches(cron, now)) return true;
  return false;
}

const CRON_RANGES: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

export function validateCronExpression(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((part, index) => {
    const [lo, hi] = CRON_RANGES[index]!;
    return cronFieldValid(part, lo, hi);
  });
}

function cronFieldValid(field: string, lo: number, hi: number): boolean {
  if (field === "*") return true;
  for (const rawPiece of field.split(",")) {
    const piece = rawPiece.trim();
    if (!piece) return false;
    if (piece.startsWith("*/")) {
      if (!Number.isInteger(Number(piece.slice(2)))) return false;
      continue;
    }
    if (piece.includes("-")) {
      const [startRaw, endRaw] = piece.split("-", 2);
      const start = Number(startRaw);
      const end = Number(endRaw);
      if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
      if (start < lo || end > hi || start > end) return false;
      continue;
    }
    const value = Number(piece);
    if (!Number.isInteger(value)) return false;
    if (value < lo || value > hi) return false;
  }
  return true;
}

function cronFieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  for (const rawPiece of field.split(",")) {
    const piece = rawPiece.trim();
    if (piece.startsWith("*/")) {
      const step = Number(piece.slice(2));
      if (step > 0 && value % step === 0) return true;
      continue;
    }
    if (piece.includes("-")) {
      const [startRaw, endRaw] = piece.split("-", 2);
      if (Number(startRaw) <= value && value <= Number(endRaw)) return true;
      continue;
    }
    if (Number(piece) === value) return true;
  }
  return false;
}

/** Minute-granularity match in UTC. Weekday uses cron convention (Sunday = 0). */
export function cronMatches(expression: string, at: Date = new Date()): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return (
    cronFieldMatches(parts[0]!, at.getUTCMinutes()) &&
    cronFieldMatches(parts[1]!, at.getUTCHours()) &&
    cronFieldMatches(parts[2]!, at.getUTCDate()) &&
    cronFieldMatches(parts[3]!, at.getUTCMonth() + 1) &&
    cronFieldMatches(parts[4]!, at.getUTCDay())
  );
}

export function isWebhookTrigger(triggerType: string): boolean {
  return WEBHOOK_TRIGGER_TYPES.has(triggerType);
}
