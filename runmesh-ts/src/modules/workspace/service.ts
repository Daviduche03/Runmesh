import { asc, desc, eq, sql } from "drizzle-orm";
import createError from "http-errors";
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../../core/db/client.js";
import {
  users,
  workspaceInvites,
  workspaceMembers,
  workspaceProjects,
  workspaces,
} from "../../core/db/schema.js";
import type { WorkspaceRow } from "../../core/db/orm.js";
import { getMembership, findUserByEmailInsensitive } from "./tenancy.js";

export const WORKSPACE_TYPES = ["personal", "work"] as const;
export const WORKSPACE_PLANS = ["free", "pro", "enterprise"] as const;
const INVITE_ROLES = ["member", "admin"];
const INVITE_TTL_DAYS = 7;
const MAX_INVITES_PER_REQUEST = 20;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

export interface OnboardInvite {
  email?: string;
  role?: string;
}

export interface OnboardInput {
  name: string;
  type?: string;
  slug?: string | null;
  avatar_url?: string | null;
  plan?: string;
  seats?: number;
  metadata?: Record<string, unknown>;
  invites?: OnboardInvite[];
}

const newId = (prefix: string): string => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export function serializeWorkspace(
  row: WorkspaceRow,
  role?: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: row.id,
    name: row.name ?? "",
    slug: row.slug,
    type: row.type ?? "personal",
    plan: row.plan ?? "free",
    seats: row.seats ?? 1,
    status: row.status ?? "active",
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
  if (role !== undefined) out.role = role;
  return out;
}

function findPersonalWorkspace(db: Db, userId: string): WorkspaceRow | null {
  return (
    db
      .select()
      .from(workspaces)
      .where(sql`${workspaces.ownerUserId} = ${userId} AND ${workspaces.type} = 'personal'`)
      .limit(1)
      .get() ?? null
  );
}

export interface ServiceResult<T> {
  data: T;
  message: string;
}

/**
 * Create (or return) a workspace for a freshly onboarded user.
 * Personal is idempotent: one per user, returned as-is when it exists. Work always creates.
 * Invites are work-only.
 */
export function onboardWorkspace(
  db: Db,
  userId: string,
  input: OnboardInput,
): ServiceResult<Record<string, unknown>> {
  const name = (input.name ?? "").trim();
  if (!name || name.length > 64) {
    throw createError(400, "Workspace name is required (1-64 characters)");
  }

  const type = (input.type ?? "personal").trim().toLowerCase();
  if (!WORKSPACE_TYPES.includes(type as (typeof WORKSPACE_TYPES)[number])) {
    throw createError(400, "Workspace type must be 'personal' or 'work'");
  }

  const plan = (input.plan ?? "free").trim().toLowerCase();
  if (!WORKSPACE_PLANS.includes(plan as (typeof WORKSPACE_PLANS)[number])) {
    throw createError(400, "Workspace plan must be free, pro, or enterprise");
  }

  const seats = Number(input.seats ?? 1);
  if (!Number.isInteger(seats)) throw createError(400, "Seats must be a positive integer");
  if (seats < 1) throw createError(400, "Seats must be at least 1");
  if (type === "personal" && seats !== 1) {
    throw createError(400, "Personal workspaces have exactly 1 seat");
  }

  const slug = (input.slug ?? "").trim().toLowerCase() || null;
  if (slug !== null) {
    if (!SLUG_RE.test(slug)) {
      throw createError(400, "Slug must be 2-48 lowercase letters, numbers, or hyphens");
    }
    const taken = db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, slug))
      .limit(1)
      .get();
    if (taken) throw createError(409, "Slug is already taken");
  }

  const avatarUrl = (input.avatar_url ?? "").trim() || null;
  if (avatarUrl !== null) {
    if (!avatarUrl.startsWith("https://") && !avatarUrl.startsWith("http://")) {
      throw createError(400, "Avatar must be an http(s) URL");
    }
    if (avatarUrl.length > 512) throw createError(400, "Avatar URL is too long");
  }

  const metadata =
    input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? input.metadata
      : {};
  const invites = input.invites ?? [];
  if (invites.length > 0 && type !== "work") {
    throw createError(400, "Invites are only available for work workspaces");
  }
  if (invites.length > MAX_INVITES_PER_REQUEST) {
    throw createError(400, `At most ${MAX_INVITES_PER_REQUEST} invites per request`);
  }

  if (type === "personal") {
    const existing = findPersonalWorkspace(db, userId);
    if (existing) {
      return {
        data: { ...serializeWorkspace(existing, "owner"), created: false },
        message: "Personal workspace already exists",
      };
    }
  }

  const ts = new Date().toISOString();
  const workspaceId = newId("ws");

  db.insert(workspaces)
    .values({
      id: workspaceId,
      name,
      ownerUserId: userId,
      status: "active",
      type,
      slug,
      avatarUrl,
      plan,
      seats,
      metadata: JSON.stringify(metadata),
      createdAt: ts,
      updatedAt: ts,
    })
    .run();

  db.insert(workspaceMembers)
    .values({
      id: newId("wsm"),
      workspaceId,
      userId,
      role: "owner",
      createdAt: ts,
      updatedAt: ts,
    })
    .run();

  const createdInvites: Array<Record<string, unknown>> = [];
  const skippedInvites: Array<Record<string, unknown>> = [];
  const seenEmails = new Set<string>();

  for (const invite of invites) {
    const email = (invite.email ?? "").trim().toLowerCase();
    const role = (invite.role ?? "member").trim().toLowerCase();

    if (!email || !EMAIL_RE.test(email)) {
      skippedInvites.push({ email: invite.email ?? null, reason: "invalid email" });
      continue;
    }
    if (seenEmails.has(email)) {
      skippedInvites.push({ email, reason: "duplicate in request" });
      continue;
    }
    seenEmails.add(email);

    if (!INVITE_ROLES.includes(role)) {
      skippedInvites.push({ email, reason: "role must be member or admin" });
      continue;
    }

    const existingUser = findUserByEmailInsensitive(db, email);
    if (existingUser && getMembership(db, existingUser.id, workspaceId)) {
      skippedInvites.push({ email, reason: "already a member" });
      continue;
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    db.insert(workspaceInvites)
      .values({
        id: newId("wsi"),
        workspaceId,
        email,
        role,
        status: "pending",
        tokenHash: hashToken(token),
        invitedByUserId: userId,
        expiresAt,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();

    createdInvites.push({ email, role, token, expires_at: expiresAt });
  }

  const workspace = db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)
    .get();

  return {
    data: {
      ...serializeWorkspace(workspace!, "owner"),
      created: true,
      invites: { created: createdInvites, skipped: skippedInvites },
    },
    message: "Workspace created",
  };
}

export function listUserWorkspaces(db: Db, userId: string): Record<string, unknown>[] {
  const memberships = db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaceMembers.createdAt))
    .all();

  const items: Record<string, unknown>[] = [];
  for (const membership of memberships) {
    const workspace = db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, membership.workspaceId))
      .limit(1)
      .get();
    if (!workspace) continue;
    items.push(serializeWorkspace(workspace, membership.role));
  }
  return items;
}

