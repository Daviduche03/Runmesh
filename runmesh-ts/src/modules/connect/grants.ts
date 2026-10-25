/**
 * Grants: scoped, expiring, revocable permission slips binding an agent to a connection.
 *
 * Issuance runs policy first in full mode — the request names scopes and resources, but the
 * action identity is server-derived from the connection's provider. Approval flips a pending
 * grant live and releases parked tasks; denial fails them. Both transitions are audited.
 */
import createError from "http-errors";
import type { Db } from "../../core/db/client.js";
import { TaskModel } from "../../core/db/orm.js";
import type { ConnectConnectionRow, ConnectGrantRow } from "../../core/db/orm.js";
import { ConnectGrantModel, ConnectUserModel } from "../../core/db/orm.js";
import { agents } from "../../core/db/schema.js";
import { policyDecisions } from "../../core/db/schema.js";
import { and, eq } from "drizzle-orm";
import type { Queue } from "../../core/runtime/queue.js";
import { changeHint, enforceGrantIssuance } from "../policies/service.js";
import { recordAuditEvent } from "./audit.js";
import { requireMembership } from "../workspace/index.js";
import { parseGrantAccessToken } from "./common.js";
import { secondsUntil } from "./common.js";
import { ConnectConnectionModel } from "../../core/db/orm.js";

export const POLICY_APPROVAL_BY_DECISION: Record<string, string> = {
  allow: "approved",
  escalate: "pending_approval",
  consent: "pending_approval",
};

export const GRANT_ENVIRONMENTS = ["dev", "staging", "prod"] as const;
export const GRANT_APPROVAL_STATES = ["pending_approval", "approved"] as const;
export const GRANT_UI_STATUSES = ["pending", "active", "expired", "denied", "revoked"] as const;

export function grantUiStatus(
  grant: Pick<ConnectGrantRow, "status" | "approvalStatus" | "validUntil">,
  now: string,
): string {
  if (grant.status === "revoked") return "revoked";
  if (grant.approvalStatus === "denied") return "denied";
  if (grant.approvalStatus === "pending_approval") return "pending";
  if (grant.validUntil != null && grant.validUntil <= now) return "expired";
  return "active";
}

export function summarizeFilters(resourceFilters: unknown): string | null {
  if (!resourceFilters) return null;
  if (typeof resourceFilters !== "object" || Array.isArray(resourceFilters)) {
    return String(resourceFilters).slice(0, 80);
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(resourceFilters)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const repos = (value as Record<string, unknown>).repos;
      if (Array.isArray(repos) && repos.length > 0) {
        const shown = repos.slice(0, 2).map(String).join(", ");
        const extra = repos.length > 2 ? ` +${repos.length - 2}` : "";
        parts.push(`${key}:${shown}${extra}`);
      } else {
        parts.push(key);
      }
    } else if (Array.isArray(value)) {
      parts.push(`${key}:${value.slice(0, 2).map(String).join(", ")}`);
    } else {
      parts.push(`${key}:${value}`);
    }
  }
  const summary = parts.join(" · ").slice(0, 80);
  return summary || null;
}

export interface SerializedGrant {
  id: string;
  agent_id: string | null;
  connect_user_id: string;
  user: string;
  provider: string | null;
  account_label: string | null;
  scopes: string[];
  resource: string | null;
  resource_filters: Record<string, unknown> | null;
  status: string;
  approval_status: string;
  uses: number;
  max_uses: number | null;
  valid_until: string | null;
  seconds_until_expiration: number | null;
  environment: string | null;
  created_at: string;
}

