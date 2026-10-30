/**
 * Agent hook ingress.
 *
 * The seam every coding agent can reach: a coding agent reports "I am about to run this" and
 * we answer allow / deny / ask. Claude Code posts this natively over HTTP, the OpenCode plugin
 * forwards it, and `runmesh exec` calls the same service.
 *
 * The ingress never decides on its own. It turns a tool call into a server-derived action,
 * asks the workspace's policy, records the decision, and hands back the answer. One evaluator,
 * one ledger, whatever the host.
 */
import createError from "http-errors";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../core/db/client.js";
import { agentRuns } from "../../core/db/schema.js";
import { finishRun, ingestEvents, resolveAgent, startRun } from "../collection/index.js";
import { decideAction } from "../policies/index.js";
import type { DecideActionResult } from "../policies/index.js";
import { assessTool } from "./bash.js";
import type { ToolAssessment } from "./bash.js";

export const HOOK_EVENTS = ["tool.before", "tool.after", "session.start", "session.end"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface HookInput {
  source: string;
  event: HookEvent;
  sessionId: string;
  agentLabel?: string;
  tool?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  durationMs?: number;
  cwd?: string;
}

export interface HookResult {
  run_id: string;
  thread_id: string;
  agent_id: string;
  assessment?: ToolAssessment;
  decision?: DecideActionResult;
}

const SOURCE_MAX = 64;
const SESSION_MAX = 128;
const AGENT_LABEL_MAX = 128;
const TOOL_MAX = 128;
const EXTERNAL_KEY_MAX = 128;

const CONTENT_FIELDS = ["content", "newString", "oldString", "patch", "text"];
const CONTENT_TOOLS = new Set(["edit", "write", "multiedit", "notebookedit", "applypatch", "patch"]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * One thread per agent session, so every hook lands on the same run and the audit trail
 * chains: agent → action → decision → result.
 */
function threadFor(workspaceId: string, source: string, sessionId: string): string {
  return `th_hook_${sha256(`${workspaceId}:${source}:${sessionId}`).slice(0, 24)}`;
}

function ensureAgent(
  db: Db,
  userId: string,
  workspaceId: string,
  source: string,
  agentLabel: string,
): string {
  const externalKey = `hook:${source}:${agentLabel}`.slice(0, EXTERNAL_KEY_MAX);
  const resolved = resolveAgent(db, userId, workspaceId, {
    externalKey,
    framework: source,
    name: agentLabel,
  });
  return String(resolved.data["id"]);
}

function findOpenRun(
  db: Db,
  workspaceId: string,
  agentId: string,
  threadId: string,
): string | null {
  const row =
    db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.workspaceId, workspaceId),
          eq(agentRuns.agentId, agentId),
          eq(agentRuns.threadId, threadId),
          eq(agentRuns.status, "running"),
        ),
      )
      .orderBy(desc(agentRuns.startedAt))
      .limit(1)
      .get() ?? null;
  return row?.id ?? null;
}

function ensureRun(
  db: Db,
  userId: string,
  workspaceId: string,
  agentId: string,
  threadId: string,
  source: string,
  sessionId: string,
): string {
  const open = findOpenRun(db, workspaceId, agentId, threadId);
  if (open !== null) return open;
  const created = startRun(db, userId, workspaceId, {
    agentId,
    threadId,
    input: `${source} session ${sessionId}`,
  });
  return String(created.data["id"]);
}

/**
 * File bodies are the one thing we do not store. Recording the length and a hash keeps the
 * receipt useful without turning the audit ledger into a copy of the repository.
 */
function compactToolInput(tool: string, input: unknown): unknown {
  if (!CONTENT_TOOLS.has(tool.trim().toLowerCase())) return input;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return input;

  const fields = input as Record<string, unknown>;
  const compact: Record<string, unknown> = {};
  const path = fields["file_path"] ?? fields["filePath"] ?? fields["path"];
  if (typeof path === "string") compact["file_path"] = path;
  for (const key of CONTENT_FIELDS) {
    const value = fields[key];
    if (typeof value !== "string") continue;
    compact[`${key}_chars`] = value.length;
    compact[`${key}_sha256`] = sha256(value).slice(0, 16);
  }
  return Object.keys(compact).length > 0 ? compact : {};
}

