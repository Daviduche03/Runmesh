/**
 * Typed table access. Each class maps to one table and is the only place query construction
 * for that table lives — services call these methods.
 */
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { changedRows, now } from "./client.js";
import type { Db } from "./client.js";
import { parseJsonArray, parseJsonObject } from "../types/helpers.js";
import {
  agentEvents,
  agentRuns,
  apiKeys,
  connectAccountSessions,
  connectAppUsers,
  connectApps,
  connectAuditEvents,
  connectConnections,
  connectGrants,
  connectIdentities,
  connectOtpChallenges,
  connectSessions,
  connectUsers,
  policyDecisions,
  policyRules,
  tasks,
  tools,
  users,
  webhookDeadLetters,
  webhooks,
  workflowRuns,
  workflows,
  workspaceMembers,
  workspaces,
} from "./schema.js";

export type TaskRow = typeof tasks.$inferSelect;
export type WorkflowRow = typeof workflows.$inferSelect;
export type WorkflowRunRow = typeof workflowRuns.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type WebhookRow = typeof webhooks.$inferSelect;
export type WebhookDeadLetterRow = typeof webhookDeadLetters.$inferSelect;
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type PolicyRuleRow = typeof policyRules.$inferSelect;
export type PolicyDecisionRow = typeof policyDecisions.$inferSelect;

/** Bookkeeping columns (`id`, `createdAt`, `updatedAt`) are optional — `create()` fills them. */
type Insertable<T> = Omit<T, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type TaskInsert = Omit<
  typeof tasks.$inferInsert,
  "id" | "createdAt" | "updatedAt" | "idempotencyKey"
> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  idempotencyKey?: string;
};
export type WorkflowInsert = Insertable<typeof workflows.$inferInsert>;
export type WorkflowRunInsert = Insertable<typeof workflowRuns.$inferInsert>;
export type UserInsert = Insertable<typeof users.$inferInsert>;
export type ApiKeyInsert = Insertable<typeof apiKeys.$inferInsert>;
export type WebhookInsert = Insertable<typeof webhooks.$inferInsert>;
export type WebhookDeadLetterInsert = Insertable<typeof webhookDeadLetters.$inferInsert>;

/** Fills the bookkeeping columns a row needs when the caller did not supply them. */
function stampInsert<T extends { id?: string; createdAt?: string; updatedAt?: string }>(
  data: T,
): T & { id: string; createdAt: string; updatedAt: string } {
  const ts = now();
  return {
    ...data,
    id: data.id ?? crypto.randomUUID(),
    createdAt: data.createdAt ?? ts,
    updatedAt: data.updatedAt ?? ts,
  };
}

export class TaskModel {
  constructor(private readonly db: Db) {}

  create(data: TaskInsert): string {
    const row = stampInsert({
      ...data,
      idempotencyKey: data.idempotencyKey ?? crypto.randomUUID(),
    });
    this.db.insert(tasks).values(row).run();
    return row.id;
  }

  findById(taskId: string): TaskRow | null {
    return this.db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1).get() ?? null;
  }

  findByIdempotencyKey(workspaceId: string, idempotencyKey: string): TaskRow | null {
    return (
      this.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.idempotencyKey, idempotencyKey)))
        .limit(1)
        .get() ?? null
    );
  }

  listByWorkflowId(workflowId: string): TaskRow[] {
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.workflowId, workflowId))
      .orderBy(asc(tasks.stepOrder), asc(tasks.createdAt))
      .all();
  }

  deleteByWorkflowId(workflowId: string): number {
    return changedRows(
      this.db.delete(tasks).where(eq(tasks.workflowId, workflowId)).run(),
    );
  }

  deleteTask(taskId: string): number {
    return changedRows(this.db.delete(tasks).where(eq(tasks.id, taskId)).run());
  }

  updateStatus(taskId: string, status: string): number {
    return changedRows(
      this.db
        .update(tasks)
        .set({ status, updatedAt: now() })
        .where(eq(tasks.id, taskId))
        .run(),
    );
  }

  incrementRetries(taskId: string, status: string): number {
    return changedRows(
      this.db
        .update(tasks)
        .set({ status, retries: sql`${tasks.retries} + 1`, updatedAt: now() })
        .where(eq(tasks.id, taskId))
        .run(),
    );
  }

  updateById(taskId: string, patch: Partial<TaskInsert>): number {
    return changedRows(
      this.db
        .update(tasks)
        .set({ ...patch, updatedAt: now() })
        .where(eq(tasks.id, taskId))
        .run(),
    );
  }

  resetForWorkflowRun(taskId: string): number {
    return changedRows(
      this.db
        .update(tasks)
        .set({
          status: "pending",
          retries: 0,
          updatedAt: now(),
          responseBody: null,
          responseStatus: null,
        })
        .where(eq(tasks.id, taskId))
        .run(),
    );
  }

  completeExecution(
    taskId: string,
    status: string,
    responseBody = "",
    responseStatus = 0,
  ): number {
    return changedRows(
      this.db
        .update(tasks)
        .set({
          status,
          updatedAt: now(),
          responseBody,
          responseStatus,
          retries: sql`${tasks.retries} + CASE WHEN ${status} = 'failed' THEN 1 ELSE 0 END`,
        })
        .where(eq(tasks.id, taskId))
        .run(),
    );
  }
}

