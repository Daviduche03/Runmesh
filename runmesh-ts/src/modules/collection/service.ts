/**
 * Agent telemetry collection: resolve, runs, ingest.
 *
 * Agents are registered by observation: the wrapper reports a definition (external key
 * and/or fingerprint plus framework, model, prompt, tools) and this module resolves it to
 * a canonical agent, opening a new version when the fingerprint changes. Runs and events
 * record executions. Nothing here enforces; enforcement lands with the execution layer.
 *
 * Safety is load-bearing: payloads are size-capped, secret-shaped values are redacted
 * before storage, and batches are bounded.
 */
import createError from "http-errors";
import { createHash, randomUUID } from "node:crypto";
import type { Db } from "../../core/db/client.js";
import { ConnectUserModel } from "../../core/db/orm.js";
import {
  agentEvents,
  agentRuns,
  agentVersions,
  agents,
  tools,
} from "../../core/db/schema.js";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { recordAuditEvent } from "../connect/audit.js";
import { AUDIT_EVENT } from "../connect/audit.js";
import { redactSecrets } from "../tools/redact.js";
import { resolveWorkspaceId } from "../workspace/index.js";

export const EXTERNAL_KEY_MAX = 128;
export const FINGERPRINT_MAX = 128;
export const FRAMEWORK_MAX = 64;
export const MODEL_MAX = 128;
export const SYSTEM_PROMPT_MAX = 65536;
export const TOOLS_MAX = 200;
export const RUN_INPUT_MAX = 32768;
export const INGEST_BATCH_MAX = 200;
export const JSON_FIELD_MAX = 8192;
export const THREAD_ID_MAX = 64;
export const CONNECT_USER_ID_MAX = 128;

export const EVENT_KINDS = [
  "tool.call",
  "tool.result",
  "model.request",
  "model.response",
  "policy.decision",
  "error",
  "log",
] as const;

export const TOOL_KINDS = ["local", "managed"] as const;
export const TOOL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const TOOL_AUTH_SCHEMES = ["none", "bearer", "api_key", "basic"] as const;
export const TOOL_NAME_MAX = 64;
export const TOOL_URL_MAX = 2048;

export type AgentRow = typeof agents.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;
export type AgentEventRow = typeof agentEvents.$inferSelect;

const newId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

function parseJsonDict(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
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

function parseJsonList(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }
  return [];
}

/** Cap a JSON field at 8KB, reporting whether it was cut. */
function cappedJson(value: unknown): { raw: string; cut: boolean } {
  const raw = JSON.stringify(value ?? {});
  if (raw.length > JSON_FIELD_MAX) return { raw: raw.slice(0, JSON_FIELD_MAX), cut: true };
  return { raw, cut: false };
}

export function toolRef(workspaceId: string, name: string): string {
  const digest = createHash("sha256").update(`${workspaceId}:${name}`, "utf8").digest("hex");
  return `tool_${digest.slice(0, 12)}`;
}

/** Only https, or http on localhost. The forward path resolves against the base host. */
export function safeBaseUrl(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.host) return null;
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol === "http:" && host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    return null;
  }
  return raw;
}

export interface NormalizedTool {
  name: string;
  kind: string;
  provider: string | null;
  action: string;
  method: string;
  url: string | null;
  baseUrl: string | null;
  authScheme: string;
  authHeader: string;
  authFormat: string;
  resourceParam: string | null;
  schemaHash: string;
}

export interface ToolWarning {
  tool: string;
  code: string;
  message: string;
}

/**
 * Classify a declared tool. A managed declaration missing its provider or endpoint is
 * demoted to local — but never silently: the warning travels back to the wrapper.
 */
