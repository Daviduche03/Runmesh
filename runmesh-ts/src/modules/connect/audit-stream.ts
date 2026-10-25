/**
 * The unified audit stream: the `connect_audit_events` ledger merged with agent telemetry
 * (`tool.call`, `tool.result`, `error` rows live in `agent_events`), newest-first across both
 * sources, then re-sorted ascending for display.
 *
 * A run lifecycle event chains to its run, and the run carries the thread; call-time policy
 * decisions chain through the decision's run. Events with no thread (mint-time decisions,
 * admin changes) stay honestly unchained.
 */
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import type { Db } from "../../core/db/client.js";
import {
  ConnectAuditEventModel,
  ConnectUserModel,
  TaskModel,
  WorkflowRunModel,
} from "../../core/db/orm.js";
import { agentEvents, agentRuns, agents, policyDecisions, tools } from "../../core/db/schema.js";
import { count } from "drizzle-orm";
import { parseJsonObject } from "../../core/types/helpers.js";

export const MERGED_KINDS = new Set(["tool.call", "tool.result", "error"]);
const AGENT_EVENT_KINDS = ["tool.call", "tool.result", "error", "policy.decision"];

const INTERACTIVE_EVENTS = new Set(["connect.grant.approved", "connect.grant.denied"]);

function eventUiType(eventType: string): string {
  if (eventType === "connect.grant.approved" || eventType === "connect.grant.denied") return "approval";
  if (eventType.startsWith("connect.grant.")) return "grant";
  if (eventType.startsWith("connect.token.")) return "token";
  if (eventType.startsWith("connect.session.") || eventType.startsWith("connect.connection.")) return "consent";
  if (eventType.startsWith("agent.run.")) return "agent";
  if (eventType.startsWith("policy.")) return "policy";
  return "system";
}

function eventOutcome(eventType: string, result: string | null, errorCode: string | null): string {
  if (eventType.endsWith(".denied") || (result ?? "success") === "denied") return "denied";
  if ((result ?? "success") !== "success" || errorCode) return "failed";
  return "success";
}

function metadataDict(value: unknown): Record<string, unknown> {
  return parseJsonObject(value, {});
}