export class WorkflowModel {
  constructor(private readonly db: Db) {}

  create(data: WorkflowInsert): string {
    const row = stampInsert(data);
    this.db.insert(workflows).values(row).run();
    return row.id;
  }

  list(workspaceId: string): WorkflowRow[] {
    return this.db.select().from(workflows).where(eq(workflows.workspaceId, workspaceId)).all();
  }

  findById(workflowId: string): WorkflowRow | null {
    return this.db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1).get() ?? null;
  }

  listByTriggerType(triggerType: string): WorkflowRow[] {
    return this.db.select().from(workflows).where(eq(workflows.triggerType, triggerType)).all();
  }

  deleteWorkflow(workflowId: string): number {
    return changedRows(this.db.delete(workflows).where(eq(workflows.id, workflowId)).run());
  }

  updateById(workflowId: string, patch: Partial<WorkflowInsert>): number {
    return changedRows(
      this.db
        .update(workflows)
        .set({ ...patch, updatedAt: now() })
        .where(eq(workflows.id, workflowId))
        .run(),
    );
  }
}

export class WorkflowRunModel {
  constructor(private readonly db: Db) {}

  create(data: WorkflowRunInsert): string {
    const row = { ...data, id: data.id ?? crypto.randomUUID() };
    this.db.insert(workflowRuns).values(row).run();
    return row.id;
  }

  findById(runId: string): WorkflowRunRow | null {
    return this.db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1).get() ?? null;
  }

  listByWorkflowId(workflowId: string): WorkflowRunRow[] {
    return this.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, workflowId))
      .orderBy(desc(workflowRuns.startedAt))
      .all();
  }

  findActiveForWorkflow(workflowId: string): WorkflowRunRow | null {
    return (
      this.db
        .select()
        .from(workflowRuns)
        .where(and(eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.status, "running")))
        .limit(1)
        .get() ?? null
    );
  }

  listRunning(): WorkflowRunRow[] {
    return this.db.select().from(workflowRuns).where(eq(workflowRuns.status, "running")).all();
  }

  deleteByWorkflowId(workflowId: string): number {
    return changedRows(
      this.db.delete(workflowRuns).where(eq(workflowRuns.workflowId, workflowId)).run(),
    );
  }

  updateById(runId: string, patch: Partial<WorkflowRunInsert>): number {
    return changedRows(
      this.db.update(workflowRuns).set(patch).where(eq(workflowRuns.id, runId)).run(),
    );
  }
}

export class UserModel {
  constructor(private readonly db: Db) {}

  create(data: UserInsert): string {
    const row = stampInsert(data);
    this.db.insert(users).values(row).run();
    return row.id;
  }

  findByEmail(email: string): UserRow | null {
    return (
      this.db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1).get() ?? null
    );
  }

  findByGithubId(githubId: string): UserRow | null {
    return this.db.select().from(users).where(eq(users.githubId, githubId)).limit(1).get() ?? null;
  }

  findById(userId: string): UserRow | null {
    return this.db.select().from(users).where(eq(users.id, userId)).limit(1).get() ?? null;
  }

  update(userId: string, patch: Partial<UserInsert>): number {
    return changedRows(
      this.db
        .update(users)
        .set({ ...patch, updatedAt: patch.updatedAt ?? now() })
        .where(eq(users.id, userId))
        .run(),
    );
  }
}

export class ApiKeyModel {
  constructor(private readonly db: Db) {}

  findById(keyId: string): ApiKeyRow | null {
    return this.db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1).get() ?? null;
  }

  create(data: ApiKeyInsert): string {
    const row = stampInsert(data);
    this.db.insert(apiKeys).values(row).run();
    return row.id;
  }

  findByKeyHash(keyHash: string): ApiKeyRow | null {
    return (
      this.db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, 1)))
        .limit(1)
        .get() ?? null
    );
  }

  findByWorkspaceId(workspaceId: string, limit = 50): ApiKeyRow[] {
    return this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.workspaceId, workspaceId), eq(apiKeys.isActive, 1)))
      .orderBy(desc(apiKeys.createdAt))
      .limit(limit)
      .all();
  }

  findByUserId(userId: string, limit = 50): ApiKeyRow[] {
    return this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), eq(apiKeys.isActive, 1)))
      .limit(limit)
      .all();
  }

  updateLastUsed(keyId: string): number {
    return changedRows(
      this.db.update(apiKeys).set({ lastUsedAt: now() }).where(eq(apiKeys.id, keyId)).run(),
    );
  }

  deactivate(keyId: string): number {
    return changedRows(
      this.db
        .update(apiKeys)
        .set({ isActive: 0, updatedAt: now() })
        .where(eq(apiKeys.id, keyId))
        .run(),
    );
  }
}