export function serializeGrant(
  grant: ConnectGrantRow,
  connection: ConnectConnectionRow | null,
  userLabel: string | null,
  now: string,
): SerializedGrant {
  return {
    id: grant.id,
    agent_id: grant.agentId,
    connect_user_id: grant.connectUserId,
    user: userLabel ?? grant.connectUserId.slice(0, 8),
    provider: connection ? connection.provider : null,
    account_label: connection ? connection.providerAccountLabel : null,
    scopes: grant.scopes,
    resource: summarizeFilters(grant.resourceFilters),
    resource_filters: grant.resourceFilters,
    status: grantUiStatus(grant, now),
    approval_status: grant.approvalStatus,
    uses: grant.useCount,
    max_uses: grant.maxUses,
    valid_until: grant.validUntil,
    seconds_until_expiration: secondsUntil(grant.validUntil),
    environment: grant.environment,
    created_at: grant.createdAt,
  };
}

function linkDecisionGrant(db: Db, decisionId: string | null | undefined, grantId: string): void {
  if (!decisionId || !grantId) return;
  db.update(policyDecisions).set({ grantId }).where(eq(policyDecisions.id, decisionId)).run();
}

/**
 * Provision the consent-path grant. Policy runs first in restrictive mode: an explicit
 * enforced deny forbids the connect, everything else leaves today's behavior untouched.
 * The end user's act is the authority here, so policy may forbid but never auto-approve.
 */
export function ensureGrant(
  db: Db,
  input: {
    connectAppId: string | null;
    connectUserId: string;
    connectionId: string;
    scopes: string[];
    workspaceId?: string | null;
  },
): string {
  const grantModel = new ConnectGrantModel(db);
  let decisionId: string | null = null;

  if (input.workspaceId) {
    const connection = new ConnectConnectionModel(db).findById(input.connectionId);
    const provider = connection ? connection.provider : null;
    const connectUser = new ConnectUserModel(db).findById(input.connectUserId);
    const outcome = enforceGrantIssuance(db, {
      workspaceId: input.workspaceId,
      provider,
      scopes: input.scopes,
      connectUserId: input.connectUserId,
      userLabel: connectUser?.primaryEmail ?? "",
      source: "consent",
      restrictive: true,
    });
    decisionId = outcome.decisionId;
    if (outcome.blocks) {
      throw createError(403, `Blocked by policy: ${outcome.reason}`);
    }
  }

  const existing = grantModel.findActive(
    input.connectAppId,
    input.connectUserId,
    input.connectionId,
    input.workspaceId ?? null,
  );
  if (existing) {
    linkDecisionGrant(db, decisionId, existing.id);
    return existing.id;
  }
  const grant = grantModel.create({
    connectAppId: input.connectAppId,
    connectUserId: input.connectUserId,
    connectionId: input.connectionId,
    scopes: input.scopes,
    workspaceId: input.workspaceId ?? null,
  });
  linkDecisionGrant(db, decisionId, grant.id);
  return grant.id;
}

async function enrichGrants(
  db: Db,
  grants: ConnectGrantRow[],
  now: string,
): Promise<SerializedGrant[]> {
  const connectionModel = new ConnectConnectionModel(db);
  const userModel = new ConnectUserModel(db);
  const connections = new Map<string, ConnectConnectionRow>();
  for (const grant of grants) {
    if (!connections.has(grant.connectionId)) {
      const connection = connectionModel.findById(grant.connectionId);
      if (connection) connections.set(grant.connectionId, connection);
    }
  }
  const labels = new Map<string, string>();
  for (const grant of grants) {
    if (!labels.has(grant.connectUserId)) {
      const user = userModel.findById(grant.connectUserId);
      if (user?.primaryEmail) labels.set(grant.connectUserId, user.primaryEmail);
    }
  }
  return grants.map((grant) => {
    const connection = connections.get(grant.connectionId) ?? null;
    const label =
      labels.get(grant.connectUserId) ??
      (connection?.providerAccountLabel || undefined) ??
      null;
    return serializeGrant(grant, connection, label, now);
  });
}

