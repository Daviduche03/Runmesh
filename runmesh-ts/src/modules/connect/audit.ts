/**
 * Audit ledger.
 *
 * Every access decision, grant transition and policy outcome lands in `connect_audit_events`.
 * Rows are append-only: there is no update or delete path, by design.
 */
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