export class WebhookModel {
  constructor(private readonly db: Db) {}

  create(data: WebhookInsert): string {
    const row = stampInsert(data);
    this.db.insert(webhooks).values(row).run();
    return row.id;
  }

  findByUserId(userId: string): WebhookRow[] {
    return this.db
      .select()
      .from(webhooks)
      .where(eq(webhooks.userId, userId))
      .orderBy(desc(webhooks.createdAt))
      .all();
  }

  findByWorkspaceId(workspaceId: string): WebhookRow[] {
    return this.db
      .select()
      .from(webhooks)
      .where(eq(webhooks.workspaceId, workspaceId))
      .orderBy(desc(webhooks.createdAt))
      .all();
  }

  findActiveByUserId(userId: string): WebhookRow[] {
    return this.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.userId, userId), eq(webhooks.status, "active")))
      .orderBy(desc(webhooks.createdAt))
      .all();
  }

  findActiveByWorkspaceId(workspaceId: string): WebhookRow[] {
    return this.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.status, "active")))
      .orderBy(desc(webhooks.createdAt))
      .all();
  }

  findById(webhookId: string): WebhookRow | null {
    return this.db.select().from(webhooks).where(eq(webhooks.id, webhookId)).limit(1).get() ?? null;
  }

  delete(webhookId: string): number {
    return changedRows(this.db.delete(webhooks).where(eq(webhooks.id, webhookId)).run());
  }
}

export class WebhookDeadLetterModel {
  constructor(private readonly db: Db) {}

  create(data: WebhookDeadLetterInsert): string {
    const row = stampInsert(data);
    this.db.insert(webhookDeadLetters).values(row).run();
    return row.id;
  }

  findByWorkspaceId(workspaceId: string, includeReplayed = false): WebhookDeadLetterRow[] {
    const where = includeReplayed
      ? eq(webhookDeadLetters.workspaceId, workspaceId)
      : and(
          eq(webhookDeadLetters.workspaceId, workspaceId),
          sql`${webhookDeadLetters.replayedAt} IS NULL`,
        );
    return this.db
      .select()
      .from(webhookDeadLetters)
      .where(where)
      .orderBy(desc(webhookDeadLetters.failedAt))
      .all();
  }

  findByUserId(userId: string, includeReplayed = false): WebhookDeadLetterRow[] {
    const where = includeReplayed
      ? eq(webhookDeadLetters.userId, userId)
      : and(eq(webhookDeadLetters.userId, userId), sql`${webhookDeadLetters.replayedAt} IS NULL`);
    return this.db
      .select()
      .from(webhookDeadLetters)
      .where(where)
      .orderBy(desc(webhookDeadLetters.failedAt))
      .all();
  }

  findById(deadLetterId: string): WebhookDeadLetterRow | null {
    return (
      this.db
        .select()
        .from(webhookDeadLetters)
        .where(eq(webhookDeadLetters.id, deadLetterId))
        .limit(1)
        .get() ?? null
    );
  }

  markReplayed(deadLetterId: string): number {
    return changedRows(
      this.db
        .update(webhookDeadLetters)
        .set({ replayedAt: now() })
        .where(eq(webhookDeadLetters.id, deadLetterId))
        .run(),
    );
  }

  delete(deadLetterId: string): number {
    return changedRows(
      this.db.delete(webhookDeadLetters).where(eq(webhookDeadLetters.id, deadLetterId)).run(),
    );
  }
}

/**
 * Single-table membership read. Lives in the data layer because the auth middleware needs it
 * and middleware must not import feature modules; `modules/workspaces` layers tenancy policy
 * (roles, personal workspace provisioning) on top.
 */
export function findMembership(
  db: Db,
  userId: string,
  workspaceId: string,
): WorkspaceMemberRow | null {
  if (!workspaceId) return null;
  return (
    db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1)
      .get() ?? null
  );
}

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

function parseScopes(value: string | null): string[] {
  return parseJsonArray(value, []);
}

export type ConnectAppRow = Omit<typeof connectApps.$inferSelect, "redirectUris" | "allowedProviders"> & {
  redirectUris: string[];
  allowedProviders: string[];
};
export type ConnectAppInsert = Omit<typeof connectApps.$inferInsert, "id" | "createdAt" | "updatedAt" | "redirectUris" | "allowedProviders"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  redirectUris?: string[];
  allowedProviders?: string[];
};

export type ConnectAppUserRow = typeof connectAppUsers.$inferSelect;
export type ConnectAppUserInsert = Omit<typeof connectAppUsers.$inferInsert, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ConnectConnectionRow = Omit<typeof connectConnections.$inferSelect, "scopes" | "metadata"> & {
  scopes: string[];
  metadata: Record<string, unknown>;
};
export type ConnectConnectionInsert = Omit<typeof connectConnections.$inferInsert, "id" | "createdAt" | "updatedAt" | "scopes" | "metadata"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
};