function requireTool(input: HookInput): string {
  const tool = (input.tool ?? "").trim();
  if (!tool) throw createError(400, "tool is required for tool events");
  if (tool.length > TOOL_MAX) throw createError(400, "tool is too long (max 128 characters)");
  return tool;
}

export interface SessionRun {
  runId: string;
  threadId: string;
  agentId: string;
}

/**
 * One run per (workspace, source, session). Shared by the hook ingress and the MCP server,
 * so every transport lands on the same run and the audit trail chains.
 */
export function ensureSessionRun(
  db: Db,
  userId: string,
  workspaceId: string,
  source: string,
  sessionId: string,
  agentLabel = "default",
): SessionRun {
  const cleanSource = source.trim() || "unknown";
  const cleanSession = sessionId.trim() || `ephem-${randomUUID().slice(0, 8)}`;
  const label = agentLabel.trim() || "default";
  const agentId = ensureAgent(db, userId, workspaceId, cleanSource, label);
  const threadId = threadFor(workspaceId, cleanSource, cleanSession);
  const runId = ensureRun(db, userId, workspaceId, agentId, threadId, cleanSource, cleanSession);
  return { runId, threadId, agentId };
}

export function handleHook(
  db: Db,
  userId: string,
  workspaceId: string,
  input: HookInput,
): HookResult {
  const source = (input.source ?? "").trim();
  if (!source) throw createError(400, "source is required");
  if (source.length > SOURCE_MAX) {
    throw createError(400, "source is too long (max 64 characters)");
  }

  const sessionId = (input.sessionId ?? "").trim();
  if (!sessionId) throw createError(400, "session_id is required");
  if (sessionId.length > SESSION_MAX) {
    throw createError(400, "session_id is too long (max 128 characters)");
  }

  const agentLabel = (input.agentLabel ?? "").trim() || "default";
  if (agentLabel.length > AGENT_LABEL_MAX) {
    throw createError(400, "agent is too long (max 128 characters)");
  }

  const agentId = ensureAgent(db, userId, workspaceId, source, agentLabel);
  const threadId = threadFor(workspaceId, source, sessionId);
  const runId = ensureRun(db, userId, workspaceId, agentId, threadId, source, sessionId);

  if (input.event === "session.end") {
    finishRun(db, userId, workspaceId, runId, { status: "completed" });
    return { run_id: runId, thread_id: threadId, agent_id: agentId };
  }

  if (input.event === "session.start") {
    return { run_id: runId, thread_id: threadId, agent_id: agentId };
  }

  const tool = requireTool(input);

  if (input.event === "tool.after") {
    const result: Record<string, unknown> = {};
    if (input.output !== undefined) result["output"] = input.output;
    if (input.error !== undefined) result["error"] = input.error;

    ingestEvents(db, userId, workspaceId, [
      {
        runId,
        kind: "tool.result",
        name: tool,
        result,
        durationMs: input.durationMs ?? null,
      },
    ]);

    return { run_id: runId, thread_id: threadId, agent_id: agentId };
  }

  const assessment = assessTool(tool, input.input);

  const decision = decideAction(db, workspaceId, {
    action: assessment.action,
    resource: assessment.resource,
    agentId,
    agentLabel,
    userLabel: userId,
    runId,
    source: "tool-call",
  });

  const args: Record<string, unknown> = {
    input: compactToolInput(tool, input.input),
    assessment: {
      action: assessment.action,
      resource: assessment.resource,
      suspicion: assessment.suspicion,
      signals: assessment.signals,
      reason: assessment.reason,
    },
    decision: decision.decision,
  };
  if (input.cwd !== undefined) args["cwd"] = input.cwd;

  ingestEvents(db, userId, workspaceId, [{ runId, kind: "tool.call", name: tool, args }]);

  return { run_id: runId, thread_id: threadId, agent_id: agentId, assessment, decision };
}