export function normalizeTool(entry: unknown): { tool: NormalizedTool | null; warning: ToolWarning | null } {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { tool: null, warning: { tool: "", code: "invalid_entry", message: "Tool entry is not an object." } };
  }
  const record = entry as Record<string, unknown>;
  const name = String(record.name ?? "").trim();
  if (!name || name.length > TOOL_NAME_MAX) {
    return {
      tool: null,
      warning: { tool: name, code: "invalid_name", message: `Tool name must be 1-${TOOL_NAME_MAX} characters.` },
    };
  }
  let declaredKind = String(record.kind ?? "local").trim().toLowerCase();
  if (!(TOOL_KINDS as readonly string[]).includes(declaredKind)) declaredKind = "local";
  let kind = declaredKind;
  const provider = String(record.provider ?? "").trim().toLowerCase() || null;
  const url = String(record.url ?? "").trim().slice(0, TOOL_URL_MAX) || null;
  let baseUrl = safeBaseUrl(
    typeof record.baseUrl === "string" ? record.baseUrl : typeof record.base_url === "string" ? record.base_url : null,
  );
  if (baseUrl === null && url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol && parsed.host) baseUrl = safeBaseUrl(`${parsed.protocol}//${parsed.host}`);
    } catch {
      baseUrl = null;
    }
  }
  let warning: ToolWarning | null = null;
  if (declaredKind === "managed" && (provider === null || (url === null && baseUrl === null))) {
    const missing: string[] = [];
    if (provider === null) missing.push("provider");
    if (url === null && baseUrl === null) missing.push("url or baseUrl");
    kind = "local";
    warning = {
      tool: name,
      code: "managed_missing_config",
      message: `Declared managed but missing ${missing.join(" and ")}; treated as local.`,
    };
  }
  let method = String(record.method ?? "POST").trim().toUpperCase();
  if (!(TOOL_METHODS as readonly string[]).includes(method)) method = "POST";
  const authRaw = record.authScheme ?? record.auth_scheme ?? (provider ? "bearer" : "none");
  let authScheme = String(authRaw).trim().toLowerCase();
  if (!(TOOL_AUTH_SCHEMES as readonly string[]).includes(authScheme)) authScheme = "none";
  return {
    tool: {
      name,
      kind,
      provider,
      action: String(record.action ?? "").trim() || (provider ? `${provider}.${name}` : name),
      method,
      url,
      baseUrl,
      authScheme,
      authHeader: String(record.authHeader ?? record.auth_header ?? "Authorization").slice(0, 128),
      authFormat: String(record.authFormat ?? record.auth_format ?? "Bearer {token}").slice(0, 256),
      resourceParam: String(record.resourceParam ?? record.resource_param ?? "").trim() || null,
      schemaHash: String(record.schemaHash ?? record.schema_hash ?? "").trim().slice(0, 128),
    },
    warning,
  };
}

/** Upsert the tool registry. Returns `[registered, warnings]`. */
export function registerTools(
  db: Db,
  workspaceId: string,
  agentId: string,
  entries: unknown[],
): { registered: Array<Record<string, unknown>>; warnings: ToolWarning[] } {
  const now = new Date().toISOString();
  const registered: Array<Record<string, unknown>> = [];
  const warnings: ToolWarning[] = [];
  for (const entry of entries) {
    const { tool, warning } = normalizeTool(entry);
    if (warning) warnings.push(warning);
    if (!tool) continue;
    const ref = toolRef(workspaceId, tool.name);
    const existing =
      db.select().from(tools).where(and(eq(tools.id, ref), eq(tools.workspaceId, workspaceId))).limit(1).get() ?? null;
    const values = {
      workspaceId,
      agentId,
      name: tool.name,
      kind: tool.kind,
      provider: tool.provider,
      action: tool.action,
      method: tool.method,
      url: tool.url,
      baseUrl: tool.baseUrl,
      authScheme: tool.authScheme,
      authHeader: tool.authHeader,
      authFormat: tool.authFormat,
      resourceParam: tool.resourceParam,
      schemaHash: tool.schemaHash,
      updatedAt: now,
    };
    if (!existing) {
      db.insert(tools).values({ id: ref, createdAt: now, ...values }).run();
    } else {
      db.update(tools).set(values).where(eq(tools.id, ref)).run();
    }
    registered.push({
      name: tool.name,
      ref,
      kind: tool.kind,
      provider: tool.provider,
      action: tool.action,
      base_url: tool.baseUrl,
    });
  }
  return { registered, warnings };
}

/** Insert an immutable definition version. The agent row must already exist. */
export function createAgentVersion(
  db: Db,
  workspaceId: string,
  agentId: string,
  version: number,
  framework: string | null,
  modelName: string | null,
  systemPrompt: string | null,
  declaredTools: unknown[],
  fingerprint: string | null,
): string {
  const versionId = newId("agv");
  db.insert(agentVersions)
    .values({
      id: versionId,
      workspaceId,
      agentId,
      version,
      framework,
      model: modelName,
      systemPrompt,
      tools: JSON.stringify(declaredTools),
      fingerprint,
      createdAt: new Date().toISOString(),
    })
    .run();
  return versionId;
}