export type ConnectUserRow = Omit<typeof connectUsers.$inferSelect, "primaryEmailVerified"> & {
  primaryEmailVerified: boolean;
};
export type ConnectUserInsert = Omit<typeof connectUsers.$inferInsert, "id" | "createdAt" | "updatedAt" | "primaryEmailVerified"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  primaryEmailVerified?: boolean;
};

export type ConnectIdentityRow = Omit<typeof connectIdentities.$inferSelect, "emailVerified"> & {
  emailVerified: boolean;
};
export type ConnectIdentityInsert = Omit<typeof connectIdentities.$inferInsert, "id" | "createdAt" | "updatedAt" | "emailVerified"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  emailVerified?: boolean;
};

export type ConnectOtpChallengeRow = typeof connectOtpChallenges.$inferSelect;
export type ConnectOtpChallengeInsert = Omit<typeof connectOtpChallenges.$inferInsert, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
};

export type ConnectSessionRow = Omit<typeof connectSessions.$inferSelect, "scopes"> & {
  scopes: string[];
};
export type ConnectSessionInsert = Omit<typeof connectSessions.$inferInsert, "id" | "createdAt" | "scopes"> & {
  id?: string;
  createdAt?: string;
  scopes?: string[];
};

export type ConnectGrantRow = Omit<typeof connectGrants.$inferSelect, "scopes" | "resourceFilters"> & {
  scopes: string[];
  resourceFilters: Record<string, unknown> | null;
};
export type ConnectGrantInsert = Omit<typeof connectGrants.$inferInsert, "id" | "grantedAt" | "createdAt" | "updatedAt" | "scopes" | "resourceFilters"> & {
  id?: string;
  grantedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  scopes?: string[];
  resourceFilters?: Record<string, unknown> | null;
};

export type ConnectAccountSessionRow = typeof connectAccountSessions.$inferSelect;

function parseConnectApp(row: typeof connectApps.$inferSelect): ConnectAppRow {
  return {
    ...row,
    redirectUris: parseJsonArray(row.redirectUris, []),
    allowedProviders: parseJsonArray(row.allowedProviders, []),
  };
}

function parseConnectConnection(row: typeof connectConnections.$inferSelect): ConnectConnectionRow {
  return {
    ...row,
    scopes: parseScopes(row.scopes),
    metadata: parseJsonObject(row.metadata, {}),
  };
}

function parseConnectSession(row: typeof connectSessions.$inferSelect): ConnectSessionRow {
  return { ...row, scopes: parseScopes(row.scopes) };
}

function parseConnectGrant(row: typeof connectGrants.$inferSelect): ConnectGrantRow {
  let resourceFilters: Record<string, unknown> | null = null;
  if (row.resourceFilters) {
    try {
      const parsed: unknown = JSON.parse(row.resourceFilters);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        resourceFilters = parsed as Record<string, unknown>;
      }
    } catch {
      resourceFilters = null;
    }
  }
  return { ...row, scopes: parseScopes(row.scopes), resourceFilters };
}

/** Fill bookkeeping columns for tables whose create() callers may omit them. */
function stampConnectInsert<T extends { id?: string; createdAt?: string; updatedAt?: string }>(data: T): T & { id: string; createdAt: string; updatedAt: string } {
  const ts = now();
  return { ...data, id: data.id ?? crypto.randomUUID(), createdAt: data.createdAt ?? ts, updatedAt: data.updatedAt ?? ts };
}

export class ConnectAppModel {
  constructor(private readonly db: Db) {}

  create(data: ConnectAppInsert): ConnectAppRow {
    const row = stampConnectInsert({
      ...data,
      redirectUris: JSON.stringify(data.redirectUris ?? []),
      allowedProviders: JSON.stringify(data.allowedProviders ?? []),
    });
    this.db.insert(connectApps).values(row).run();
    return this.findById(row.id)!;
  }

  findById(connectAppId: string): ConnectAppRow | null {
    const row = this.db.select().from(connectApps).where(eq(connectApps.id, connectAppId)).limit(1).get() ?? null;
    return row ? parseConnectApp(row) : null;
  }

  findBySlug(developerUserId: string, slug: string): ConnectAppRow | null {
    const row =
      this.db
        .select()
        .from(connectApps)
        .where(and(eq(connectApps.developerUserId, developerUserId), eq(connectApps.slug, slug)))
        .limit(1)
        .get() ?? null;
    return row ? parseConnectApp(row) : null;
  }

  listByDeveloperUserId(developerUserId: string): ConnectAppRow[] {
    return this.db
      .select()
      .from(connectApps)
      .where(eq(connectApps.developerUserId, developerUserId))
      .orderBy(desc(connectApps.createdAt))
      .all()
      .map(parseConnectApp);
  }

  findByWorkspace(workspaceId: string): ConnectAppRow | null {
    const row = this.db.select().from(connectApps).where(eq(connectApps.workspaceId, workspaceId)).limit(1).get() ?? null;
    return row ? parseConnectApp(row) : null;
  }

