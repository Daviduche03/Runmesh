/**
 * Workspace tenancy.
 *
 * Ownership model: rows carry a `workspace_id`; callers prove membership instead of matching
 * a `user_id` column. Rows without a workspace id fall back to the legacy owner check.
 *
 * 404 (not 403) for a workspace the caller cannot see, so ids stay unguessable.
 */
import { asc, eq, sql } from "drizzle-orm";
import createError from "http-errors";
import type { Request } from "express";
import type { Db } from "../../core/db/client.js";
import { findMembership } from "../../core/db/orm.js";
import type { WorkspaceMemberRow, WorkspaceRow } from "../../core/db/orm.js";
import type { AuthUser } from "../../core/http/context.js";
import { users, workspaceMembers, workspaces } from "../../core/db/schema.js";

export const WORKSPACE_HEADER = "X-Workspace-ID";

export const ROLE_RANK: Record<string, number> = { member: 1, admin: 2, owner: 3 };

export function getMembership(
  db: Db,
  userId: string,
  workspaceId: string,
): WorkspaceMemberRow | null {
  return findMembership(db, userId, workspaceId);
}

export function requireMembership(
  db: Db,
  userId: string,
  workspaceId: string | null | undefined,
  minRole = "member",
): WorkspaceMemberRow {
  const workspace: WorkspaceRow | null = workspaceId
    ? (db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1).get() ?? null)
    : null;

  if (!workspace || workspace.status !== "active") {
    throw createError(404, "Workspace not found");
  }

  const membership = getMembership(db, userId, workspace.id);
  if (!membership) throw createError(404, "Workspace not found");

  if ((ROLE_RANK[membership.role] ?? 0) < (ROLE_RANK[minRole] ?? 1)) {
    throw createError(403, "Insufficient workspace role");
  }
  return membership;
}

/** Earliest membership wins; provision a Personal workspace when the user has none. */
export function ensurePersonalWorkspace(db: Db, userId: string): string {
  const existing = db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaceMembers.createdAt), asc(workspaceMembers.workspaceId))
    .limit(1)
    .get();

  if (existing) return existing.workspaceId;

  const ts = new Date().toISOString();
  const workspaceId = `ws_${crypto.randomUUID().replace(/-/g, "")}`;

  db.insert(workspaces)
    .values({
      id: workspaceId,
      name: "Personal",
      ownerUserId: userId,
      status: "active",
      metadata: "{}",
      createdAt: ts,
      updatedAt: ts,
    })
    .run();

  db.insert(workspaceMembers)
    .values({
      id: `wsm_${crypto.randomUUID().replace(/-/g, "")}`,
      workspaceId,
      userId,
      role: "owner",
      createdAt: ts,
      updatedAt: ts,
    })
    .run();

  return workspaceId;
}

export function resolveWorkspaceId(
  db: Db,
  userId: string,
  requestedId?: string | null,
): string {
  const requested = (requestedId ?? "").trim();
  if (requested) {
    requireMembership(db, userId, requested);
    return requested;
  }
  return ensurePersonalWorkspace(db, userId);
}

/**
 * Workspace selector: explicit `X-Workspace-ID` (or `?workspace_id=`), else the API key's
 * bound workspace, else the user's default. A key bound to a workspace cannot reach any
 * other workspace.
 */
export function resolveRequestWorkspace(req: Request, user: AuthUser): string {
  const db = req.ctx.db;
  const headerId = req.get(WORKSPACE_HEADER);
  const queryId = typeof req.query.workspace_id === "string" ? req.query.workspace_id : "";
  const requested = (headerId || queryId || "").trim();
  const bound = (user.apiKeyWorkspaceId ?? "").trim();

  if (bound) {
    if (requested && requested !== bound) throw createError(404, "Workspace not found");
    requireMembership(db, user.id, bound);
    return bound;
  }

  return resolveWorkspaceId(db, user.id, requested || null);
}

/**
 * Row-level gate: membership on `workspaceId` when the row has one, else the legacy owner
 * check. Raises 404 either way so cross-tenant ids stay unguessable.
 */
export function requireRowAccess(
  db: Db,
  userId: string,
  row: Record<string, unknown> | null | undefined,
  options: { userField?: string; notFoundDetail?: string } = {},
): void {
  const detail = options.notFoundDetail ?? "Not found";
  if (!row) throw createError(404, detail);

  const workspaceId = row.workspaceId;
  if (typeof workspaceId === "string" && workspaceId.length > 0) {
    requireMembership(db, userId, workspaceId);
    return;
  }

  const userField = options.userField ?? "userId";
  if (row[userField] !== userId) throw createError(404, detail);
}

/** `users.email` compared case-insensitively, as the Python queries did with `lower(email)`. */
export function findUserByEmailInsensitive(db: Db, email: string): { id: string } | null {
  const row = db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1)
    .get();
  return row ?? null;
}