export function serializeCollectedAgent(row: AgentRow): Record<string, unknown> {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    name: row.name || "",
    framework: row.framework,
    external_key: row.externalKey,
    fingerprint: row.fingerprint,
    model: row.model,
    version: row.version ?? 1,
    current_version_id: row.currentVersionId,
    status: row.status || "active",
    parent_agent_id: row.parentAgentId,
    last_seen_at: row.lastSeenAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function serializeAgentVersion(
  row: typeof agentVersions.$inferSelect | null,
): Record<string, unknown> | null {
  if (!row) return null;
  return {
    id: row.id,
    agent_id: row.agentId,
    version: row.version ?? 1,
    framework: row.framework,
    model: row.model,
    system_prompt: row.systemPrompt,
    tools: parseJsonList(row.tools),
    fingerprint: row.fingerprint,
    created_at: row.createdAt,
  };
}

export function serializeRun(row: AgentRunRow, eventCount = 0): Record<string, unknown> {
  return {
    id: row.id,
    agent_id: row.agentId,
    agent_version_id: row.agentVersionId,
    parent_run_id: row.parentRunId,
    thread_id: row.threadId,
    connect_user_id: row.connectUserId,
    mode: row.mode || "live",
    replay_of_run_id: row.replayOfRunId,
    status: row.status || "running",
    event_count: eventCount,
    started_at: row.startedAt,
    finished_at: row.finishedAt,
    created_at: row.createdAt,
  };
}

export function serializeEvent(row: AgentEventRow): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind || "log",
    name: row.name || "",
    args: parseJsonDict(row.args),
    result: parseJsonDict(row.result),
    truncated: Boolean(row.truncated),
    duration_ms: row.durationMs,
    seq: row.seq ?? 0,
    created_at: row.createdAt,
  };
}

export interface ResolveAgentInput {
  externalKey?: string | null;
  fingerprint?: string | null;
  name?: string | null;
  framework?: string | null;
  model?: string | null;
  systemPrompt?: string | null;
  tools?: unknown[] | null;
}

export function resolveAgent(
  db: Db,
  userId: string,
  workspaceId: string | null,
  input: ResolveAgentInput,
): { data: Record<string, unknown>; message: string } {
  const externalKey = (input.externalKey || "").trim() || null;
  if (externalKey !== null && externalKey.length > EXTERNAL_KEY_MAX) {
    throw createError(400, "external_key is too long (max 128 characters)");
  }
  const fingerprint = (input.fingerprint || "").trim() || null;
  if (fingerprint !== null && fingerprint.length > FINGERPRINT_MAX) {
    throw createError(400, "fingerprint is too long (max 128 characters)");
  }
  if (externalKey === null && fingerprint === null) {
    throw createError(400, "external_key or fingerprint is required");
  }

  const framework = (input.framework || "").trim() || null;
  if (framework !== null && framework.length > FRAMEWORK_MAX) {
    throw createError(400, "framework is too long (max 64 characters)");
  }
  const modelName = (input.model || "").trim() || null;
  if (modelName !== null && modelName.length > MODEL_MAX) {
    throw createError(400, "model is too long (max 128 characters)");
  }
  const systemPrompt = input.systemPrompt ?? null;
  if (systemPrompt !== null && systemPrompt.length > SYSTEM_PROMPT_MAX) {
    throw createError(400, "system_prompt is too long (max 65536 characters)");
  }
  const declaredTools = Array.isArray(input.tools) ? input.tools : [];
  if (declaredTools.length > TOOLS_MAX) {
    throw createError(400, "tools is too long (max 200 entries)");
  }
  const providedName = (input.name || "").trim();
  const name = providedName || "Untitled agent";
  if (name.length > 64) {
    throw createError(400, "name is too long (max 64 characters)");
  }

  const workspace = resolveWorkspaceId(db, userId, workspaceId);

  let row: AgentRow | null = null;
  if (externalKey !== null) {
    row =
      db
        .select()
        .from(agents)
        .where(and(eq(agents.externalKey, externalKey), eq(agents.workspaceId, workspace)))
        .limit(1)
        .get() ?? null;
  }
  if (!row && fingerprint !== null) {
    row =
      db
        .select()
        .from(agents)
        .where(and(eq(agents.fingerprint, fingerprint), eq(agents.workspaceId, workspace)))
        .limit(1)
        .get() ?? null;
  }

  const now = new Date().toISOString();
  if (!row) {
    const agentId = newId("ag");
    db.insert(agents)
      .values({
        id: agentId,
        workspaceId: workspace,
        userId,
        name,
        status: "active",
        framework,
        externalKey,
        fingerprint,
        model: modelName,
        systemPrompt,
        tools: JSON.stringify(declaredTools),
        version: 1,
        currentVersionId: null,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const versionId = createAgentVersion(
      db, workspace, agentId, 1, framework, modelName, systemPrompt, declaredTools, fingerprint,
    );
    db.update(agents).set({ currentVersionId: versionId }).where(eq(agents.id, agentId)).run();
    const created = db.select().from(agents).where(eq(agents.id, agentId)).limit(1).get()!;
    const { registered, warnings } = registerTools(db, workspace, agentId, declaredTools);
    return {
      data: {
        ...serializeCollectedAgent(created),
        is_new: true,
        is_new_version: false,
        tools: registered,
        tool_warnings: warnings,
      },
      message: "Agent registered",
    };
  }

  const isNewVersion = fingerprint !== null && row.fingerprint !== fingerprint;
  const updates: Partial<typeof agents.$inferInsert> = { lastSeenAt: now, updatedAt: now };
  if (providedName) updates.name = providedName;
  if (isNewVersion) {
    const newVersion = (row.version ?? 1) + 1;
    const versionId = createAgentVersion(
      db, workspace, row.id, newVersion, framework, modelName, systemPrompt, declaredTools, fingerprint,
    );
    Object.assign(updates, {
      version: newVersion,
      fingerprint,
      framework,
      model: modelName,
      systemPrompt,
      tools: JSON.stringify(declaredTools),
      currentVersionId: versionId,
    });
  }
  db.update(agents).set(updates).where(eq(agents.id, row.id)).run();
  const updated = db.select().from(agents).where(eq(agents.id, row.id)).limit(1).get()!;
  const { registered, warnings } = registerTools(db, workspace, row.id, declaredTools);
  return {
    data: {
      ...serializeCollectedAgent(updated),
      is_new: false,
      is_new_version: isNewVersion,
      tools: registered,
      tool_warnings: warnings,
    },
    message: "Agent resolved",
  };
}

function getWorkspaceRun(db: Db, workspaceId: string, runId: string): AgentRunRow {
  const row =
    db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.workspaceId, workspaceId)))
      .limit(1)
      .get() ?? null;
  // 404 either way: never confirm whether an id exists elsewhere.
  if (!row) throw createError(404, "Run not found");
  return row;
}