  updateStatus(connectAppId: string, status: string): number {
    return changedRows(
      this.db.update(connectApps).set({ status, updatedAt: now() }).where(eq(connectApps.id, connectAppId)).run(),
    );
  }

  deleteApp(connectAppId: string): number {
    return changedRows(this.db.delete(connectApps).where(eq(connectApps.id, connectAppId)).run());
  }
}

export class ConnectAppUserModel {
  constructor(private readonly db: Db) {}

  create(data: ConnectAppUserInsert): ConnectAppUserRow {
    const row = stampConnectInsert(data);
    this.db.insert(connectAppUsers).values(row).run();
    return this.findById(row.id)!;
  }

  findById(appUserId: string): ConnectAppUserRow | null {
    return this.db.select().from(connectAppUsers).where(eq(connectAppUsers.id, appUserId)).limit(1).get() ?? null;
  }

  findByExternalUser(connectAppId: string, externalUserId: string): ConnectAppUserRow | null {
    return (
      this.db
        .select()
        .from(connectAppUsers)
        .where(and(eq(connectAppUsers.connectAppId, connectAppId), eq(connectAppUsers.externalUserId, externalUserId)))
        .limit(1)
        .get() ?? null
    );
  }

  findByConnectUser(connectAppId: string, connectUserId: string): ConnectAppUserRow | null {
    return (
      this.db
        .select()
        .from(connectAppUsers)
        .where(and(eq(connectAppUsers.connectAppId, connectAppId), eq(connectAppUsers.connectUserId, connectUserId)))
        .limit(1)
        .get() ?? null
    );
  }

  linkUser(connectAppId: string, externalUserId: string, connectUserId: string): ConnectAppUserRow {
    const existing = this.findByExternalUser(connectAppId, externalUserId);
    const ts = now();
    if (existing) {
      if (existing.connectUserId === connectUserId) return existing;
      this.db
        .update(connectAppUsers)
        .set({ connectUserId, updatedAt: ts })
        .where(eq(connectAppUsers.id, existing.id))
        .run();
      return this.findById(existing.id)!;
    }
    return this.create({ connectAppId, externalUserId, connectUserId });
  }
}

export class ConnectConnectionModel {
  constructor(private readonly db: Db) {}

  create(data: ConnectConnectionInsert): ConnectConnectionRow {
    const row = stampConnectInsert({
      ...data,
      scopes: JSON.stringify(data.scopes ?? []),
      metadata: JSON.stringify(data.metadata ?? {}),
    });
    this.db.insert(connectConnections).values(row).run();
    return this.findById(row.id)!;
  }

  findById(connectionId: string): ConnectConnectionRow | null {
    const row = this.db.select().from(connectConnections).where(eq(connectConnections.id, connectionId)).limit(1).get() ?? null;
    return row ? parseConnectConnection(row) : null;
  }

  findByUserProvider(connectUserId: string, provider: string): ConnectConnectionRow | null {
    const row =
      this.db
        .select()
        .from(connectConnections)
        .where(and(eq(connectConnections.connectUserId, connectUserId), eq(connectConnections.provider, provider)))
        .limit(1)
        .get() ?? null;
    return row ? parseConnectConnection(row) : null;
  }

  updateConnection(connectionId: string, patch: Partial<ConnectConnectionInsert> & { revokedAt?: string | null }): number {
    const { scopes, metadata, ...rest } = patch;
    const data: Record<string, unknown> = { ...rest };
    if (scopes !== undefined) data.scopes = JSON.stringify(scopes);
    if (metadata !== undefined) data.metadata = JSON.stringify(metadata);
    if (Object.keys(data).length === 0) return 0;
    return changedRows(
      this.db.update(connectConnections).set({ ...data, updatedAt: now() }).where(eq(connectConnections.id, connectionId)).run(),
    );
  }

  listByWorkspace(workspaceId: string, filter: { provider?: string | null; status?: string | null; limit?: number; offset?: number } = {}): ConnectConnectionRow[] {
    const conditions = [eq(connectConnections.workspaceId, workspaceId)];
    if (filter.provider) conditions.push(eq(connectConnections.provider, filter.provider));
    if (filter.status) conditions.push(eq(connectConnections.status, filter.status));
    return this.db
      .select()
      .from(connectConnections)
      .where(and(...conditions))
      .orderBy(desc(connectConnections.createdAt))
      .limit(filter.limit ?? 50)
      .offset(filter.offset ?? 0)
      .all()
      .map(parseConnectConnection);
  }

  countByWorkspace(workspaceId: string, filter: { provider?: string | null; status?: string | null } = {}): number {
    const conditions = [eq(connectConnections.workspaceId, workspaceId)];
    if (filter.provider) conditions.push(eq(connectConnections.provider, filter.provider));
    if (filter.status) conditions.push(eq(connectConnections.status, filter.status));
    const row = this.db.select({ value: count() }).from(connectConnections).where(and(...conditions)).get();
    return Number(row?.value ?? 0);
  }