export async function getGrantContext(
  db: Db,
  grantAccessToken: string,
): Promise<{ grant: ConnectGrantRow; connection: ConnectConnectionRow }> {
  const payload = await parseGrantAccessToken(grantAccessToken.trim());
  const grant = new ConnectGrantModel(db).findById(String(payload.grant_id ?? ""));
  if (!grant || grant.status !== "active") {
    throw createError(401, "Grant is not active");
  }
  if (grant.connectAppId !== payload.app_id) {
    throw createError(401, "Grant access token mismatch");
  }
  if (grant.connectUserId !== payload.connect_user_id) {
    throw createError(401, "Grant access token mismatch");
  }
  if (grant.connectionId !== payload.connection_id) {
    throw createError(401, "Grant access token mismatch");
  }
  const connection = new ConnectConnectionModel(db).findById(grant.connectionId);
  if (!connection || connection.status !== "active") {
    throw createError(404, "Connection not found");
  }
  return { grant, connection };
}

export async function getCurrentGrant(
  db: Db,
  grantAccessToken: string,
): Promise<Record<string, unknown>> {
  const { grant, connection } = await getGrantContext(db, grantAccessToken);
  return {
    grant_id: grant.id,
    connect_user_id: grant.connectUserId,
    connection_id: connection.id,
    provider: connection.provider,
    scopes: grant.scopes,
    account_label: connection.providerAccountLabel,
    status: grant.status,
  };
}

export interface GrantListFilter {
  status?: string | null;
  agentId?: string | null;
  provider?: string | null;
  page?: number;
  limit?: number;
}

/** Workspace-wide grant list. No app keying. */
export async function listWorkspaceGrants(
  db: Db,
  workspaceId: string,
  filter: GrantListFilter = {},
): Promise<{ items: SerializedGrant[]; total: number; page: number; limit: number; pages: number }> {
  if (filter.status != null && !(GRANT_UI_STATUSES as readonly string[]).includes(filter.status)) {
    throw createError(400, "status must be pending, active, expired, revoked, or denied");
  }
  const now = new Date().toISOString();
  const page = filter.page ?? 1;
  const limit = filter.limit ?? 50;
  const grantModel = new ConnectGrantModel(db);
  const grants = grantModel.listByWorkspace(workspaceId, {
    uiStatus: filter.status,
    agentId: filter.agentId,
    now,
    limit,
    offset: (page - 1) * limit,
  });
  const total = grantModel.countByWorkspace(workspaceId, {
    uiStatus: filter.status,
    agentId: filter.agentId,
    now,
  });
  let items = await enrichGrants(db, grants, now);
  if (filter.provider) {
    items = items.filter((item) => item.provider === filter.provider);
  }
  return { items, total, page, limit, pages: limit ? Math.ceil(total / limit) : 0 };
}

export interface CreateGrantInput {
  connectionId: string;
  agentId?: string | null;
  scopes?: string[];
  resourceFilters?: Record<string, unknown> | null;
  maxUses?: number | null;
  validUntil?: string | null;
  environment?: string | null;
  approvalStatus?: string | null;
}