export interface RunStartInput {
  agentId: string;
  parentRunId?: string | null;
  input?: string | null;
  threadId?: string | null;
  connectUserId?: string | null;
}

export function startRun(
  db: Db,
  userId: string,
  workspaceId: string | null,
  input: RunStartInput,
): { data: Record<string, unknown>; message: string } {
  const agentId = (input.agentId || "").trim();
  if (!agentId) throw createError(400, "agent_id is required");
  const workspace = resolveWorkspaceId(db, userId, workspaceId);
  const agent =
    db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspace)))
      .limit(1)
      .get() ?? null;
  if (!agent) throw createError(404, "Agent not found");

  const parentRunId = (input.parentRunId || "").trim() || null;
  const parent = parentRunId ? getWorkspaceRun(db, workspace, parentRunId) : null;

  const explicitThread = (input.threadId || "").trim() || null;
  if (explicitThread !== null && explicitThread.length > THREAD_ID_MAX) {
    throw createError(400, "thread_id is too long (max 64 characters)");
  }
  const threadId = explicitThread ?? parent?.threadId ?? newId("th");

  const runConnectUserId = (input.connectUserId || "").trim() || null;
  if (runConnectUserId !== null && runConnectUserId.length > CONNECT_USER_ID_MAX) {
    throw createError(400, "connect_user_id is too long (max 128 characters)");
  }
  if (runConnectUserId !== null) {
    const principal = new ConnectUserModel(db).findById(runConnectUserId);
    if (!principal) throw createError(404, "Connect user not found");
  }

  const runInput = input.input ?? null;
  if (runInput !== null && runInput.length > RUN_INPUT_MAX) {
    throw createError(400, "input is too long (max 32768 characters)");
  }

  const now = new Date().toISOString();
  const runId = newId("run");
  db.insert(agentRuns)
    .values({
      id: runId,
      workspaceId: workspace,
      agentId,
      agentVersionId: agent.currentVersionId,
      parentRunId,
      threadId,
      connectUserId: runConnectUserId,
      mode: "live",
      status: "running",
      input: runInput,
      usage: "{}",
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const row = db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1).get()!;
  db.update(agents).set({ lastSeenAt: now, updatedAt: now }).where(eq(agents.id, agentId)).run();

  recordAuditEvent(db, {
    eventType: AUDIT_EVENT.RUN_STARTED,
    actorType: "connect_user",
    actorId: userId,
    connectUserId: runConnectUserId,
    agentId,
    resourceType: "agent_run",
    resourceId: runId,
    workspaceId: workspace,
    metadata: { input_present: runInput !== null },
  });
  return {
    data: {
      id: row.id,
      agent_id: row.agentId,
      agent_version_id: row.agentVersionId,
      parent_run_id: row.parentRunId,
      thread_id: row.threadId,
      connect_user_id: row.connectUserId,
      mode: row.mode || "live",
      status: row.status,
      started_at: row.startedAt,
    },
    message: "Run started",
  };
}