  revoke(connectionId: string): number {
    const ts = now();
    return changedRows(
      this.db
        .update(connectConnections)
        .set({ status: "revoked", revokedAt: ts, updatedAt: ts })
        .where(eq(connectConnections.id, connectionId))
        .run(),
    );
  }
}

export class ConnectUserModel {
  constructor(private readonly db: Db) {}

  create(data: ConnectUserInsert = {}): ConnectUserRow {
    const row = stampConnectInsert({
      ...data,
      primaryEmailVerified: data.primaryEmailVerified ? 1 : 0,
    });
    this.db.insert(connectUsers).values(row).run();
    return this.findById(row.id)!;
  }

  findById(connectUserId: string): ConnectUserRow | null {
    const row = this.db.select().from(connectUsers).where(eq(connectUsers.id, connectUserId)).limit(1).get() ?? null;
    return row ? { ...row, primaryEmailVerified: row.primaryEmailVerified === 1 } : null;
  }

  updateStatus(connectUserId: string, status: string): number {
    return changedRows(
      this.db.update(connectUsers).set({ status, updatedAt: now() }).where(eq(connectUsers.id, connectUserId)).run(),
    );
  }

  findByPrimaryEmail(email: string): ConnectUserRow | null {
    const row =
      this.db
        .select()
        .from(connectUsers)
        .where(sql`lower(${connectUsers.primaryEmail}) = lower(${email.trim()}) AND ${connectUsers.primaryEmailVerified} = 1`)
        .limit(1)
        .get() ?? null;
    return row ? { ...row, primaryEmailVerified: row.primaryEmailVerified === 1 } : null;
  }

  updatePrimaryEmail(connectUserId: string, email: string, verified: boolean): number {
    return changedRows(
      this.db
        .update(connectUsers)
        .set({ primaryEmail: email.trim().toLowerCase(), primaryEmailVerified: verified ? 1 : 0, updatedAt: now() })
        .where(eq(connectUsers.id, connectUserId))
        .run(),
    );
  }
}

export class ConnectAccountSessionModel {
  constructor(private readonly db: Db) {}

  create(data: typeof connectAccountSessions.$inferInsert): ConnectAccountSessionRow {
    const row = { ...data, id: data.id ?? crypto.randomUUID(), createdAt: data.createdAt ?? now() };
    this.db.insert(connectAccountSessions).values(row).run();
    return this.findByTokenHash(row.tokenHash)!;
  }

  findByTokenHash(tokenHash: string): ConnectAccountSessionRow | null {
    return this.db.select().from(connectAccountSessions).where(eq(connectAccountSessions.tokenHash, tokenHash)).limit(1).get() ?? null;
  }
}

export class ConnectOtpChallengeModel {
  constructor(private readonly db: Db) {}

  create(data: ConnectOtpChallengeInsert): ConnectOtpChallengeRow {
    const row = { ...data, id: data.id ?? crypto.randomUUID(), createdAt: data.createdAt ?? now() };
    this.db.insert(connectOtpChallenges).values(row).run();
    return this.findById(row.id)!;
  }

  findById(challengeId: string): ConnectOtpChallengeRow | null {
    return this.db.select().from(connectOtpChallenges).where(eq(connectOtpChallenges.id, challengeId)).limit(1).get() ?? null;
  }

  findPendingForSession(connectSessionId: string): ConnectOtpChallengeRow | null {
    return (
      this.db
        .select()
        .from(connectOtpChallenges)
        .where(and(eq(connectOtpChallenges.connectSessionId, connectSessionId), eq(connectOtpChallenges.status, "pending")))
        .orderBy(desc(connectOtpChallenges.createdAt))
        .limit(1)
        .get() ?? null
    );
  }

  updateChallenge(challengeId: string, patch: Partial<typeof connectOtpChallenges.$inferInsert>): number {
    if (Object.keys(patch).length === 0) return 0;
    return changedRows(
      this.db.update(connectOtpChallenges).set(patch).where(eq(connectOtpChallenges.id, challengeId)).run(),
    );
  }

  countRecentForEmail(email: string, sinceIso: string): number {
    const row =
      this.db
        .select({ value: count() })
        .from(connectOtpChallenges)
        .where(and(eq(connectOtpChallenges.email, email), sql`${connectOtpChallenges.createdAt} >= ${sinceIso}`))
        .get();
    return Number(row?.value ?? 0);
  }
}

export class ConnectIdentityModel {
  constructor(private readonly db: Db) {}

  create(data: ConnectIdentityInsert): ConnectIdentityRow {
    const row = stampConnectInsert({ ...data, emailVerified: data.emailVerified ? 1 : 0 });
    this.db.insert(connectIdentities).values(row).run();
    return this.findById(row.id)!;
  }

  findById(identityId: string): ConnectIdentityRow | null {
    const row = this.db.select().from(connectIdentities).where(eq(connectIdentities.id, identityId)).limit(1).get() ?? null;
    return row ? { ...row, emailVerified: row.emailVerified === 1 } : null;
  }

