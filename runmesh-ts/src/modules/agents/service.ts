/**
 * First-class agents: identity + lifecycle.
 *
 * An agent row is a principal, never an authority. Scopes, caps, approvals and expiries live
 * in grants/policy/audit; this module only creates the identity, lists it, and archives it.
 */
import { and, desc, eq, ne } from "drizzle-orm";
import createError from "http-errors";
import { createHash } from "node:crypto";
import type { Db } from "../../core/db/client.js";
import { agents } from "../../core/db/schema.js";

export const AGENT_ENVIRONMENTS = ["dev", "staging", "prod"] as const;
export const AGENT_STATUS_ARCHIVED = "archived";
const AGENT_NAME_MAX = 64;
const AGENT_DESCRIPTION_MAX = 500;
const AGENT_PUBLIC_KEY_MAX = 4096;

type AgentRow = typeof agents.$inferSelect;

export interface CreateAgentInput {
  name?: string | null;
  description?: string | null;
  parent_agent_id?: string | null;
  project_id?: string | null;
  environment?: string | null;
  public_key?: string | null;
}

export interface ServiceResult<T> {
  data: T;
  message?: string;
}

/**
 * Public shape: identity + lifecycle. The public key itself is never returned — only its
 * fingerprint, which is safe to log and display.
 */
export function serializeAgent(row: AgentRow): Record<string, unknown> {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    name: row.name ?? "",
    description: row.description ?? "",
    status: row.status ?? "active",
    parent_agent_id: row.parentAgentId,
    project_id: row.projectId,
    environment: row.environment,
    key_fingerprint: row.keyFingerprint,
    framework: row.framework,
    model: row.model,
    version: row.version ?? 1,
    last_seen_at: row.lastSeenAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function createAgent(
  db: Db,
  userId: string,
  workspaceId: string,
  input: CreateAgentInput,
): ServiceResult<Record<string, unknown>> {
  const name = (input.name ?? "").trim();
  if (!name || name.length > AGENT_NAME_MAX) {
    throw createError(400, "Agent name is required (1-64 characters)");
  }

  const description = (input.description ?? "").trim();
  if (description.length > AGENT_DESCRIPTION_MAX) {
    throw createError(400, "Description must be under 500 characters");
  }

  // The DB CHECK would 500 on anything else — validate here for a 400.
  const environment = (input.environment ?? "").trim().toLowerCase() || null;
  if (environment !== null && !(AGENT_ENVIRONMENTS as readonly string[]).includes(environment)) {
    throw createError(400, "Environment must be dev, staging, or prod");
  }

  const projectId = (input.project_id ?? "").trim() || null;
  const parentId = (input.parent_agent_id ?? "").trim() || null;

  if (parentId) {
    const parent = db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, parentId), eq(agents.workspaceId, workspaceId)))
      .limit(1)
      .get();
    // 404 either way: never confirm whether an id exists elsewhere.
    if (!parent) throw createError(404, "Parent agent not found");
  }

  const publicKey = (input.public_key ?? "").trim() || null;
  let keyFingerprint: string | null = null;
  if (publicKey !== null) {
    if (publicKey.length > AGENT_PUBLIC_KEY_MAX) {
      throw createError(400, "Public key is too long");
    }
    // Local SHA-256 identifier (not an RFC 7638 JWK thumbprint). Displayed as "key …abcd".
    keyFingerprint = createHash("sha256").update(publicKey, "utf8").digest("hex");
  }

  const now = new Date().toISOString();
  const agentId = `ag_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

  db.insert(agents)
    .values({
      id: agentId,
      workspaceId,
      userId,
      name,
      description,
      status: "active",
      parentAgentId: parentId,
      projectId,
      environment,
      publicKey,
      keyFingerprint,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const row = db.select().from(agents).where(eq(agents.id, agentId)).limit(1).get();
  return { data: serializeAgent(row!), message: "Agent created" };
}

export function listAgents(db: Db, workspaceId: string): Record<string, unknown>[] {
  return db
    .select()
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), ne(agents.status, AGENT_STATUS_ARCHIVED)))
    .orderBy(desc(agents.createdAt))
    .all()
    .map(serializeAgent);
}

/**
 * Soft delete: retire the identity without touching its recorded runs, versions, or audit.
 * Archiving is idempotent, and an agent outside the caller's workspace reads as 404 either way.
 */
export function archiveAgent(
  db: Db,
  workspaceId: string,
  agentId: string,
): ServiceResult<Record<string, unknown>> {
  let row = db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .limit(1)
    .get();

  if (!row) throw createError(404, "Agent not found");

  if (row.status !== AGENT_STATUS_ARCHIVED) {
    db.update(agents)
      .set({ status: AGENT_STATUS_ARCHIVED, updatedAt: new Date().toISOString() })
      .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
      .run();

    row = db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
      .limit(1)
      .get();
  }

  return { data: serializeAgent(row!), message: "Agent archived" };
}