export function acceptWorkspaceInvite(
  db: Db,
  userId: string,
  token: string,
): ServiceResult<Record<string, unknown>> {
  const user = db.select().from(users).where(eq(users.id, userId)).limit(1).get();
  if (!user) throw createError(401, "User not found");

  const userEmail = (user.email ?? "").trim().toLowerCase();
  if (!userEmail) throw createError(403, "Account has no verified email");

  const invite = db
    .select()
    .from(workspaceInvites)
    .where(eq(workspaceInvites.tokenHash, hashToken(token ?? "")))
    .limit(1)
    .get();

  if (!invite || invite.status !== "pending") {
    throw createError(404, "Invite not found or already used");
  }

  const now = new Date();
  const expiresAt = new Date(invite.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    db.update(workspaceInvites)
      .set({ status: "expired", updatedAt: now.toISOString() })
      .where(eq(workspaceInvites.id, invite.id))
      .run();
    throw createError(410, "Invite has expired");
  }

  if ((invite.email ?? "").trim().toLowerCase() !== userEmail) {
    throw createError(403, "Invite was sent to a different email");
  }

  const workspace = db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, invite.workspaceId))
    .limit(1)
    .get();
  if (!workspace || workspace.status !== "active") {
    throw createError(404, "Workspace not found");
  }

  const existing = getMembership(db, userId, workspace.id);
  if (!existing) {
    db.insert(workspaceMembers)
      .values({
        id: newId("wsm"),
        workspaceId: workspace.id,
        userId,
        role: invite.role ?? "member",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
      .run();
  }

  db.update(workspaceInvites)
    .set({ status: "accepted", updatedAt: now.toISOString() })
    .where(eq(workspaceInvites.id, invite.id))
    .run();

  return {
    data: serializeWorkspace(workspace, existing?.role ?? invite.role),
    message: "Invite accepted",
  };
}

const serializeProject = (row: typeof workspaceProjects.$inferSelect): Record<string, unknown> => ({
  id: row.id,
  user_id: row.userId,
  prefix: row.prefix,
  bucket: row.bucket,
  local_path: row.localPath,
  last_synced_at: row.lastSyncedAt,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

export function listProjects(db: Db, userId: string): Record<string, unknown>[] {
  return db
    .select()
    .from(workspaceProjects)
    .where(eq(workspaceProjects.userId, userId))
    .orderBy(desc(workspaceProjects.createdAt))
    .all()
    .map(serializeProject);
}

export function linkProject(
  db: Db,
  userId: string,
  input: { prefix?: string; bucket?: string; local_path?: string },
): ServiceResult<Record<string, unknown>> {
  const prefix = (input.prefix ?? "").trim();
  const bucket = (input.bucket ?? "").trim();
  const localPath = (input.local_path ?? "").trim() || null;

  if (!prefix) throw createError(400, "prefix is required");
  if (!bucket) throw createError(400, "bucket is required");

  const ts = new Date().toISOString();
  const projectId = crypto.randomUUID();

  db.insert(workspaceProjects)
    .values({
      id: projectId,
      userId,
      prefix,
      bucket,
      localPath,
      createdAt: ts,
      updatedAt: ts,
    })
    .run();

  return {
    data: {
      id: projectId,
      prefix,
      bucket,
      local_path: localPath,
      created_at: ts,
    },
    message: "Project linked",
  };
}

export function unlinkProject(
  db: Db,
  userId: string,
  projectId: string,
): ServiceResult<Record<string, unknown>> {
  db.delete(workspaceProjects)
    .where(sql`${workspaceProjects.id} = ${projectId} AND ${workspaceProjects.userId} = ${userId}`)
    .run();
  return { data: { id: projectId }, message: "Project unlinked" };
}