  findByProviderSubject(provider: string, providerSubject: string): ConnectIdentityRow | null {
    const row =
      this.db
        .select()
        .from(connectIdentities)
        .where(and(eq(connectIdentities.provider, provider), eq(connectIdentities.providerSubject, providerSubject)))
        .limit(1)
        .get() ?? null;
    return row ? { ...row, emailVerified: row.emailVerified === 1 } : null;
  }

  listVerifiedByEmail(email: string): ConnectIdentityRow[] {
    return this.db
      .select()
      .from(connectIdentities)
      .where(sql`lower(${connectIdentities.email}) = lower(${email.trim()}) AND ${connectIdentities.emailVerified} = 1`)
      .orderBy(asc(connectIdentities.createdAt))
      .all()
      .map((row) => ({ ...row, emailVerified: row.emailVerified === 1 }));
  }
}

export class ConnectGrantModel {
  constructor(private readonly db: Db) {}

  create(data: ConnectGrantInsert): ConnectGrantRow {
    const ts = now();
    const row = stampConnectInsert({
      ...data,
      scopes: JSON.stringify(data.scopes ?? []),
      resourceFilters: data.resourceFilters === undefined ? null : data.resourceFilters === null ? null : JSON.stringify(data.resourceFilters),
      grantedAt: data.grantedAt ?? ts,
    });
    this.db.insert(connectGrants).values(row).run();
    return this.findById(row.id)!;
  }

  findById(grantId: string): ConnectGrantRow | null {
    const row = this.db.select().from(connectGrants).where(eq(connectGrants.id, grantId)).limit(1).get() ?? null;
    return row ? parseConnectGrant(row) : null;
  }

  /** Active by status; approval gating happens at token exchange, not here. */
  findActive(connectAppId: string | null, connectUserId: string, connectionId: string, workspaceId?: string | null): ConnectGrantRow | null {
    const conditions = [
      eq(connectGrants.connectUserId, connectUserId),
      eq(connectGrants.connectionId, connectionId),
      eq(connectGrants.status, "active"),
    ];
    if (connectAppId === null) {
      conditions.push(sql`${connectGrants.connectAppId} IS NULL`);
    } else {
      conditions.push(eq(connectGrants.connectAppId, connectAppId));
    }
    if (workspaceId) conditions.push(eq(connectGrants.workspaceId, workspaceId));
    const row = this.db.select().from(connectGrants).where(and(...conditions)).limit(1).get() ?? null;
    return row ? parseConnectGrant(row) : null;
  }

  private uiStatusConditions(uiStatus: string, now?: string | null): ReturnType<typeof eq>[] {
    switch (uiStatus) {
      case "pending":
        return [eq(connectGrants.approvalStatus, "pending_approval"), eq(connectGrants.status, "active")];
      case "active":
        return [
          eq(connectGrants.approvalStatus, "approved"),
          eq(connectGrants.status, "active"),
          ...(now ? [sql`(valid_until IS NULL OR valid_until > ${now})`] : []),
        ];
      case "expired":
        return [
          eq(connectGrants.approvalStatus, "approved"),
          eq(connectGrants.status, "active"),
          sql`valid_until IS NOT NULL`,
          ...(now ? [sql`valid_until <= ${now}`] : []),
        ];
      case "revoked":
        return [eq(connectGrants.status, "revoked")];
      case "denied":
        return [eq(connectGrants.approvalStatus, "denied")];
      default:
        return [];
    }
  }

  listByWorkspace(workspaceId: string, filter: { uiStatus?: string | null; agentId?: string | null; now?: string | null; limit?: number; offset?: number } = {}): ConnectGrantRow[] {
    const conditions = [eq(connectGrants.workspaceId, workspaceId)];
    if (filter.agentId) conditions.push(eq(connectGrants.agentId, filter.agentId));
    conditions.push(...this.uiStatusConditions(filter.uiStatus ?? "", filter.now));
    return this.db
      .select()
      .from(connectGrants)
      .where(and(...conditions))
      .orderBy(desc(connectGrants.createdAt))
      .limit(filter.limit ?? 50)
      .offset(filter.offset ?? 0)
      .all()
      .map(parseConnectGrant);
  }

  countByWorkspace(workspaceId: string, filter: { uiStatus?: string | null; agentId?: string | null; now?: string | null } = {}): number {
    const conditions = [eq(connectGrants.workspaceId, workspaceId)];
    if (filter.agentId) conditions.push(eq(connectGrants.agentId, filter.agentId));
    conditions.push(...this.uiStatusConditions(filter.uiStatus ?? "", filter.now));
    const row = this.db.select({ value: count() }).from(connectGrants).where(and(...conditions)).get();
    return Number(row?.value ?? 0);
  }

  revoke(grantId: string): number {
    const ts = now();
    return changedRows(
      this.db
        .update(connectGrants)
        .set({ status: "revoked", revokedAt: ts, updatedAt: ts })
        .where(eq(connectGrants.id, grantId))
        .run(),
    );
  }

