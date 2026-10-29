/**
 * Webhook delivery.
 *
 * Every outbound call Runmesh makes (webhook events and task executions alike) is posted with
 * the same HMAC-SHA256 signature headers, so a receiver verifies authenticity with one code
 * path: `X-Runmesh-Signature: t=<unix>,v1=<hex>`, signing `<t>.<body bytes>`.
 *
 * Delivery is at-least-once with capped backoff; exhausted deliveries land in
 * `webhook_dead_letters` where an operator can replay them.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import createError from "http-errors";
import type { Db } from "../../core/db/client.js";
import { WebhookDeadLetterModel, WebhookModel } from "../../core/db/orm.js";
import type {
  WebhookDeadLetterInsert,
  WebhookDeadLetterRow,
  WebhookInsert,
  WebhookRow,
} from "../../core/db/orm.js";
import { webhooks } from "../../core/db/schema.js";
import { log } from "../../core/log.js";
import type { Queue } from "../../core/runtime/queue.js";
import type { TaskRow } from "../../core/db/orm.js";
import { validateOutboundUrl } from "../../core/url-security.js";
import { requireRowAccess } from "../workspace/index.js";

export const WEBHOOK_SECRET_PREFIX = "whsec_";
export const SIGNATURE_HEADER = "X-Runmesh-Signature";
export const TIMESTAMP_HEADER = "X-Runmesh-Timestamp";
export const EVENT_HEADER = "X-Runmesh-Event";
export const ATTEMPT_HEADER = "X-Runmesh-Delivery-Attempt";

export const MAX_WEBHOOK_DELIVERY_ATTEMPTS = 6;
export const WEBHOOK_RETRY_DELAYS = [60, 300, 900, 3600, 14400];
export const DEFAULT_EVENTS = "task.completed,task.failed";

export const VALID_EVENTS = new Set(["task.completed", "task.failed", "task.running"]);

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface DispatchResult {
  ok: boolean;
  status: number | null;
  body: string | null;
}

export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function maskWebhookSecret(secret: string): string {
  if (!secret || secret.length < 12) return `${WEBHOOK_SECRET_PREFIX}••••`;
  return `${secret.slice(0, 7)}••••${secret.slice(-4)}`;
}

export function normalizeEvents(events: string | null | undefined): string[] {
  if (!events || !events.trim()) return DEFAULT_EVENTS.split(",");

  const parsed: string[] = [];
  for (const part of events.split(",")) {
    const name = part.trim().toLowerCase();
    if (!name) continue;
    if (!VALID_EVENTS.has(name)) {
      throw createError(
        400,
        `Invalid event '${name}'. Allowed: ${[...VALID_EVENTS].sort().join(", ")}`,
      );
    }
    if (!parsed.includes(name)) parsed.push(name);
  }

  if (parsed.length === 0) throw createError(400, "At least one event is required");
  return parsed;
}

export function eventsToString(events: string[]): string {
  return events.join(",");
}

export function webhookSubscribesTo(eventsField: string | null, event: string): boolean {
  const subscribed = new Set(
    (eventsField ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
  return subscribed.has(event.toLowerCase());
}

export function validateWebhookUrl(url: string): string {
  // Scheme/host checks plus SSRF blocklist (private/loopback/link-local targets).
  return validateOutboundUrl(url, "Webhook URL");
}

export function retryDelayAfterFailure(failedAttempt: number): number {
  const index = Math.min(Math.max(failedAttempt - 1, 0), WEBHOOK_RETRY_DELAYS.length - 1);
  return WEBHOOK_RETRY_DELAYS[index]!;
}

export function signPayload(secret: string, timestamp: number, body: Buffer | string): string {
  const bodyBytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  return createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), bodyBytes]))
    .digest("hex");
}

export function buildSignatureHeader(timestamp: number, signature: string): string {
  return `t=${timestamp},v1=${signature}`;
}

/** Wire shape of a webhook row; the secret is only included right after mint/rotate. */
export function formatWebhookRow(
  row: WebhookRow,
  includeSecret = false,
): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: row.id,
    name: row.name ?? "",
    url: row.url ?? "",
    events: row.events || DEFAULT_EVENTS,
    status: row.status ?? "active",
    created_at: row.createdAt ?? "",
    updated_at: row.updatedAt ?? "",
  };
  if (includeSecret) {
    item.secret = row.secret;
  } else {
    item.secret_hint = maskWebhookSecret(row.secret);
  }
  return item;
}