export interface AuditStreamFilter {
  eventType?: string | null;
  connectUserId?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export function listAuditStream(
  db: Db,
  workspaceId: string,
  filter: AuditStreamFilter = {},
): { items: Record<string, unknown>[]; total: number; limit: number; offset: number } {
  const limit = Math.max(1, Math.min(Number(filter.limit ?? 50), 200));
  const offset = Math.max(0, Number(filter.offset ?? 0));
  // Fetch the top (offset + limit) of each source and slice the union: any item in the
  // union's top N is within the top N of its own source.
  const need = offset + limit;

  const wantsBase = !filter.eventType || !MERGED_KINDS.has(filter.eventType);
  const wantsAgent = !filter.eventType || MERGED_KINDS.has(filter.eventType);

  let baseRows: ReturnType<ConnectAuditEventModel["listAll"]>["rows"] = [];
  let baseTotal = 0;
  if (wantsBase) {
    const result = new ConnectAuditEventModel(db).listAll(workspaceId, {
      eventType: filter.eventType,
      connectUserId: filter.connectUserId,
      search: filter.search,
      limit: need,
      offset: 0,
    });
    baseRows = result.rows;
    baseTotal = result.total;
  }

  let agentEventRows: Array<typeof agentEvents.$inferSelect> = [];
  let agentTotal = 0;
  if (wantsAgent) {
    const conditions = [eq(agentEvents.workspaceId, workspaceId)];
    if (filter.eventType && MERGED_KINDS.has(filter.eventType)) {
      conditions.push(eq(agentEvents.kind, filter.eventType));
    } else {
      conditions.push(inArray(agentEvents.kind, AGENT_EVENT_KINDS));
    }
    if (filter.connectUserId) {
      conditions.push(
        sql`${agentEvents.runId} IN (SELECT id FROM agent_runs WHERE workspace_id = ${workspaceId} AND connect_user_id = ${filter.connectUserId})`,
      );
    }
    if (filter.search) {
      conditions.push(like(agentEvents.name, `%${filter.search}%`));
    }
    const where = and(...conditions);
    const totalRow = db.select({ value: count() }).from(agentEvents).where(where).get();
    agentTotal = Number(totalRow?.value ?? 0);
    agentEventRows = db
      .select()
      .from(agentEvents)
      .where(where)
      .orderBy(desc(agentEvents.createdAt))
      .limit(need)
      .all();
  }

  const userModel = new ConnectUserModel(db);
  const taskModel = new TaskModel(db);
  const runModel = new WorkflowRunModel(db);

  const userLabels = new Map<string, string>();
  for (const row of baseRows) {
    if (row.connectUserId && !userLabels.has(row.connectUserId)) {
      const user = userModel.findById(row.connectUserId);
      if (user?.primaryEmail) userLabels.set(row.connectUserId, user.primaryEmail);
    }
  }

  const agentNameById = new Map<string, string>();
  const readAgentName = (agentId: string): string => {
    const cached = agentNameById.get(agentId);
    if (cached !== undefined) return cached;
    const row =
      db.select().from(agents).where(eq(agents.id, agentId)).limit(1).get() ?? null;
    const name = row?.name || agentId;
    agentNameById.set(agentId, name);
    return name;
  };
  for (const row of baseRows) {
    if (row.agentId && !agentNameById.has(row.agentId)) readAgentName(row.agentId);
  }

  const threadByTrace = new Map<string, string | null>();
  for (const row of baseRows) {
    if (row.taskId && !threadByTrace.has(row.taskId)) {
      threadByTrace.set(row.taskId, taskModel.findById(row.taskId)?.threadId ?? null);
    }
    if (row.workflowRunId && !threadByTrace.has(row.workflowRunId)) {
      threadByTrace.set(row.workflowRunId, runModel.findById(row.workflowRunId)?.threadId ?? null);
    }
  }

  const agentRunThreads = new Map<string, string | null>();
  const readAgentRun = (runId: string): (typeof agentRuns.$inferSelect) | null =>
    db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.workspaceId, workspaceId)))
      .limit(1)
      .get() ?? null;
  for (const row of baseRows) {
    if (row.resourceType === "agent_run" && row.resourceId && !agentRunThreads.has(row.resourceId)) {
      agentRunThreads.set(row.resourceId, readAgentRun(row.resourceId)?.threadId ?? null);
    }
  }

  // Call-time policy decisions chain through the decision's run.
  const decisionRuns = new Map<string, string>();
  const decisionReasons = new Map<string, string>();
  const decisionIds = new Set<string>();
  for (const row of baseRows) {
    if (row.eventType === "policy.decision") {
      const decisionId = metadataDict(row.metadata).decision_id;
      if (typeof decisionId === "string" && decisionId) decisionIds.add(decisionId);
    }
  }
  if (decisionIds.size > 0) {
    for (const decision of db
      .select()
      .from(policyDecisions)
      .where(inArray(policyDecisions.id, [...decisionIds]))
      .all()) {
      if (decision.runId) {
        decisionRuns.set(decision.id, decision.runId);
        if (!agentRunThreads.has(decision.runId)) {
          agentRunThreads.set(decision.runId, readAgentRun(decision.runId)?.threadId ?? null);
        }
      }
      if (decision.reason) decisionReasons.set(decision.id, decision.reason);
    }
  }
  const decisionThreads = new Map<string, string>();
  for (const row of baseRows) {
    if (row.eventType === "policy.decision") {
      const decisionId = metadataDict(row.metadata).decision_id;
      const runId = typeof decisionId === "string" ? decisionRuns.get(decisionId) : undefined;
      const thread = runId ? agentRunThreads.get(runId) : undefined;
      if (runId && thread) decisionThreads.set(row.id, thread);
    }
  }

  const items: Record<string, unknown>[] = [];
  for (const row of baseRows) {
    const actorType = row.actorType;
    let uiActorType: string;
    let actor: string;
    if (row.agentId) {
      uiActorType = "agent";
      actor = agentNameById.get(row.agentId) ?? row.agentId.slice(0, 8);
    } else if (actorType === "system") {
      uiActorType = "system";
      actor = "system";
    } else if (row.connectUserId && userLabels.has(row.connectUserId)) {
      uiActorType = "operator";
      actor = userLabels.get(row.connectUserId)!;
    } else {
      uiActorType = "operator";
      actor = (row.actorId ?? "").slice(0, 8) || "—";
    }
    const onBehalfOf =
      row.connectUserId && userLabels.has(row.connectUserId)
        ? userLabels.get(row.connectUserId)
        : "—";
    let traceId: string | null = row.taskId ?? row.workflowRunId ?? null;
    let threadId: string | null = traceId ? (threadByTrace.get(traceId) ?? null) : null;
    if (traceId === null && row.resourceType === "agent_run" && row.resourceId && agentRunThreads.has(row.resourceId)) {
      traceId = row.resourceId;
      threadId = agentRunThreads.get(row.resourceId) ?? null;
    }
    const meta = { ...metadataDict(row.metadata) };
    let denialReason: string | null = row.denialReason;
    if (row.eventType === "policy.decision") {
      const decisionId = meta.decision_id;
      const decisionRun = typeof decisionId === "string" ? decisionRuns.get(decisionId) : undefined;
      if (traceId === null && decisionRun) traceId = decisionRun;
      if (threadId === null && traceId) {
        threadId = agentRunThreads.get(traceId) ?? threadByTrace.get(traceId) ?? null;
      }
      if (denialReason === null && typeof decisionId === "string") {
        const reason = decisionReasons.get(decisionId);
        if (reason) denialReason = reason;
      }
      if (denialReason === null && typeof meta.reason === "string") denialReason = meta.reason;
      if (!meta.reason && denialReason) meta.reason = denialReason;
    }
    if (threadId === null) threadId = decisionThreads.get(row.id) ?? null;
    items.push({
      id: row.id,
      event_type: row.eventType,
      actor,
      actor_type: uiActorType,
      on_behalf_of: onBehalfOf ?? "—",
      mode: INTERACTIVE_EVENTS.has(row.eventType) ? "interactive" : "autonomous",
      type: eventUiType(row.eventType),
      authority: (row.resourceId ?? "").slice(0, 8) || "—",
      outcome: eventOutcome(row.eventType, row.result, row.errorCode),
      trace_id: traceId,
      thread_id: threadId,
      agent_id: row.agentId,
      task_id: row.taskId,
      workflow_run_id: row.workflowRunId,
      result: row.result,
      denial_reason: denialReason,
      metadata: meta,
      duration_ms: null,
      created_at: row.createdAt,
    });
  }

  // Merged agent telemetry: resolve each event's run → agent, thread, and principal.
  const runMeta = new Map<string, typeof agentRuns.$inferSelect>();
  for (const event of agentEventRows) {
    if (event.runId && !runMeta.has(event.runId)) {
      const run = readAgentRun(event.runId);
      if (run) {
        runMeta.set(event.runId, run);
        if (run.threadId && !agentRunThreads.has(event.runId)) {
          agentRunThreads.set(event.runId, run.threadId);
        }
      }
    }
  }
  for (const run of runMeta.values()) {
    if (run.agentId && !agentNameById.has(run.agentId)) readAgentName(run.agentId);
    if (run.connectUserId && !userLabels.has(run.connectUserId)) {
      const user = userModel.findById(run.connectUserId);
      if (user?.primaryEmail) userLabels.set(run.connectUserId, user.primaryEmail);
    }
  }

  // Which provider/action a tool name maps to — the connection the step used.
  const toolMeta = new Map<string, { provider: string; action: string }>();
  const toolNames = [...new Set(agentEventRows.map((event) => event.name).filter(Boolean))];
  if (toolNames.length > 0) {
    for (const tool of db
      .select()
      .from(tools)
      .where(and(eq(tools.workspaceId, workspaceId), inArray(tools.name, toolNames)))
      .all()) {
      toolMeta.set(tool.name, { provider: tool.provider ?? "", action: tool.action ?? "" });
    }
  }

  const agentEventType: Record<string, string> = {
    "tool.call": "tool",
    "tool.result": "tool",
    error: "tool",
    "policy.decision": "policy",
  };
  for (const event of agentEventRows) {
    const run = event.runId ? runMeta.get(event.runId) : undefined;
    const agentId = run?.agentId;
    const actor = agentId ? (agentNameById.get(agentId) ?? agentId.slice(0, 8)) : "agent";
    const connectUser = event.connectUserId ?? run?.connectUserId ?? null;
    const argsRaw = event.args;
    const resultRaw = event.result;
    const parsedResult = metadataDict(typeof resultRaw === "string" ? safeJsonParse(resultRaw) : resultRaw);
    let outcome = event.kind === "error" ? "failed" : "success";
    if (event.kind === "policy.decision") {
      const decision = parsedResult.decision ?? parsedResult.outcome;
      outcome = decision === "deny" ? "denied" : "success";
    }
    const stepMeta: Record<string, unknown> = {
      kind: event.kind,
      name: event.name,
      seq: event.seq,
      args: metadataDict(typeof argsRaw === "string" ? safeJsonParse(argsRaw) : argsRaw),
      result: parsedResult,
    };
    const toolInfo = toolMeta.get(event.name);
    if (toolInfo?.provider) stepMeta.provider = toolInfo.provider;
    if (toolInfo?.action) stepMeta.action = toolInfo.action;
    if (connectUser) {
      stepMeta.connect_user_id = connectUser;
      stepMeta.user_label = userLabels.get(connectUser) ?? "";
    }
    items.push({
      id: event.id,
      event_type: event.kind,
      actor,
      actor_type: "agent",
      on_behalf_of: connectUser ? (userLabels.get(connectUser) ?? "—") : "—",
      mode: "autonomous",
      type: agentEventType[event.kind] ?? "system",
      authority: "—",
      outcome,
      trace_id: event.runId,
      thread_id: run?.threadId ?? null,
      agent_id: agentId ?? null,
      task_id: null,
      workflow_run_id: null,
      result: event.result,
      denial_reason: null,
      metadata: stepMeta,
      duration_ms: event.durationMs,
      created_at: event.createdAt,
    });
  }

  // Page over the merged stream (newest first), then restore the ledger's
  // ascending display order.
  const newestFirst = [...items].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
  );
  const sliced = newestFirst.slice(offset, offset + limit);
  sliced.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  return { items: sliced, total: baseTotal + agentTotal, limit, offset };
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
