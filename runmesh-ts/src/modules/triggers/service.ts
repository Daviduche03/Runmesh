/**
 * Agent triggers (schedule + api). A trigger is bound to an agent; when it fires, Runmesh
 * opens an agent run carrying `trigger_id` and delivers a **signed callback** to the
 * agent's endpoint — the caller's app runs the agent, because Runmesh does not. A dispatch
 * that cannot reach the agent is recorded as a `system_error` on the run, never left
 * silently pending.
 */
import createError from "http-errors";
import { config } from "../../core/config.js";
import type { Db } from "../../core/db/client.js";
import {
  agentEvents,
  agentRuns,
  agents,
  triggers,
} from "../../core/db/schema.js";
import { and, desc, eq } from "drizzle-orm";
import { recordAuditEvent } from "../connect/audit.js";
import { AUDIT_EVENT } from "../connect/audit.js";
import { serializeRun } from "../collection/service.js";
import { decryptConnectSecret, encryptConnectSecret } from "../connect/crypto.js";
import { signedDispatch } from "../webhooks/index.js";
import type { FetchLike } from "../webhooks/index.js";
import { cronMatches } from "../workflows/trigger-config.js";
import { validateCronExpression } from "../workflows/trigger-config.js";

export const TRIGGER_TYPES = ["event", "schedule", "api"] as const;
const RUN_INPUT_MAX = 32768;
const JSON_MAX = 8192;

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export type TriggerRow = typeof triggers.$inferSelect;

const newId = (prefix: string): string =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