export interface RunFinishInput {
  status?: string | null;
  usage?: Record<string, unknown> | null;
}

export function finishRun(
  db: Db,
  userId: string,
  workspaceId: string | null,
  runId: string,
  input: RunFinishInput,
): { data: Record<string, unknown>; message: string } {
  const status = (input.status || "completed").trim();
  if (status !== "completed" && status !== "failed") {
    throw createError(400, "status must be completed or failed");
  }
  const workspace = resolveWorkspaceId(db, userId, workspaceId);
  const row = getWorkspaceRun(db, workspace, runId);
  if (row.finishedAt !== null && row.status !== status) {
    throw createError(409, "Run already finished with a different status");
  }
  const now = new Date().toISOString();
  db.update(agentRuns)
    .set({
      status,
      usage: JSON.stringify(input.usage ?? {}),
      finishedAt: row.finishedAt ?? now,
      updatedAt: now,
    })
    .where(eq(agentRuns.id, runId))
    .run();
  const updated = db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1).get()!;

  recordAuditEvent(db, {
    eventType: AUDIT_EVENT.RUN_FINISHED,
    actorType: "connect_user",
    actorId: userId,
    connectUserId: updated.connectUserId,
    agentId: updated.agentId,
    resourceType: "agent_run",
    resourceId: runId,
    result: status === "completed" ? "success" : "failed",
    workspaceId: workspace,
    metadata: { status },
  });
  return {
    data: { id: updated.id, status: updated.status, finished_at: updated.finishedAt },
    message: "Run finished",
  };
}

/**
 * Open a run that replays an existing one. Lineage only: the caller executes the replay
 * and reports its events back, because the agent's loop lives in the caller's process.
 */