/** Mint a grant. Authority stays in grants/policy/audit — never ambient. */
export function createGrant(
  db: Db,
  input: CreateGrantInput,
  userId: string,
  workspaceId: string,
): SerializedGrant {
  requireMembership(db, userId, workspaceId);

  const connectionId = (input.connectionId ?? "").trim();
  const connection = connectionId ? new ConnectConnectionModel(db).findById(connectionId) : null;
  if (!connection) throw createError(404, "Connection not found");

  const agentId = (input.agentId ?? "").trim() || null;
  let agentLabel = "";
  if (agentId) {
    const agent =
      db.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId))).limit(1).get() ?? null;
    if (!agent) throw createError(404, "Agent not found");
    agentLabel = agent.name || agentId;
  }

  const scopes = (input.scopes ?? []).map(String).filter((scope) => scope.trim());
  if (scopes.length === 0) throw createError(400, "At least one scope is required");

  if (input.maxUses !== undefined && input.maxUses !== null && input.maxUses <= 0) {
    throw createError(400, "max_uses must be positive");
  }

  const environment = (input.environment ?? "").trim().toLowerCase() || null;
  if (environment !== null && !(GRANT_ENVIRONMENTS as readonly string[]).includes(environment)) {
    throw createError(400, "Environment must be dev, staging, or prod");
  }

  let approvalStatus = (input.approvalStatus ?? "pending_approval").trim();
  if (!(GRANT_APPROVAL_STATES as readonly string[]).includes(approvalStatus)) {
    throw createError(400, "approval_status must be pending_approval or approved");
  }

  // Policy decides issuance. The action identity is derived server-side from
  // the connection — the request cannot name its own action or self-approve.
  const connectUser = new ConnectUserModel(db).findById(connection.connectUserId);
  const outcome = enforceGrantIssuance(db, {
    workspaceId,
    provider: connection.provider,
    scopes,
    resource: summarizeFilters(input.resourceFilters) ?? "",
    agentId,
    agentLabel,
    connectUserId: connection.connectUserId,
    userLabel: connectUser?.primaryEmail ?? "",
    source: "grant",
    restrictive: false,
  });
  if (outcome.blocks) {
    const hint = changeHint("deny", outcome.rule, "");
    throw createError(403, `Blocked by policy: ${outcome.reason} ${hint}`);
  }
  if (outcome.configured) {
    // Policy governs when it is on; the request cannot override it.
    approvalStatus = POLICY_APPROVAL_BY_DECISION[outcome.decision] ?? approvalStatus;
  }

  const grantModel = new ConnectGrantModel(db);
  const grant = grantModel.create({
    connectAppId: null,
    connectUserId: connection.connectUserId,
    connectionId: connection.id,
    scopes,
    agentId,
    validUntil: (input.validUntil ?? "").trim() || null,
    resourceFilters: input.resourceFilters ?? null,
    maxUses: input.maxUses ?? null,
    environment,
    workspaceId,
    approvalStatus,
  });
  linkDecisionGrant(db, outcome.decisionId, grant.id);
  const now = new Date().toISOString();
  recordAuditEvent(db, {
    eventType: "connect.grant.created",
    actorType: "connect_user",
    actorId: userId,
    connectUserId: connection.connectUserId,
    resourceType: "connect_grant",
    resourceId: grant.id,
    agentId,
    workspaceId,
    metadata: { approval_status: approvalStatus },
  });
  return serializeGrant(
    grant,
    connection,
    connectUser?.primaryEmail ?? connection.providerAccountLabel ?? null,
    now,
  );
}

/** Revoke an active grant. Deny is for pending grants; revoke is for live ones. */
export function revokeGrant(
  db: Db,
  grantId: string,
  userId: string,
  reason?: string | null,
): SerializedGrant {
  const grantModel = new ConnectGrantModel(db);
  const grant = grantModel.findById(grantId);
  if (!grant) throw createError(404, "Grant not found");
  requireMembership(db, userId, grant.workspaceId);

  if (grant.status === "revoked") throw createError(409, "Grant is already revoked");

  grantModel.revoke(grantId);
  recordAuditEvent(db, {
    eventType: "connect.grant.revoked",
    actorType: "connect_user",
    actorId: userId,
    connectUserId: grant.connectUserId,
    resourceType: "connect_grant",
    resourceId: grantId,
    agentId: grant.agentId,
    workspaceId: grant.workspaceId,
    metadata: { reason: reason || "Grant revoked" },
  });
  const now = new Date().toISOString();
  const updated = grantModel.findById(grantId)!;
  const connection = new ConnectConnectionModel(db).findById(updated.connectionId);
  const connectUser = new ConnectUserModel(db).findById(updated.connectUserId);
  return serializeGrant(
    updated,
    connection,
    connectUser?.primaryEmail ?? connection?.providerAccountLabel ?? null,
    now,
  );
}

