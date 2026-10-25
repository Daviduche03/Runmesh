/**
 * Typed table access. Each class maps to one table and is the only place query construction
 * for that table lives — services call these methods.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { changedRows, now } from "./client.js";
import type { Db } from "./client.js";
import {
  apiKeys,
  policyDecisions,
  policyRules,
  tasks,
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