function parseJsonDict(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export function serializeTrigger(row: TriggerRow): Record<string, unknown> {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    agent_id: row.agentId,
    type: row.type || "api",
    name: row.name || "",
    enabled: Boolean(row.enabled),
    config: parseJsonDict(row.config),
    last_fired_at: row.lastFiredAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function getWorkspaceTrigger(db: Db, workspaceId: string, triggerId: string): TriggerRow {
  const row =
    db
      .select()
      .from(triggers)
      .where(and(eq(triggers.id, triggerId), eq(triggers.workspaceId, workspaceId)))
      .limit(1)
      .get() ?? null;
  if (!row) throw createError(404, "Trigger not found");
  return row;
}

function validateConfig(triggerType: string, cfg: Record<string, unknown>): void {
  if (triggerType !== "schedule") return;
  const cron = String(cfg.cron ?? "").trim();
  const at = String(cfg.at ?? "").trim();
  if (!cron && !at) {
    throw createError(400, "schedule triggers need config.cron or config.at");
  }
  if (cron && !validateCronExpression(cron)) {
    throw createError(400, "invalid cron expression");
  }
}

function applyEndpoint(
  db: Db,
  agentId: string,
  endpoint: string,
  endpointSecret: string | null,
): void {
  const values: { endpointUrl: string | null; endpointSecretEnc?: string | null } = {
    endpointUrl: (endpoint || "").trim() || null,
  };
  if (endpointSecret) {
    values.endpointSecretEnc = encryptConnectSecret(endpointSecret, config.jwtSecret);
  }
  db.update(agents).set(values).where(eq(agents.id, agentId)).run();
}

export interface CreateTriggerInput {
  agentId: string;
  type?: string | null;
  name: string;
  config?: Record<string, unknown> | null;
  endpoint?: string | null;
  endpointSecret?: string | null;
}

export function createTrigger(
  db: Db,
  userId: string,
  workspaceId: string,
  input: CreateTriggerInput,
): { data: Record<string, unknown>; message: string } {
  const triggerType = (input.type || "api").trim().toLowerCase();
  if (!(TRIGGER_TYPES as readonly string[]).includes(triggerType)) {
    throw createError(400, `type must be one of: ${TRIGGER_TYPES.join(", ")}`);
  }
  const name = (input.name || "").trim();
  if (!name) throw createError(400, "name is required");
  const agent =
    db
      .select()
      .from(agents)
      .where(and(eq(agents.id, input.agentId), eq(agents.workspaceId, workspaceId)))
      .limit(1)
      .get() ?? null;
  if (!agent) throw createError(404, "Agent not found");
  const cfg = input.config ?? {};
  validateConfig(triggerType, cfg);
  if (input.endpoint) {
    applyEndpoint(db, input.agentId, input.endpoint, input.endpointSecret ?? null);
  }
  void userId;
  const now = new Date().toISOString();
  const triggerId = newId("trg");
  db.insert(triggers)
    .values({
      id: triggerId,
      workspaceId,
      agentId: input.agentId,
      type: triggerType,
      name,
      enabled: 1,
      config: JSON.stringify(cfg),
      lastFiredAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { data: serializeTrigger(getWorkspaceTrigger(db, workspaceId, triggerId)), message: "Trigger created" };
}

export function listTriggers(
  db: Db,
  workspaceId: string,
  agentId?: string | null,
): { data: Record<string, unknown>[]; total: number } {
  const conditions = [eq(triggers.workspaceId, workspaceId)];
  if (agentId) conditions.push(eq(triggers.agentId, agentId));
  const rows = db
    .select()
    .from(triggers)
    .where(and(...conditions))
    .orderBy(desc(triggers.createdAt))
    .all();
  const items = rows.map(serializeTrigger);
  return { data: items, total: items.length };
}

export function getTrigger(db: Db, workspaceId: string, triggerId: string): Record<string, unknown> {
  return serializeTrigger(getWorkspaceTrigger(db, workspaceId, triggerId));
}

export interface UpdateTriggerInput {
  name?: string | null;
  config?: Record<string, unknown> | null;
  enabled?: boolean | null;
  endpoint?: string | null;
  endpointSecret?: string | null;
}

export function updateTrigger(
  db: Db,
  workspaceId: string,
  triggerId: string,
  input: UpdateTriggerInput,
): { data: Record<string, unknown>; message: string } {
  const row = getWorkspaceTrigger(db, workspaceId, triggerId);
  const updates: Partial<typeof triggers.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (input.name !== undefined && input.name !== null) updates.name = input.name.trim();
  if (input.config !== undefined && input.config !== null) {
    validateConfig(row.type, input.config);
    updates.config = JSON.stringify(input.config);
  }
  if (input.enabled !== undefined && input.enabled !== null) {
    updates.enabled = input.enabled ? 1 : 0;
  }
  if (input.endpoint !== undefined && input.endpoint !== null) {
    applyEndpoint(db, row.agentId, input.endpoint, input.endpointSecret ?? null);
  }
  db.update(triggers).set(updates).where(eq(triggers.id, triggerId)).run();
  return { data: serializeTrigger(getWorkspaceTrigger(db, workspaceId, triggerId)), message: "Trigger updated" };
}

export function deleteTrigger(db: Db, workspaceId: string, triggerId: string): string {
  getWorkspaceTrigger(db, workspaceId, triggerId);
  db.delete(triggers).where(eq(triggers.id, triggerId)).run();
  return triggerId;
}

export function listTriggerRuns(
  db: Db,
  workspaceId: string,
  triggerId: string,
  limit = 50,
): { data: Record<string, unknown>[]; total: number } {
  getWorkspaceTrigger(db, workspaceId, triggerId);
  const rows = db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.triggerId, triggerId), eq(agentRuns.workspaceId, workspaceId)))
    .orderBy(desc(agentRuns.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100))
    .all();
  const items = rows.map((row) => serializeRun(row, 0));
  return { data: items, total: items.length };
}

/** A dispatch that cannot reach the agent fails the run visibly. */
function failRun(db: Db, workspaceId: string, runId: string, message: string): void {
  const existing = db
    .select({ seq: agentEvents.seq })
    .from(agentEvents)
    .where(eq(agentEvents.runId, runId))
    .all();
  const seq = existing.reduce((max, row) => Math.max(max, row.seq ?? 0), 0) + 1;
  const now = new Date().toISOString();
  db.insert(agentEvents)
    .values({
      id: newId("evt"),
      workspaceId,
      runId,
      seq,
      kind: "error",
      name: "system_error",
      args: "{}",
      result: JSON.stringify({ message }).slice(0, JSON_MAX),
      truncated: 0,
      durationMs: null,
      createdAt: now,
      connectUserId: null,
    })
    .run();
  db.update(agentRuns)
    .set({ status: "failed", finishedAt: now, updatedAt: now })
    .where(eq(agentRuns.id, runId))
    .run();
}

interface DispatchInput {
  workspaceId: string;
  trigger: TriggerRow;
  input: unknown;
  origin: string;
  connectUserId?: string | null;
  fetchImpl?: FetchLike;
}

async function dispatchRun(db: Db, input: DispatchInput): Promise<typeof agentRuns.$inferSelect> {
  const { workspaceId, trigger } = input;
  const fetchImpl = input.fetchImpl ?? defaultFetch;
  const agent =
    db.select().from(agents).where(and(eq(agents.id, trigger.agentId), eq(agents.workspaceId, workspaceId))).limit(1).get() ?? null;
  if (!agent) throw createError(404, "Agent not found");

  const now = new Date().toISOString();
  const runId = newId("run");
  const threadId = newId("th");
  const runInput =
    input.input !== undefined && input.input !== null ? JSON.stringify(input.input).slice(0, RUN_INPUT_MAX) : null;
  db.insert(agentRuns)
    .values({
      id: runId,
      workspaceId,
      agentId: agent.id,
      agentVersionId: agent.currentVersionId,
      parentRunId: null,
      threadId,
      connectUserId: input.connectUserId ?? null,
      mode: "live",
      triggerId: trigger.id,
      status: "running",
      input: runInput,
      usage: "{}",
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  recordAuditEvent(db, {
    eventType: AUDIT_EVENT.RUN_STARTED,
    actorType: "system",
    actorId: `trigger:${trigger.id}`,
    connectUserId: input.connectUserId ?? null,
    agentId: agent.id,
    resourceType: "agent_run",
    resourceId: runId,
    workspaceId,
    metadata: { trigger_id: trigger.id, trigger_type: trigger.type, origin: input.origin },
  });
  db.update(triggers).set({ lastFiredAt: now, updatedAt: now }).where(eq(triggers.id, trigger.id)).run();

  const endpoint = agent.endpointUrl;
  if (!endpoint) {
    failRun(db, workspaceId, runId, "No endpoint registered for this agent.");
  } else {
    const secret = decryptConnectSecret(agent.endpointSecretEnc, config.jwtSecret) ?? "";
    const result = await signedDispatch(
      fetchImpl,
      endpoint,
      secret,
      `agent.run.${trigger.type}`,
      {
        run_id: runId,
        trigger_id: trigger.id,
        trigger_type: trigger.type,
        agent_id: agent.id,
        input: input.input ?? null,
        connect_user_id: input.connectUserId ?? null,
      },
      1,
    );
    if (!result.ok) {
      failRun(
        db,
        workspaceId,
        runId,
        `Delivery failed: ${result.status ?? ""} ${result.body ?? ""}`.trim(),
      );
    }
  }

  const row = db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1).get()!;
  return row;
}

export async function fireTrigger(
  db: Db,
  userId: string,
  workspaceId: string,
  triggerId: string,
  input: unknown,
  fetchImpl?: FetchLike,
): Promise<{ data: Record<string, unknown>; message: string }> {
  void userId;
  const row = getWorkspaceTrigger(db, workspaceId, triggerId);
  if (!row.enabled) throw createError(400, "Trigger is not active");
  const run = await dispatchRun(db, {
    workspaceId,
    trigger: row,
    input,
    origin: row.type,
    fetchImpl,
  });
  return { data: serializeRun(run, 0), message: "Trigger fired" };
}

/** Cron entry: fire every enabled schedule trigger whose cron matches now. */
export async function runDueScheduleTriggers(db: Db, fetchImpl?: FetchLike): Promise<number> {
  const now = new Date();
  const rows = db
    .select()
    .from(triggers)
    .where(and(eq(triggers.type, "schedule"), eq(triggers.enabled, 1)))
    .limit(500)
    .all();
  let fired = 0;
  for (const row of rows) {
    const cron = String(parseJsonDict(row.config).cron ?? "").trim();
    if (cron && cronMatches(cron, now)) {
      await dispatchRun(db, { workspaceId: row.workspaceId, trigger: row, input: {}, origin: "schedule", fetchImpl });
      fired += 1;
    }
  }
  return fired;
}
