/**
 * Jinja-compatible rendering of task URL / payload templates.
 *
 * Templates see `{ task, payload, now }` plus optional step-chain context (`prev`, `steps`).
 * nunjucks is close enough to Jinja2 syntax for the template subset used here; the only
 * deliberate addition over the Python sandbox is a `tojson` filter, which plain Jinja2 lacks
 * but task templates commonly expect.
 */
import createError from "http-errors";
import nunjucks from "nunjucks";
import type { TaskRow } from "../../core/db/orm.js";

const env = new nunjucks.Environment(null, { autoescape: false });
env.addFilter("tojson", (value: unknown) => JSON.stringify(value));

type RowLike = TaskRow | Record<string, unknown>;

function pick(row: RowLike, camel: string, snake?: string): unknown {
  const record = row as unknown as Record<string, unknown>;
  const direct = record[camel];
  if (direct !== undefined) return direct;
  return snake !== undefined ? record[snake] : undefined;
}

export function validateTemplate(template: string, fieldName: string): void {
  if (!template || !template.trim()) return;
  try {
    // Parse-only: precompile throws on syntax errors without executing the template,
    // like Jinja's `from_string` check in the Python implementation.
    nunjucks.precompileString(template, { name: fieldName });
  } catch (err) {
    throw createError(400, `Invalid ${fieldName} template: ${(err as Error).message}`);
  }
}

export function renderTemplate(template: string, context: Record<string, unknown>): string {
  try {
    return env.renderString(template, context);
  } catch (err) {
    const message = (err as Error).message;
    // nunjucks reports parse failures as SyntaxError; keep the Python error buckets.
    if (err instanceof SyntaxError || /parse|syntax/i.test(message)) {
      throw createError(400, `Template syntax error: ${message}`);
    }
    throw createError(400, `Template render error: ${message}`);
  }
}

/** Stored `response_body` may be JSON text, plain text, or empty — return the parsed value. */
export function parseStoredResponse(raw: unknown): unknown {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

export function buildTaskContext(
  taskRow: RowLike,
  extraContext?: Record<string, unknown>,
): Record<string, unknown> {
  let payload = pick(taskRow, "payload");
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = { raw: payload };
    }
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    payload = { value: payload };
  }

  const context: Record<string, unknown> = {
    task: {
      id: pick(taskRow, "id"),
      type: pick(taskRow, "type"),
      status: pick(taskRow, "status"),
      url: pick(taskRow, "url"),
      execution_type: pick(taskRow, "executionType", "execution_type"),
      workflow_id: pick(taskRow, "workflowId", "workflow_id"),
      retries: pick(taskRow, "retries") ?? 0,
      max_retries: pick(taskRow, "maxRetries", "max_retries") ?? 5,
      step_order: pick(taskRow, "stepOrder", "step_order") ?? 0,
      created_at: pick(taskRow, "createdAt", "created_at"),
      updated_at: pick(taskRow, "updatedAt", "updated_at"),
    },
    payload,
    now: new Date().toISOString(),
  };
  if (extraContext) Object.assign(context, extraContext);
  return context;
}

/** Render the task's URL and payload. Throws 400 when a template is empty or invalid. */
export function resolveTaskRequest(
  taskRow: RowLike,
  extraContext?: Record<string, unknown>,
): [string, unknown] {
  const context = buildTaskContext(taskRow, extraContext);
  const urlTemplate = pick(taskRow, "urlTemplate", "url_template");
  const payloadTemplate = pick(taskRow, "payloadTemplate", "payload_template");

  let url: string;
  if (typeof urlTemplate === "string" && urlTemplate.trim()) {
    url = renderTemplate(urlTemplate, context).trim();
  } else {
    url = String(pick(taskRow, "url") ?? "");
  }
  if (!url) throw createError(400, "Task URL is empty after template render");

  let body: unknown;
  if (typeof payloadTemplate === "string" && payloadTemplate.trim()) {
    const rendered = renderTemplate(payloadTemplate, context).trim();
    try {
      body = JSON.parse(rendered);
    } catch (err) {
      throw createError(400, `payload_template must render valid JSON: ${(err as Error).message}`);
    }
  } else {
    body = context.payload;
  }

  return [url, body];
}

/** Validate templates up front and store the stripped source on the task being built. */
export function applyTaskTemplates(
  taskData: { payloadTemplate?: string | null; urlTemplate?: string | null },
  payloadTemplate?: string | null,
  urlTemplate?: string | null,
): void {
  if (payloadTemplate && payloadTemplate.trim()) {
    validateTemplate(payloadTemplate, "payload_template");
    taskData.payloadTemplate = payloadTemplate.trim();
  }
  if (urlTemplate && urlTemplate.trim()) {
    validateTemplate(urlTemplate, "url_template");
    taskData.urlTemplate = urlTemplate.trim();
  }
}