function grantNotFoundDetail(grantId: string): string {
  return JSON.stringify({
    error: "grant_not_found",
    message: `No grant found with id: ${grantId}`,
    grant_id: grantId,
  });
}

/** Approve a pending grant; parked tasks are released to the queue. */
export function approveGrant(
  db: Db,
  taskQueue: Queue | null,
  grantId: string,
  approvedByUserId: string,
  approvalReason?: string | null,
): { id: string; approval_status: string; message: string } {
  const grantModel = new ConnectGrantModel(db);
  const grant = grantModel.findById(grantId);
  if (!grant) throw createError(404, grantNotFoundDetail(grantId));
  requireMembership(db, approvedByUserId, grant.workspaceId);

  if (grant.approvalStatus !== "pending_approval") {
    throw createError(
      409,
      JSON.stringify({
        error: "grant_invalid_state",
        message: `Grant state is ${grant.approvalStatus}, not pending_approval`,
        grant_id: grantId,
      }),
    );
  }

  const now = new Date().toISOString();
  grantModel.updateGrant(grantId, { approvalStatus: "approved" });

  recordAuditEvent(db, {
    eventType: "connect.grant.approved",
    actorType: "connect_user",
    actorId: approvedByUserId,
    connectAppId: grant.connectAppId,
    connectUserId: grant.connectUserId,
    resourceType: "connect_grant",
    resourceId: grantId,
    agentId: grant.agentId,
    taskId: grant.createdByTaskId,
    workflowRunId: grant.createdByWorkflowRunId,
    workspaceId: grant.workspaceId,
    metadata: { approval_reason: approvalReason || "Grant approved", approved_at: now },
  });

  if (taskQueue) {
    const taskModel = new TaskModel(db);
    for (const task of taskModel.listWaitingForGrant(grantId)) {
      taskModel.updateById(task.id, { status: "queued" });
      taskQueue.send({ task_id: task.id });
    }
  }

  return { id: grantId, approval_status: "approved", message: "Grant approved successfully" };
}

/** Deny a pending grant; the denial reason lives in the audit event, not the grant. */
export function denyGrant(
  db: Db,
  taskQueue: Queue | null,
  grantId: string,
  deniedByUserId: string,
  denialReason?: string | null,
): { id: string; approval_status: string; message: string } {
  const grantModel = new ConnectGrantModel(db);
  const grant = grantModel.findById(grantId);
  if (!grant) throw createError(404, grantNotFoundDetail(grantId));
  requireMembership(db, deniedByUserId, grant.workspaceId);

  if (grant.approvalStatus !== "pending_approval") {
    throw createError(
      409,
      JSON.stringify({
        error: "grant_invalid_state",
        message: `Cannot deny grant in state ${grant.approvalStatus}`,
        grant_id: grantId,
      }),
    );
  }

  const now = new Date().toISOString();
  grantModel.updateGrant(grantId, { approvalStatus: "denied" });

  recordAuditEvent(db, {
    eventType: "connect.grant.denied",
    actorType: "connect_user",
    actorId: deniedByUserId,
    connectAppId: grant.connectAppId,
    connectUserId: grant.connectUserId,
    resourceType: "connect_grant",
    resourceId: grantId,
    agentId: grant.agentId,
    taskId: grant.createdByTaskId,
    workflowRunId: grant.createdByWorkflowRunId,
    denialReason: denialReason ?? null,
    workspaceId: grant.workspaceId,
    metadata: { reason: denialReason ?? null, denied_at: now },
  });

  if (taskQueue) {
    const taskModel = new TaskModel(db);
    for (const task of taskModel.listWaitingForGrant(grantId)) {
      taskModel.updateById(task.id, { status: "failed" });
    }
  }

  return { id: grantId, approval_status: "denied", message: "Grant denied successfully" };
}