export interface CreateWebhookInput {
  name: string;
  url: string;
  events?: string | null;
}

export function createWebhook(
  db: Db,
  input: CreateWebhookInput,
  userId: string,
  workspaceId: string,
): Record<string, unknown> {
  const eventList = normalizeEvents(input.events);
  const now = new Date().toISOString();

  const data: WebhookInsert = {
    id: `wh_${randomUUID().replace(/-/g, "")}`,
    name: input.name.trim(),
    url: validateWebhookUrl(input.url),
    events: eventsToString(eventList),
    status: "active",
    secret: generateWebhookSecret(),
    userId,
    workspaceId,
    createdAt: now,
    updatedAt: now,
  };

  new WebhookModel(db).create(data);
  return formatWebhookRow(data as WebhookRow, true);
}

export function listWebhooks(db: Db, workspaceId: string): Record<string, unknown>[] {
  return new WebhookModel(db).findByWorkspaceId(workspaceId).map((row) => formatWebhookRow(row));
}

export function deleteWebhook(db: Db, userId: string, webhookId: string): string {
  const model = new WebhookModel(db);
  const row = model.findById(webhookId);
  requireRowAccess(db, userId, row, { notFoundDetail: "Webhook not found" });
  model.delete(webhookId);
  return webhookId;
}

export function rotateWebhookSecret(
  db: Db,
  userId: string,
  webhookId: string,
): Record<string, unknown> {
  const model = new WebhookModel(db);
  const row = model.findById(webhookId);
  requireRowAccess(db, userId, row, { notFoundDetail: "Webhook not found" });

  const secret = generateWebhookSecret();
  const now = new Date().toISOString();
  db.update(webhooks).set({ secret, updatedAt: now }).where(eq(webhooks.id, webhookId)).run();

  return formatWebhookRow({ ...row!, secret, updatedAt: now }, true);
}

// ---------------------------------------------------------------------------
// Event envelopes + delivery
// ---------------------------------------------------------------------------

export function buildEventEnvelope(
  event: string,
  task: TaskRow | Record<string, unknown>,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  // `as` through unknown: ORM rows are interfaces without index signatures.
  const t = task as unknown as Record<string, unknown>;
  let payload: unknown = t.payload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = { raw: payload };
    }
  }

  const data: Record<string, unknown> = {
    task_id: t.id,
    url: t.url,
    status: t.status,
    type: t.type,
    execution_type: defined(t.executionType) ?? t.execution_type,
    workflow_id: defined(t.workflowId) ?? t.workflow_id,
    retries: t.retries ?? 0,
    max_retries: defined(t.maxRetries) ?? t.max_retries ?? 5,
    payload,
    created_at: defined(t.createdAt) ?? t.created_at,
    updated_at: defined(t.updatedAt) ?? t.updated_at,
  };
  if (extra) Object.assign(data, extra);

  return {
    id: `evt_${randomUUID().replace(/-/g, "")}`,
    type: event,
    created_at: new Date().toISOString(),
    data,
  };
}

function defined(value: unknown): unknown {
  return value !== undefined ? value : undefined;
}

