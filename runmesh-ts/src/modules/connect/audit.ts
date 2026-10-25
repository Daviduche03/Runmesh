/**
 * Audit ledger.
 *
 * Every access decision, grant transition and policy outcome lands in `connect_audit_events`.
 * Rows are append-only: there is no update or delete path, by design.
 */
import { and, desc, eq, gte, like, or, sql } from "drizzle-orm";
import type { Db } from "../../core/db/client.js";
import { connectAuditEvents } from "../../core/db/schema.js";

export const AUDIT_EVENT = {
  APP_CREATED: "connect.app.created",
  SESSION_CREATED: "connect.session.created",
  CONNECTION_CREATED: "connect.connection.created",
  GRANT_CREATED: "connect.grant.created",
  GRANT_APPROVED: "connect.grant.approved",
  GRANT_DENIED: "connect.grant.denied",
  GRANT_REVOKED: "connect.grant.revoked",
  TOKEN_EXCHANGED: "connect.token.exchanged",
  POLICY_UPDATED: "policy.updated",
  POLICY_DECISION: "policy.decision",
  RUN_STARTED: "agent.run.started",
  RUN_FINISHED: "agent.run.finished",
} as const;

export const AUDIT_ACTOR = {
  CONNECT_USER: "connect_user",
  DEVELOPER: "developer",
  SYSTEM: "system",
  APP: "app",
} as const;

export const AUDIT_RESOURCE = {
  CONNECT_APP: "connect_app",
  CONNECT_SESSION: "connect_session",
  CONNECT_CONNECTION: "connect_connection",
  CONNECT_GRANT: "connect_grant",
  CONNECT_TOKEN: "connect_token",
  CONNECT_POLICY: "connect_policy",
  AGENT_RUN: "agent_run",
} as const;

export type AuditEventType = (typeof AUDIT_EVENT)[keyof typeof AUDIT_EVENT];
export type AuditActorType = (typeof AUDIT_ACTOR)[keyof typeof AUDIT_ACTOR];
export type AuditResourceType = (typeof AUDIT_RESOURCE)[keyof typeof AUDIT_RESOURCE];

export interface AuditEventInput {
  eventType: AuditEventType | string;
  actorType: AuditActorType | string;
  actorId?: string | null;
  connectUserId?: string | null;
  connectAppId?: string | null;
  resourceType?: AuditResourceType | string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  agentId?: string | null;
  taskId?: string | null;
  workflowRunId?: string | null;
  approvalRequired?: boolean;
  denialReason?: string | null;
  tokenIssuedAt?: string | null;
  tokenExpiresAt?: string | null;
  result?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  requestId?: string | null;
  workspaceId?: string | null;
}

export function recordAuditEvent(db: Db, input: AuditEventInput): string {
  const id = crypto.randomUUID();

  db.insert(connectAuditEvents)
    .values({
      id,
      eventType: input.eventType,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      connectUserId: input.connectUserId ?? null,
      connectAppId: input.connectAppId ?? null,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      metadata: JSON.stringify(input.metadata ?? {}),
      createdAt: new Date().toISOString(),
      agentId: input.agentId ?? null,
      taskId: input.taskId ?? null,
      workflowRunId: input.workflowRunId ?? null,
      approvalRequired: input.approvalRequired ? 1 : 0,
      denialReason: input.denialReason ?? null,
      tokenIssuedAt: input.tokenIssuedAt ?? null,
      tokenExpiresAt: input.tokenExpiresAt ?? null,
      result: input.result ?? "success",
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      requestId: input.requestId ?? null,
      workspaceId: input.workspaceId ?? null,
    })
    .run();

  return id;
}

export interface AuditListOptions {
  eventType?: string | null;
  connectUserId?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

/** Workspace-scoped, newest first, optionally filtered. */
export function listAuditEvents(
  db: Db,
  workspaceId: string,
  options: AuditListOptions = {},
): Record<string, unknown>[] {
  const clauses = [eq(connectAuditEvents.workspaceId, workspaceId)];
  if (options.eventType) clauses.push(eq(connectAuditEvents.eventType, options.eventType));
  if (options.connectUserId) {
    clauses.push(eq(connectAuditEvents.connectUserId, options.connectUserId));
  }
  if (options.search) {
    const pattern = `%${options.search}%`;
    const match = or(
      like(connectAuditEvents.resourceId, pattern),
      like(connectAuditEvents.actorId, pattern),
      like(connectAuditEvents.denialReason, pattern),
      like(connectAuditEvents.metadata, pattern),
    );
    if (match) clauses.push(match);
  }

  return db
    .select()
    .from(connectAuditEvents)
    .where(and(...clauses))
    .orderBy(desc(connectAuditEvents.createdAt))
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0)
    .all()
    .map((row) => ({
      id: row.id,
      event_type: row.eventType,
      actor_type: row.actorType,
      actor_id: row.actorId,
      connect_user_id: row.connectUserId,
      connect_app_id: row.connectAppId,
      resource_type: row.resourceType,
      resource_id: row.resourceId,
      metadata: parseJsonObject(row.metadata),
      created_at: row.createdAt,
      agent_id: row.agentId,
      task_id: row.taskId,
      workflow_run_id: row.workflowRunId,
      approval_required: Boolean(row.approvalRequired),
      denial_reason: row.denialReason,
      token_issued_at: row.tokenIssuedAt,
      token_expires_at: row.tokenExpiresAt,
      result: row.result,
      error_code: row.errorCode,
      error_message: row.errorMessage,
      request_id: row.requestId,
      workspace_id: row.workspaceId,
    }));
}

export function countAuditEvents(
  db: Db,
  workspaceId: string,
  options: AuditListOptions = {},
): number {
  const clauses = [eq(connectAuditEvents.workspaceId, workspaceId)];
  if (options.eventType) clauses.push(eq(connectAuditEvents.eventType, options.eventType));
  if (options.connectUserId) {
    clauses.push(eq(connectAuditEvents.connectUserId, options.connectUserId));
  }
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(connectAuditEvents)
    .where(and(...clauses))
    .get();
  return Number(row?.count ?? 0);
}

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Providers the control plane knows about; each is a coarse action identity at issuance. */
export const CONNECT_PROVIDER_IDS = ["google", "slack", "meta", "intercom"] as const;