export function startReplayRun(
  db: Db,
  userId: string,
  workspaceId: string | null,
  runId: string,
): { data: Record<string, unknown>; message: string } {
  const workspace = resolveWorkspaceId(db, userId, workspaceId);
  const origin = getWorkspaceRun(db, workspace, runId);

  const now = new Date().toISOString();
  const replayId = newId("run");
  db.insert(agentRuns)
    .values({
      id: replayId,
      workspaceId: workspace,
      agentId: origin.agentId,
      agentVersionId: origin.agentVersionId,
      parentRunId: null,
      threadId: origin.threadId,
      connectUserId: origin.connectUserId,
      mode: "replay",
      replayOfRunId: origin.id,
      status: "running",
      input: origin.input,
      usage: "{}",
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const row = db.select().from(agentRuns).where(eq(agentRuns.id, replayId)).limit(1).get()!;

  recordAuditEvent(db, {
    eventType: AUDIT_EVENT.RUN_STARTED,
    actorType: "connect_user",
    actorId: userId,
    connectUserId: row.connectUserId,
    agentId: row.agentId,
    resourceType: "agent_run",
    resourceId: replayId,
    workspaceId: workspace,
    metadata: { replay_of_run_id: origin.id },
  });
  return { data: serializeRun(row, 0), message: "Replay run started" };
}

export interface IngestEventInput {
  runId: string;
  kind?: string | null;
  name?: string | null;
  args?: unknown;
  result?: unknown;
  durationMs?: number | null;
}

export function ingestEvents(
  db: Db,
  userId: string,
  workspaceId: string | null,
  events: IngestEventInput[],
): { data: Record<string, unknown>; message: string } {
  if (!events || events.length === 0) throw createError(400, "events must not be empty");
  if (events.length > INGEST_BATCH_MAX) {
    throw createError(400, "events batch is too long (max 200)");
  }
  const workspace = resolveWorkspaceId(db, userId, workspaceId);

  const runIds = new Set(events.map((event) => String(event.runId ?? "").trim()));
  if ([...runIds].some((id) => !id)) throw createError(400, "every event needs a run_id");
  for (const event of events) {
    const kind = event.kind ?? "log";
    if (!(EVENT_KINDS as readonly string[]).includes(kind)) {
      throw createError(400, `kind must be one of: ${EVENT_KINDS.join(", ")}`);
    }
    if (event.durationMs !== undefined && event.durationMs !== null && event.durationMs < 0) {
      throw createError(400, "duration_ms must not be negative");
    }
  }

  const runs = new Map<string, AgentRunRow>();
  for (const runId of runIds) {
    runs.set(runId, getWorkspaceRun(db, workspace, runId));
  }

  const now = new Date().toISOString();
  let stored = 0;
  for (const event of events) {
    const runId = String(event.runId).trim();
    const prior =
      db
        .select({ seq: agentEvents.seq })
        .from(agentEvents)
        .where(eq(agentEvents.runId, runId))
        .orderBy(desc(agentEvents.seq))
        .limit(1)
        .get() ?? null;
    const args = cappedJson(redactSecrets(event.args ?? {}));
    const result = cappedJson(redactSecrets(event.result ?? {}));
    db.insert(agentEvents)
      .values({
        id: newId("evt"),
        workspaceId: workspace,
        runId,
        seq: (prior?.seq ?? -1) + 1,
        kind: event.kind ?? "log",
        name: (event.name ?? "").slice(0, 256),
        args: args.raw,
        result: result.raw,
        truncated: args.cut || result.cut ? 1 : 0,
        durationMs: event.durationMs ?? null,
        createdAt: now,
      })
      .run();
    stored += 1;
  }
  for (const agentId of new Set([...runIds].map((runId) => runs.get(runId)!.agentId))) {
    db.update(agents).set({ lastSeenAt: now, updatedAt: now }).where(eq(agents.id, agentId)).run();
  }
  return { data: { ingested: stored }, message: `Ingested ${stored} events` };
}

export function listAgentRuns(
  db: Db,
  userId: string,
  workspaceId: string | null,
  agentId: string,
  limit = 50,
): { data: Record<string, unknown>[]; total: number } {
  const workspace = resolveWorkspaceId(db, userId, workspaceId);
  const agent =
    db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspace)))
      .limit(1)
      .get() ?? null;
  if (!agent) throw createError(404, "Agent not found");
  const rows = db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, agentId), eq(agentRuns.workspaceId, workspace)))
    .orderBy(desc(agentRuns.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100))
    .all();
  const counts = new Map<string, number>();
  if (rows.length > 0) {
    for (const event of db
      .select({ runId: agentEvents.runId })
      .from(agentEvents)
      .where(inArray(agentEvents.runId, rows.map((row) => row.id)))
      .all()) {
      counts.set(event.runId, (counts.get(event.runId) ?? 0) + 1);
    }
  }
  const runs = rows.map((row) => serializeRun(row, counts.get(row.id) ?? 0));
  return { data: runs, total: runs.length };
}

export function getRun(
  db: Db,
  userId: string,
  workspaceId: string | null,
  runId: string,
): Record<string, unknown> {
  const workspace = resolveWorkspaceId(db, userId, workspaceId);
  const row = getWorkspaceRun(db, workspace, runId);
  const events = db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.runId, runId))
    .orderBy(asc(agentEvents.seq))
    .all();
  const data = serializeRun(row, events.length);
  data.usage = parseJsonDict(row.usage);
  data.input = row.input;
  const versionId = row.agentVersionId;
  const versionRow = versionId
    ? (db.select().from(agentVersions).where(eq(agentVersions.id, versionId)).limit(1).get() ?? null)
    : null;
  data.definition = serializeAgentVersion(versionRow);
  data.events = events.map(serializeEvent);
  const childRows = db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.parentRunId, runId), eq(agentRuns.workspaceId, workspace)))
    .orderBy(asc(agentRuns.createdAt))
    .all();
  data.child_runs = childRows.map((child) => {
    const agentRow =
      db.select().from(agents).where(eq(agents.id, child.agentId)).limit(1).get() ?? null;
    return {
      id: child.id,
      agent_id: child.agentId,
      agent_name: agentRow ? agentRow.name || child.agentId : null,
      status: child.status || "running",
      started_at: child.startedAt,
    };
  });
  return data;
}