function pick(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

export function enqueueWebhookDelivery(
  queue: Queue,
  webhookId: string,
  event: string,
  envelope: Record<string, unknown>,
  deliveryAttempt = 1,
  delaySeconds = 0,
): void {
  const message = {
    webhook_id: webhookId,
    event,
    body: envelope,
    delivery_attempt: deliveryAttempt,
  };
  if (delaySeconds > 0) {
    queue.send(message, delaySeconds);
  } else {
    queue.send(message);
  }
}

/**
 * POST a body to `url` with HMAC-SHA256 signature headers.
 *
 * `body` may be an object (JSON-encoded here) or a pre-encoded string/Buffer; the signature is
 * computed over exactly the bytes sent. When `captureBody` is true the third field is the
 * (truncated) response body on success instead of null.
 */
export async function signedDispatch(
  fetchImpl: FetchLike,
  url: string,
  secret: string,
  event: string,
  body: unknown,
  deliveryAttempt: number,
  captureBody = false,
): Promise<DispatchResult> {
  const bodyBytes = Buffer.isBuffer(body)
    ? body
    : typeof body === "string"
      ? Buffer.from(body, "utf8")
      : Buffer.from(JSON.stringify(body), "utf8");

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(secret, timestamp, bodyBytes);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SIGNATURE_HEADER.toLowerCase()]: buildSignatureHeader(timestamp, signature),
        [TIMESTAMP_HEADER.toLowerCase()]: String(timestamp),
        [EVENT_HEADER.toLowerCase()]: event,
        [ATTEMPT_HEADER.toLowerCase()]: String(deliveryAttempt),
        "user-agent": "Runmesh-Webhook/1.0",
      },
      body: bodyBytes,
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    });

    const status = response.status;
    if (captureBody) {
      const bodyOut = await readResponseBody(response);
      if (status >= 400) return { ok: false, status, body: bodyOut || `HTTP ${status}` };
      return { ok: true, status, body: bodyOut };
    }
    if (status >= 400) return { ok: false, status, body: `HTTP ${status}` };
    return { ok: true, status, body: null };
  } catch (err) {
    return { ok: false, status: null, body: err instanceof Error ? err.message : String(err) };
  }
}

/** Truncate to 64KB, matching what a workflow step's `response_body` stores. */
export async function readResponseBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 65536);
  } catch {
    return "";
  }
}

export function deliverWebhook(
  fetchImpl: FetchLike,
  webhook: WebhookRow | Record<string, unknown>,
  event: string,
  envelope: Record<string, unknown>,
  deliveryAttempt: number,
): Promise<DispatchResult> {
  const hook = webhook as unknown as Record<string, unknown>;
  return signedDispatch(
    fetchImpl,
    String(pick(hook, "url") ?? ""),
    String(pick(hook, "secret") ?? ""),
    event,
    envelope,
    deliveryAttempt,
  );
}

export function scheduleWebhookRetry(
  queue: Queue,
  webhookId: string,
  event: string,
  envelope: Record<string, unknown>,
  failedAttempt: number,
): boolean {
  const nextAttempt = failedAttempt + 1;
  if (nextAttempt > MAX_WEBHOOK_DELIVERY_ATTEMPTS) return false;

  enqueueWebhookDelivery(
    queue,
    webhookId,
    event,
    envelope,
    nextAttempt,
    retryDelayAfterFailure(failedAttempt),
  );
  return true;
}

export async function processWebhookQueueMessage(
  db: Db,
  queue: Queue,
  fetchImpl: FetchLike,
  messageBody: Record<string, unknown>,
): Promise<void> {
  const webhookId = messageBody.webhook_id;
  const event = messageBody.event;
  const envelope = messageBody.body;
  const deliveryAttempt = Number(messageBody.delivery_attempt ?? 1);

  if (typeof webhookId !== "string" || typeof event !== "string" || !envelope) return;

  const webhook = new WebhookModel(db).findById(webhookId);
  if (!webhook || webhook.status !== "active") return;
  if (!webhookSubscribesTo(webhook.events, event)) return;

  const result = await deliverWebhook(
    fetchImpl,
    webhook,
    event,
    envelope as Record<string, unknown>,
    deliveryAttempt,
  );
  if (result.ok) return;

  const detail = result.body || "unknown error";
  log("warn", "webhook_delivery_attempt_failed", {
    webhook_id: webhookId,
    attempt: deliveryAttempt,
    max_attempts: MAX_WEBHOOK_DELIVERY_ATTEMPTS,
    webhook_event: event,
    error: detail,
  });

  const scheduled = scheduleWebhookRetry(
    queue,
    webhookId,
    event,
    envelope as Record<string, unknown>,
    deliveryAttempt,
  );
  if (!scheduled) {
    recordDeadLetter(
      db,
      webhookId,
      webhook.userId,
      webhook.workspaceId,
      event,
      envelope as Record<string, unknown>,
      deliveryAttempt,
      result.status,
      detail,
    );
    log("warn", "webhook_retries_exhausted", {
      webhook_id: webhookId,
      webhook_event: event,
      event_id: (envelope as Record<string, unknown>).id,
    });
  }
}