  updateGrant(grantId: string, patch: Partial<ConnectGrantInsert> & { status?: string; approvalStatus?: string; useCount?: number; revokedAt?: string | null }): number {
    const { scopes, resourceFilters, ...rest } = patch;
    const data: Record<string, unknown> = { ...rest };
    if (scopes !== undefined) data.scopes = JSON.stringify(scopes);
    if (resourceFilters !== undefined) data.resourceFilters = resourceFilters === null ? null : JSON.stringify(resourceFilters);
    return changedRows(
      this.db.update(connectGrants).set({ ...data, updatedAt: now() }).where(eq(connectGrants.id, grantId)).run(),
    );
  }
}

export class ConnectSessionModel {
  constructor(private readonly db: Db) {}

  create(data: ConnectSessionInsert): ConnectSessionRow {
    const row = { ...data, id: data.id ?? crypto.randomUUID(), createdAt: data.createdAt ?? now(), scopes: JSON.stringify(data.scopes ?? []) };
    this.db.insert(connectSessions).values(row).run();
    return this.findById(row.id)!;
  }

  findById(sessionId: string): ConnectSessionRow | null {
    const row = this.db.select().from(connectSessions).where(eq(connectSessions.id, sessionId)).limit(1).get() ?? null;
    return row ? parseConnectSession(row) : null;
  }

  findByState(state: string): ConnectSessionRow | null {
    const row = this.db.select().from(connectSessions).where(eq(connectSessions.state, state)).limit(1).get() ?? null;
    return row ? parseConnectSession(row) : null;
  }

  updateSession(sessionId: string, patch: Partial<ConnectSessionInsert> & { status?: string; completedAt?: string | null }): number {
    const { scopes, ...rest } = patch;
    const data: Record<string, unknown> = { ...rest };
    if (scopes !== undefined) data.scopes = JSON.stringify(scopes);
    if (Object.keys(data).length === 0) return 0;
    return changedRows(
      this.db.update(connectSessions).set(data).where(eq(connectSessions.id, sessionId)).run(),
    );
  }

  complete(sessionId: string, connectUserId: string): number {
    return changedRows(
      this.db
        .update(connectSessions)
        .set({ connectUserId, status: "completed", completedAt: now() })
        .where(eq(connectSessions.id, sessionId))
        .run(),
    );
  }
}

export class ConnectAuditEventModel {
  constructor(private readonly db: Db) {}

  findById(eventId: string): typeof connectAuditEvents.$inferSelect | null {
    return this.db.select().from(connectAuditEvents).where(eq(connectAuditEvents.id, eventId)).limit(1).get() ?? null;
  }

  findTokenExchanges(workspaceId: string, filter: { taskId?: string | null; workflowRunId?: string | null; workspaceProjectId?: string | null; limit?: number } = {}): Array<typeof connectAuditEvents.$inferSelect> {
    const conditions = [eq(connectAuditEvents.eventType, "connect.token.exchanged"), eq(connectAuditEvents.workspaceId, workspaceId)];
    if (filter.taskId != null) conditions.push(sql`json_extract(${connectAuditEvents.metadata}, '$.task_id') = ${filter.taskId}`);
    if (filter.workflowRunId != null) conditions.push(sql`json_extract(${connectAuditEvents.metadata}, '$.workflow_run_id') = ${filter.workflowRunId}`);
    if (filter.workspaceProjectId != null) conditions.push(sql`json_extract(${connectAuditEvents.metadata}, '$.workspace_project_id') = ${filter.workspaceProjectId}`);
    return this.db
      .select()
      .from(connectAuditEvents)
      .where(and(...conditions))
      .orderBy(desc(connectAuditEvents.createdAt))
      .limit(filter.limit ?? 50)
      .all();
  }

  listAll(workspaceId: string, filter: { eventType?: string | null; connectUserId?: string | null; search?: string | null; limit?: number; offset?: number } = {}): { rows: Array<typeof connectAuditEvents.$inferSelect>; total: number } {
    const conditions = [eq(connectAuditEvents.workspaceId, workspaceId)];
    if (filter.eventType != null) conditions.push(eq(connectAuditEvents.eventType, filter.eventType));
    if (filter.connectUserId != null) conditions.push(eq(connectAuditEvents.connectUserId, filter.connectUserId));
    if (filter.search != null) {
      const like = `%${filter.search}%`;
      conditions.push(
        sql`(${connectAuditEvents.eventType} LIKE ${like} OR ${connectAuditEvents.actorId} LIKE ${like} OR ${connectAuditEvents.resourceId} LIKE ${like} OR ${connectAuditEvents.connectUserId} LIKE ${like})`,
      );
    }
    const where = and(...conditions);
    const totalRow = this.db.select({ value: count() }).from(connectAuditEvents).where(where).get();
    const rows = this.db
      .select()
      .from(connectAuditEvents)
      .where(where)
      .orderBy(desc(connectAuditEvents.createdAt))
      .limit(filter.limit ?? 50)
      .offset(filter.offset ?? 0)
      .all();
    return { rows, total: Number(totalRow?.value ?? 0) };
  }
}