/** Queue one delivery per active webhook subscribed to `event`. Returns how many were queued. */
export function dispatchEvent(
  db: Db,
  queue: Queue,
  userId: string,
  event: string,
  task: TaskRow | Record<string, unknown>,
  deliveryExtra?: Record<string, unknown>,
): number {
  if (!VALID_EVENTS.has(event)) return 0;

  const model = new WebhookModel(db);
  const taskRow = task as unknown as Record<string, unknown>;
  const workspaceId = pick(taskRow, "workspaceId", "workspace_id");
  const subscribed =
    typeof workspaceId === "string" && workspaceId
      ? model.findActiveByWorkspaceId(workspaceId)
      : model.findActiveByUserId(userId);

  let queued = 0;
  for (const webhook of subscribed) {
    if (!webhookSubscribesTo(webhook.events, event)) continue;
    enqueueWebhookDelivery(queue, webhook.id, event, buildEventEnvelope(event, task, deliveryExtra));
    queued += 1;
  }
  return queued;
}

// ---------------------------------------------------------------------------
// Dead letters
// ---------------------------------------------------------------------------

export function recordDeadLetter(
  db: Db,
  webhookId: string,
  userId: string,
  workspaceId: string | null,
  event: string,
  envelope: Record<string, unknown>,
  attempts: number,
  lastStatusCode: number | null,
  lastError: string,
): string {
  const now = new Date().toISOString();
  const data: WebhookDeadLetterInsert = {
    webhookId,
    userId,
    workspaceId,
    event,
    eventId: String(envelope.id ?? ""),
    body: JSON.stringify(envelope),
    lastStatusCode,
    lastError,
    attempts,
    failedAt: now,
    createdAt: now,
  };
  return new WebhookDeadLetterModel(db).create(data);
}

export function formatDeadLetterRow(
  row: WebhookDeadLetterRow,
  webhookName = "",
): Record<string, unknown> {
  let body: unknown;
  try {
    body = JSON.parse(row.body);
  } catch {
    body = { raw: row.body };
  }

  return {
    id: row.id,
    webhook_id: row.webhookId ?? "",
    webhook_name: webhookName,
    event: row.event ?? "",
    event_id: row.eventId ?? "",
    body,
    last_status_code: row.lastStatusCode,
    last_error: row.lastError,
    attempts: row.attempts ?? 0,
    failed_at: row.failedAt ?? "",
    replayed_at: row.replayedAt,
    created_at: row.createdAt ?? "",
  };
}

export function listDeadLetters(
  db: Db,
  workspaceId: string,
  includeReplayed = false,
): Record<string, unknown>[] {
  const rows = new WebhookDeadLetterModel(db).findByWorkspaceId(workspaceId, includeReplayed);
  const webhookModel = new WebhookModel(db);
  const names = new Map<string, string>();

  return rows.map((row) => {
    let name = names.get(row.webhookId);
    if (name === undefined) {
      const webhook = webhookModel.findById(row.webhookId);
      name = webhook?.name ?? "";
      names.set(row.webhookId, name);
    }
    return formatDeadLetterRow(row, name);
  });
}

export function replayDeadLetter(
  db: Db,
  queue: Queue,
  userId: string,
  deadLetterId: string,
): Record<string, unknown> {
  const model = new WebhookDeadLetterModel(db);
  const row = model.findById(deadLetterId);
  requireRowAccess(db, userId, row, { notFoundDetail: "Dead letter not found" });

  if (row!.replayedAt) throw createError(400, "Dead letter already replayed");

  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(row!.body) as Record<string, unknown>;
  } catch {
    throw createError(400, "Dead letter body is invalid");
  }

  enqueueWebhookDelivery(queue, row!.webhookId, row!.event, envelope, 1);
  model.markReplayed(deadLetterId);

  const webhook = new WebhookModel(db).findById(row!.webhookId);
  return formatDeadLetterRow(
    { ...row!, replayedAt: new Date().toISOString() },
    webhook?.name ?? "",
  );
}

export function dismissDeadLetter(
  db: Db,
  userId: string,
  deadLetterId: string,
): string {
  const model = new WebhookDeadLetterModel(db);
  const row = model.findById(deadLetterId);
  requireRowAccess(db, userId, row, { notFoundDetail: "Dead letter not found" });
  model.delete(deadLetterId);
  return deadLetterId;
}
