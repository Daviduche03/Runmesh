/**
 * Managed tool calls: the enforced path.
 *
 * Two shapes, one authorization path. `invoke` builds the request from the registry
 * (url + method) and the call's args; `forward` carries the caller's own request with the
 * credential injected, pinned to the registry's `base_url`. In both, policy decides against
 * a context built from the registry and the live request, the connection's credential is
 * decrypted in memory and never returned, and responses are scrubbed of the injected
 * secret. Local tools never reach this module: they run in the caller's process.
 */
import createError from "http-errors";
import { createHash, randomUUID } from "node:crypto";
import { config } from "../../core/config.js";
import type { Db } from "../../core/db/client.js";
import {
  ConnectAppModel,
  ConnectAppUserModel,
  ConnectGrantModel,
  ConnectUserModel,
} from "../../core/db/orm.js";
import type { ConnectGrantRow } from "../../core/db/orm.js";
import { agentEvents, agents, agentRuns, connectConnections, connectGrants, connectSessions, idempotencyKeys, tools } from "../../core/db/schema.js";
import type { tools as toolsTable } from "../../core/db/schema.js";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { resolveWorkspaceId } from "../workspace/index.js";
import { enforceGrantIssuance, recordDecision } from "../policies/service.js";
import type { EnforceGrantIssuanceResult } from "../policies/service.js";
import type { FetchLike } from "../webhooks/index.js";
import { recordAuditEvent } from "../connect/audit.js";
import { ensureWorkspaceApp } from "../connect/apps.js";
import { createGrant } from "../connect/grants.js";
import { decryptConnectSecret } from "../connect/crypto.js";
import {
  normalizeRequestedScopes,
  parseConnectProvider,
} from "../connect/providers.js";
import { createConnectSession } from "../connect/sessions.js";
import { redactSecrets } from "./redact.js";

export const RESPONSE_MAX = 8000;
export const UPSTREAM_TIMEOUT_S = 30;
export const BODY_MAX = 262144;
export const HEADER_MAX = 40;
export const HEADER_VALUE_MAX = 4096;

export const FORWARD_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-authenticate",
  "authorization",
]);

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export type ToolRow = typeof toolsTable.$inferSelect;

function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [];
    }
  }
  return [];
}

function stringLeaves(value: unknown): Set<string> {
  const leaves = new Set<string>();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const item of Object.values(value)) {
      for (const leaf of stringLeaves(item)) leaves.add(leaf);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      for (const leaf of stringLeaves(item)) leaves.add(leaf);
    }
  } else if (typeof value === "string" && value.trim()) {
    leaves.add(value.trim().toLowerCase());
  }
  return leaves;
}

/**
 * A resource-restricted grant covers only calls that name an allowed resource. If the call
 * names none it cannot be verified, so it is refused.
 */
export function resourceAllowed(filters: unknown, resource: string): boolean {
  if (!filters) return true;
  if (!resource.trim()) return false;
  return stringLeaves(filters).has(resource.trim().toLowerCase());
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object" && value.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Bind an idempotency key to the request it was first used for. */
export function requestFingerprint(toolRef: string, args: unknown): string {
  const canonical = stableStringify({ ref: toolRef || "", args: args ?? {} });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function scrubToken(text: string, token: string): string {
  if (!token) return text;
  return text.split(token).join("[REDACTED]");
}

export function injectAuth(
  headers: Record<string, string>,
  tool: { authScheme: string | null; authHeader: string | null; authFormat: string | null },
  token: string,
): Record<string, string> {
  const scheme = (tool.authScheme || "none").toLowerCase();
  if (scheme === "bearer" || scheme === "api_key" || scheme === "basic") {
    const header = tool.authHeader || "Authorization";
    const template = tool.authFormat || "Bearer {token}";
    headers[header] = template.split("{token}").join(token);
  }
  return headers;
}

/** Forward the caller's headers minus hop-by-hop and any auth they sent. */
export function sanitizeHeaders(
  raw: unknown,
  _tool: Pick<ToolRow, "id">,
): Record<string, string> {
  void _tool;
  const headers: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, HEADER_MAX)) {
      const name = String(key).trim();
      if (!name || name.length > 128 || name.includes("\n") || name.includes("\r")) continue;
      if (HOP_BY_HOP.has(name.toLowerCase())) continue;
      headers[name] = String(value).slice(0, HEADER_VALUE_MAX);
    }
  }
  return headers;
}

export function forwardBody(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") return JSON.stringify(raw).slice(0, BODY_MAX);
  return String(raw).slice(0, BODY_MAX);
}

export function forwardUrl(
  tool: Pick<ToolRow, "baseUrl">,
  path: string,
  query: unknown,
): string {
  const baseUrl = tool.baseUrl;
  if (!baseUrl) {
    throw createError(400, "Tool has no base_url; register it with baseUrl");
  }
  const clean = (path || "").trim();
  if (!clean.startsWith("/") || clean.startsWith("//")) {
    throw createError(400, "path must be absolute and start with a single '/'");
  }
  if (clean.includes("\n") || clean.includes("\r") || clean.includes(" ")) {
    throw createError(400, "path contains illegal characters");
  }
  const url = baseUrl.replace(/\/+$/, "") + clean;
  // Path-relative by construction; assert the host anyway so a malformed
  // base_url can never turn this into an arbitrary-host request.
  const resolvedHost = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const baseHost = (() => {
    try {
      return new URL(baseUrl).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (resolvedHost !== baseHost) {
    throw createError(400, "resolved host does not match the tool's base_url");
  }
  if (query && typeof query === "object" && !Array.isArray(query) && Object.keys(query).length > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
      params.append(key, String(value));
    }
    return `${url}${url.includes("?") ? "&" : "?"}${params.toString()}`;
  }
  return url;
}

interface AgentRunRow {
  id: string;
  agentId: string;
  workspaceId: string;
  [key: string]: unknown;
}

function resolveToolAndRun(
  db: Db,
  workspaceId: string,
  ref: string,
  runIdRaw: string,
): { tool: ToolRow; run: AgentRunRow; agentName: string; runId: string } {
  const tool =
    db.select().from(tools).where(and(eq(tools.id, ref), eq(tools.workspaceId, workspaceId))).limit(1).get() ?? null;
  if (!tool) throw createError(404, "Tool not found");
  if (tool.kind !== "managed") {
    throw createError(400, "Tool is not managed; local tools run in-process");
  }
  const runId = (runIdRaw || "").trim();
  if (!runId) throw createError(400, "run_id is required");
  const run =
    db.select().from(agentRuns).where(and(eq(agentRuns.id, runId), eq(agentRuns.workspaceId, workspaceId))).limit(1).get() ?? null;
  if (!run) throw createError(404, "Run not found");
  const agent =
    db.select().from(agents).where(eq(agents.id, run.agentId)).limit(1).get() ?? null;
  return { tool, run: run as AgentRunRow, agentName: agent?.name || run.agentId, runId };
}

function recordEvent(
  db: Db,
  input: {
    workspaceId: string;
    runId: string;
    kind: string;
    name: string;
    args: unknown;
    result: unknown;
    durationMs: number;
    connectUserId?: string | null;
  },
): void {
  const existing = db
    .select({ seq: agentEvents.seq })
    .from(agentEvents)
    .where(eq(agentEvents.runId, input.runId))
    .all();
  const seq = existing.reduce((max, row) => Math.max(max, row.seq ?? 0), 0) + 1;
  db.insert(agentEvents)
    .values({
      id: `evt_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      workspaceId: input.workspaceId,
      runId: input.runId,
      seq,
      kind: input.kind,
      name: input.name,
      args: JSON.stringify(redactSecrets(input.args ?? {})).slice(0, RESPONSE_MAX),
      result: JSON.stringify(redactSecrets(input.result ?? {})).slice(0, RESPONSE_MAX),
      truncated: 0,
      durationMs: input.durationMs,
      createdAt: new Date().toISOString(),
      connectUserId: input.connectUserId ?? null,
    })
    .run();
}

/** A ledger write that fails must never veto execution. */
function kept(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

interface RefusalInput {
  workspaceId: string;
  tool: ToolRow;
  run: AgentRunRow;
  agentName: string;
  connectUserId: string | null;
  userLabel: string;
  runId: string;
  resource: string;
  decision: string;
  reason: string;
}

function refusal(db: Db, input: RefusalInput): Record<string, unknown> {
  // Capture the id directly: the audit row below chains to the run through it. A ledger
  // failure still never vetoes the refusal itself.
  let decisionId: string | null = null;
  try {
    decisionId = recordDecision(db, {
      workspaceId: input.workspaceId,
      ruleId: null,
      decision: input.decision,
      mode: "none",
      enforced: true,
      defaultApplied: false,
      context: {
        action: input.tool.action || "",
        scope: "",
        resource: input.resource,
        agent: input.agentName,
        user: input.userLabel,
      },
      agentId: input.run.agentId,
      agentLabel: input.agentName,
      connectUserId: input.connectUserId,
      userLabel: input.userLabel,
      source: "call",
      reason: input.reason,
      enforcement: "proxied",
      runId: input.runId,
    });
  } catch {
    decisionId = null;
  }
  let ledgerOk = decisionId !== null;
  // A refusal is an enforced block: it must appear in the audit thread like any other
  // policy decision, chained to the run via decision_id.
  if (decisionId) {
    const captured = decisionId;
    ledgerOk =
      kept(() =>
        recordAuditEvent(db, {
          eventType: "policy.decision",
          actorType: "system",
          actorId: input.run.agentId || input.connectUserId || "policy",
          connectUserId: input.connectUserId,
          resourceType: "connect_policy",
          resourceId: "",
          agentId: input.run.agentId,
          result: input.decision === "deny" ? "denied" : "success",
          workspaceId: input.workspaceId,
          denialReason: input.reason,
          metadata: {
            decision: input.decision,
            decision_id: captured,
            rule_id: null,
            rule_name: null,
            action: input.tool.action || "",
            scope: "",
            source: "call",
            default_applied: false,
            reason: input.reason,
          },
        }),
      ) && ledgerOk;
  }
  return { decision: input.decision, reason: input.reason, rule: null, ledger_ok: ledgerOk };
}

interface ConsentUrlInput {
  provider: string;
  connection: Record<string, unknown> | null;
  agentId: string | null;
  reauth?: boolean;
}

async function connectSessionUrl(
  db: Db,
  workspaceId: string,
  userId: string,
  provider: string,
  connection: Record<string, unknown>,
  connectUserId: string,
  mode: string,
): Promise<string | null> {
  const publicBase = config.publicUrl.replace(/\/+$/, "");
  const frontend = config.frontendUrl.replace(/\/+$/, "");

  // Reuse an open session for this account/provider/mode: repeated consent
  // answers must not spam sessions.
  const now = new Date().toISOString();
  const reuse =
    db
      .select()
      .from(connectSessions)
      .where(
        and(
          eq(connectSessions.workspaceId, workspaceId),
          eq(connectSessions.connectUserId, connectUserId),
          eq(connectSessions.provider, provider),
          eq(connectSessions.mode, mode),
          eq(connectSessions.status, "pending"),
          sql`${connectSessions.expiresAt} > ${now}`,
        ),
      )
      .limit(1)
      .get() ?? null;
  if (reuse) return `${publicBase}/connect/authorize?state=${reuse.state}`;

  let app = new ConnectAppModel(db).findByWorkspace(workspaceId);
  if (!app) app = ensureWorkspaceApp(db, workspaceId, userId);

  // The session must carry an external_user_id the app already maps to this
  // connect user — never clobbering a mapping that already exists.
  const appUserModel = new ConnectAppUserModel(db);
  const connectionId = String(connection.id ?? "");
  const linked = appUserModel.findByExternalUser(app.id, connectionId);
  let externalUserId: string;
  if (linked && linked.connectUserId === connectUserId) {
    externalUserId = connectionId;
  } else {
    const canonical = appUserModel.findByConnectUser(app.id, connectUserId);
    if (canonical) {
      externalUserId = canonical.externalUserId;
    } else {
      appUserModel.linkUser(app.id, connectionId, connectUserId);
      externalUserId = connectionId;
    }
  }

  let scopes: string[] = [];
  if (mode === "connect") {
    scopes = normalizeRequestedScopes(parseConnectProvider(provider), parseScopes(connection.scopes));
    if (scopes.length === 0) return null;
  }

  const session = await createConnectSession(
    db,
    {
      mode,
      redirectUri: `${frontend}/connect`,
      externalUserId,
      connectUserId,
      provider,
      scopes,
    },
    userId,
    publicBase,
    workspaceId,
  );
  const authorizeUrl = (session as Record<string, unknown>).authorize_url;
  return typeof authorizeUrl === "string" ? authorizeUrl : null;
}

/**
 * Where this consent can be resolved. Never raises: a consent without a usable resume
 * path still returns its reason, just without a URL.
 *
 * - An approval already waiting → the Grants page (operator approves).
 * - Connection alive but no grant → end-user consent page (Connect providers)
 *   or a pending grant for the operator (everything else).
 * - Dead credential → re-run the OAuth connect for that provider.
 * - No connection → no identity to start from: no URL yet.
 */
export async function consentUrl(
  db: Db,
  workspaceId: string,
  userId: string,
  input: ConsentUrlInput,
): Promise<string | null> {
  try {
    const { provider, connection, agentId, reauth } = input;
    if (!connection) return null;
    const frontend = config.frontendUrl.replace(/\/+$/, "");
    const publicBase = config.publicUrl.replace(/\/+$/, "");
    if (!frontend) return null;
    const connectUserId = connection.connectUserId;
    if (typeof connectUserId !== "string" || !connectUserId) return null;

    if (!reauth) {
      const conditions = [
        eq(connectGrants.workspaceId, workspaceId),
        eq(connectGrants.connectionId, String(connection.id ?? "")),
        eq(connectGrants.status, "active"),
        eq(connectGrants.approvalStatus, "pending_approval"),
      ];
      if (agentId) {
        conditions.push(or(eq(connectGrants.agentId, agentId), isNull(connectGrants.agentId))!);
      } else {
        conditions.push(isNull(connectGrants.agentId));
      }
      const pending =
        db.select().from(connectGrants).where(and(...conditions)).limit(1).get() ?? null;
      if (pending) return `${frontend}/grants`;
    }

    let connectProvider = false;
    try {
      parseConnectProvider(provider);
      connectProvider = true;
    } catch {
      connectProvider = false;
    }

    let url: string | null = null;
    if (connectProvider && publicBase) {
      try {
        url = await connectSessionUrl(
          db,
          workspaceId,
          userId,
          provider,
          connection,
          connectUserId,
          reauth ? "connect" : "grant",
        );
      } catch {
        // Session mint can legitimately fail (provider not enabled, identity not
        // verified): fall through to a pending grant instead of losing the
        // consent resume path entirely.
        url = null;
      }
    }
    if (url) return url;
    if (reauth) return null;

    // Not Connect-manageable (or the session could not be minted): ask the
    // operator for a grant instead of leaving the consent a dead end.
    const scopes = parseScopes(connection.scopes);
    createGrant(
      db,
      {
        connectionId: String(connection.id ?? ""),
        agentId,
        scopes: scopes.length > 0 ? scopes : [provider || ""],
        approvalStatus: "pending_approval",
      },
      userId,
      workspaceId,
    );
    return `${frontend}/grants`;
  } catch {
    return null;
  }
}

interface PrepareCallInput {
  workspaceId: string;
  tool: ToolRow;
  run: AgentRunRow;
  agentName: string;
  runId: string;
  userId: string;
  connectUserId?: string | null;
  resource: string;
  fetchImpl?: FetchLike;
}

/**
 * Resolve credential + policy. Returns `{ early }` to stop with a decision payload, or
 * `{ token, connectUserId, userLabel, ledgerOk }` to proceed with the call.
 */
export async function prepareCall(
  db: Db,
  input: PrepareCallInput,
): Promise<
  | { early: Record<string, unknown> }
  | { token: string; connectUserId: string | null; userLabel: string; ledgerOk: boolean }
> {
  const { workspaceId, tool, run, agentName, runId, userId } = input;
  const resource = input.resource ?? "";
  const connectUserId = input.connectUserId ?? null;
  const provider = tool.provider;
  let ledgerOk = true;

  const connConditions = [
    eq(connectConnections.workspaceId, workspaceId),
    eq(connectConnections.provider, provider ?? ""),
    eq(connectConnections.status, "active"),
  ];
  if (connectUserId) {
    connConditions.push(eq(connectConnections.connectUserId, connectUserId));
  } else {
    const peers = db.select().from(connectConnections).where(and(...connConditions)).all();
    if (peers.length > 1) {
      throw createError(
        400,
        `Multiple active ${provider} connections; specify connect_user_id`,
      );
    }
  }
  const connection =
    db.select().from(connectConnections).where(and(...connConditions)).limit(1).get() ?? null;

  const grantModel = new ConnectGrantModel(db);

  if (!connection) {
    ledgerOk =
      kept(() =>
        recordDecision(db, {
          workspaceId,
          ruleId: null,
          decision: "consent",
          mode: "none",
          enforced: false,
          defaultApplied: false,
          context: {
            action: tool.action || "",
            scope: "",
            resource: "",
            agent: agentName,
            user: "",
          },
          agentId: run.agentId,
          agentLabel: agentName,
          source: "call",
          reason: `No active ${provider} connection for this user.`,
          enforcement: "proxied",
          runId,
        }),
      ) && ledgerOk;
    return {
      early: {
        decision: "consent",
        provider,
        reason: `Connect ${provider} to let this agent act on your behalf.`,
        consent_url: null,
        ledger_ok: ledgerOk,
      },
    };
  }

  const connectionId = connection.id;
  const cid = connection.connectUserId;
  const connectUser = cid ? new ConnectUserModel(db).findById(cid) : null;
  const userLabel =
    connectUser?.primaryEmail ?? connection.providerAccountLabel ?? "";
  const scopes = parseScopes(connection.scopes);

  let outcome: EnforceGrantIssuanceResult;
  try {
    outcome = enforceGrantIssuance(db, {
      workspaceId,
      provider,
      scopes,
      resource,
      agentId: run.agentId,
      agentLabel: agentName,
      connectUserId: cid,
      userLabel,
      source: "call",
      restrictive: false,
      actionOverride: tool.action,
      enforcement: "proxied",
      runId,
      strictRecord: false,
    });
  } catch (err) {
    // An HTTP error from inside evaluation is a 500-class store problem (corrupt rule
    // JSON). Fail closed, never a raw 500.
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number" && status < 500) throw err;
    return {
      early: {
        decision: "deny",
        reason: "Policy evaluation failed; failing closed.",
        rule: null,
        ledger_ok: false,
      },
    };
  }
  ledgerOk = ledgerOk && (outcome.ledgerOk ?? true);

  if (outcome.decision !== "allow") {
    const payload: Record<string, unknown> = {
      decision: outcome.decision,
      reason: outcome.reason,
      rule: outcome.rule?.name ?? null,
      ledger_ok: ledgerOk,
    };
    if (outcome.decision === "consent") payload.consent_url = null;
    return { early: payload };
  }

  // The grant is the agent's authority. Without one there is nothing to exercise.
  const grant = resolveGrant(db, workspaceId, connectionId, run.agentId);
  if (!grant) {
    ledgerOk =
      kept(() =>
        recordDecision(db, {
          workspaceId,
          ruleId: null,
          decision: "consent",
          mode: "none",
          enforced: false,
          defaultApplied: false,
          context: {
            action: tool.action || "",
            scope: "",
            resource,
            agent: agentName,
            user: userLabel,
          },
          agentId: run.agentId,
          agentLabel: agentName,
          connectUserId: cid,
          userLabel,
          source: "call",
          reason: `No grant covers ${agentName} on this connection.`,
          enforcement: "proxied",
          runId,
        }),
      ) && ledgerOk;
    const url = await consentUrl(db, workspaceId, userId, {
      provider: provider ?? "",
      connection: connection as unknown as Record<string, unknown>,
      agentId: run.agentId,
    });
    return {
      early: {
        decision: "consent",
        provider,
        reason: `Grant ${provider} access to this agent before it can act.`,
        consent_url: url,
        ledger_ok: ledgerOk,
      },
    };
  }

  const now = new Date().toISOString();
  if (grant.validUntil && grant.validUntil <= now) {
    return {
      early: refusal(db, {
        workspaceId, tool, run, agentName,
        connectUserId: cid, userLabel, runId, resource,
        decision: "deny", reason: "The grant has expired.",
      }),
    };
  }
  const maxUses = grant.maxUses;
  const useCount = grant.useCount ?? 0;
  if (maxUses !== null && maxUses !== undefined && useCount >= maxUses) {
    return {
      early: refusal(db, {
        workspaceId, tool, run, agentName,
        connectUserId: cid, userLabel, runId, resource,
        decision: "deny", reason: "The grant has no uses left.",
      }),
    };
  }
  if (!resourceAllowed(grant.resourceFilters, resource)) {
    return {
      early: refusal(db, {
        workspaceId, tool, run, agentName,
        connectUserId: cid, userLabel, runId, resource,
        decision: "deny", reason: "The grant does not cover this resource.",
      }),
    };
  }

  const token = decryptConnectSecret(connection.accessTokenEnc, config.jwtSecret);
  if (!token) {
    // Before the use is reserved: a reconnect prompt must not consume one.
    const url = await consentUrl(db, workspaceId, userId, {
      provider: provider ?? "",
      connection: connection as unknown as Record<string, unknown>,
      agentId: run.agentId,
      reauth: true,
    });
    return {
      early: {
        decision: "consent",
        provider,
        reason: `The ${provider} connection has no usable credential; reconnect it.`,
        consent_url: url,
        ledger_ok: ledgerOk,
      },
    };
  }

  // Reserve a use. Best-effort so a counter write cannot veto an allowed call,
  // but the outcome is reported in ledger_ok.
  try {
    grantModel.updateGrant(grant.id, { useCount: useCount + 1 });
  } catch {
    ledgerOk = false;
  }

  return { token, connectUserId: cid, userLabel, ledgerOk };
}

/** An agent-specific grant wins; otherwise the connection-wide (agent-less) grant. */
function resolveGrant(
  db: Db,
  workspaceId: string,
  connectionId: string,
  agentId: string | null,
): ConnectGrantRow | null {
  const base = [
    eq(connectGrants.workspaceId, workspaceId),
    eq(connectGrants.connectionId, connectionId),
    eq(connectGrants.status, "active"),
    eq(connectGrants.approvalStatus, "approved"),
  ];
  if (agentId) {
    const specific =
      db
        .select()
        .from(connectGrants)
        .where(and(...base, eq(connectGrants.agentId, agentId)))
        .limit(1)
        .get() ?? null;
    if (specific) {
      return {
        ...specific,
        scopes: parseScopes(specific.scopes),
        resourceFilters: parseGrantFilters(specific.resourceFilters),
      };
    }
  }
  const generic =
    db
      .select()
      .from(connectGrants)
      .where(and(...base, isNull(connectGrants.agentId)))
      .limit(1)
      .get() ?? null;
  if (!generic) return null;
  return {
    ...generic,
    scopes: parseScopes(generic.scopes),
    resourceFilters: parseGrantFilters(generic.resourceFilters),
  };
}

function parseGrantFilters(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

interface IdempotentHit {
  [key: string]: unknown;
}

function idempotentHit(
  db: Db,
  workspaceId: string,
  key: string | null | undefined,
  fingerprint?: string | null,
): Record<string, unknown> | null {
  if (!key) return null;
  const hit =
    db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.workspaceId, workspaceId), eq(idempotencyKeys.key, key)))
      .limit(1)
      .get() ?? null;
  if (!hit) return null;
  let cached: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(hit.response || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    cached = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (Object.keys(cached).length === 0) return null;
  cached = { ...cached };
  const storedFp = cached._idem_fp;
  delete cached._idem_fp;
  if (fingerprint != null && storedFp != null && storedFp !== fingerprint) {
    throw createError(400, "idempotency key already used for a different request");
  }
  cached.idempotent_replay = true;
  return cached;
}

function idempotentStore(
  db: Db,
  workspaceId: string,
  key: string | null | undefined,
  payload: Record<string, unknown>,
  fingerprint?: string | null,
): Record<string, unknown> | null {
  if (!key) return null;
  try {
    const stored: Record<string, unknown> = { ...payload };
    if (fingerprint != null) stored._idem_fp = fingerprint;
    db.insert(idempotencyKeys)
      .values({
        workspaceId,
        key,
        status: Number(payload.status ?? 0),
        response: JSON.stringify(stored).slice(0, RESPONSE_MAX),
        createdAt: new Date().toISOString(),
      })
      .run();
    return null;
  } catch {
    // Lost a race: the winner's cached response is authoritative.
    return idempotentHit(db, workspaceId, key, fingerprint);
  }
}

interface ExecuteInput {
  workspaceId: string;
  runId: string;
  tool: ToolRow;
  requestArgs: Record<string, unknown>;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  token: string;
  idemKey: string | null;
  ledgerOk: boolean;
  fingerprint?: string | null;
  connectUserId?: string | null;
  fetchImpl?: FetchLike;
}

async function executeAndRecord(
  db: Db,
  input: ExecuteInput,
): Promise<Record<string, unknown>> {
  const started = new Date().toISOString();
  // Managed tools skip the SDK's local interpose: record the attempt here so the thread
  // has a tool.call before tool.result/error. The principal is the connection identity
  // actually used, not the run's.
  let ledgerOk =
    kept(() =>
      recordEvent(db, {
        workspaceId: input.workspaceId,
        runId: input.runId,
        kind: "tool.call",
        name: input.tool.name,
        args: input.requestArgs,
        result: {},
        durationMs: 0,
        connectUserId: input.connectUserId,
      }),
    ) && input.ledgerOk;

  const fetchImpl = input.fetchImpl ?? defaultFetch;
  let status: number;
  let text: string;
  try {
    const response = await fetchImpl(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_S * 1000),
      redirect: "follow",
    });
    status = Number(response.status ?? 0);
    text = await response.text();
  } catch (err) {
    // Network/upstream failure is not a policy denial.
    ledgerOk =
      kept(() =>
        recordEvent(db, {
          workspaceId: input.workspaceId,
          runId: input.runId,
          kind: "error",
          name: input.tool.name,
          args: input.requestArgs,
          result: { message: String(err) },
          durationMs: 0,
          connectUserId: input.connectUserId,
        }),
      ) && ledgerOk;
    const result = { error: "upstream_unreachable", message: String(err) };
    return {
      decision: "allow",
      status: 502,
      upstream_error: true,
      result,
      body: JSON.stringify(result),
      ledger_ok: ledgerOk,
    };
  }

  const scrubbed = scrubToken(text, input.token).slice(0, RESPONSE_MAX);
  const truncated = scrubToken(text, input.token).length > RESPONSE_MAX;
  let result: unknown;
  try {
    result = JSON.parse(scrubbed);
  } catch {
    result = { body: scrubbed };
  }
  if (truncated) result = { truncated: true, body: result };

  let durationMs = 0;
  try {
    durationMs = Math.trunc(Date.parse(new Date().toISOString()) - Date.parse(started));
  } catch {
    durationMs = 0;
  }
  // The side effect already happened: a ledger failure here must not turn a success
  // into a 500. Flag it and return the result.
  ledgerOk =
    kept(() =>
      recordEvent(db, {
        workspaceId: input.workspaceId,
        runId: input.runId,
        kind: "tool.result",
        name: input.tool.name,
        args: input.requestArgs,
        result,
        durationMs,
        connectUserId: input.connectUserId,
      }),
    ) && ledgerOk;

  const payload: Record<string, unknown> = {
    decision: "allow",
    status,
    upstream_error: status >= 400,
    result,
    body: scrubbed,
    ledger_ok: ledgerOk,
  };
  const raced = idempotentStore(
    db,
    input.workspaceId,
    input.idemKey,
    payload,
    input.fingerprint ?? requestFingerprint(input.tool.id || input.tool.name, input.requestArgs),
  );
  return raced ?? payload;
}

/** Registered tools in this workspace: the formal action vocabulary. */
export function listTools(
  db: Db,
  userId: string,
  workspaceId?: string | null,
): Array<{ id: string; name: string; action: string; kind: string; provider: string }> {
  const workspace = resolveWorkspaceId(db, userId, workspaceId ?? null);
  return db
    .select()
    .from(tools)
    .where(eq(tools.workspaceId, workspace))
    .orderBy(asc(tools.name))
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name || row.id,
      action: row.action || "",
      kind: row.kind || "local",
      provider: row.provider || "",
    }));
}

export interface InvokeToolInput {
  userId: string;
  workspaceId?: string | null;
  ref: string;
  runId: string;
  args?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  connectUserId?: string | null;
  fetchImpl?: FetchLike;
}

export async function invokeTool(
  db: Db,
  input: InvokeToolInput,
): Promise<Record<string, unknown>> {
  const workspaceId = resolveWorkspaceId(db, input.userId, input.workspaceId ?? null);
  const { tool, run, agentName, runId } = resolveToolAndRun(db, workspaceId, input.ref, input.runId);

  const args = input.args && typeof input.args === "object" ? input.args : {};
  const resource =
    tool.resourceParam && typeof args[tool.resourceParam] !== "undefined"
      ? String(args[tool.resourceParam] ?? "")
      : "";

  // Replay check first: a retry must not reserve a second grant use.
  const idemKey = (input.idempotencyKey || "").trim() || null;
  const fpHit = idemKey ? requestFingerprint(tool.id || tool.name, args) : null;
  const cached = idempotentHit(db, workspaceId, idemKey, fpHit);
  if (cached) return cached;

  const prep = await prepareCall(db, {
    workspaceId,
    tool,
    run,
    agentName,
    runId,
    userId: input.userId,
    connectUserId: input.connectUserId,
    resource,
    fetchImpl: input.fetchImpl,
  });
  if ("early" in prep) return prep.early;

  let url = tool.url ?? "";
  const method = tool.method || "POST";
  const headers = injectAuth({ "Content-Type": "application/json" }, tool, prep.token);
  if (idemKey) headers["Idempotency-Key"] = idemKey;

  let body: string | null = null;
  if (method === "GET") {
    if (Object.keys(args).length > 0) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(args)) params.append(key, String(value));
      url = `${url}${url.includes("?") ? "&" : "?"}${params.toString()}`;
    }
  } else {
    body = JSON.stringify(args);
  }

  return executeAndRecord(db, {
    workspaceId,
    runId,
    tool,
    requestArgs: args,
    method,
    url,
    headers,
    body,
    token: prep.token,
    idemKey,
    ledgerOk: prep.ledgerOk,
    fingerprint: fpHit,
    connectUserId: prep.connectUserId,
    fetchImpl: input.fetchImpl,
  });
}

export interface ForwardToolInput {
  userId: string;
  workspaceId?: string | null;
  ref: string;
  method: string;
  path: string;
  headers?: Record<string, unknown> | null;
  body?: unknown;
  query?: Record<string, unknown> | null;
  runId?: string;
  idempotencyKey?: string | null;
  connectUserId?: string | null;
  fetchImpl?: FetchLike;
}

/** Forward the caller's own request with the credential injected. */
export async function forwardTool(
  db: Db,
  input: ForwardToolInput,
): Promise<Record<string, unknown>> {
  const workspaceId = resolveWorkspaceId(db, input.userId, input.workspaceId ?? null);
  const { tool, run, agentName, runId } = resolveToolAndRun(db, workspaceId, input.ref, input.runId ?? "");

  const verb = (input.method || "GET").trim().toUpperCase();
  if (!(FORWARD_METHODS as readonly string[]).includes(verb)) {
    throw createError(400, `method must be one of ${FORWARD_METHODS.join(", ")}`);
  }
  const url = forwardUrl(tool, input.path, input.query);

  // Replay check first: a retry must not reserve a second grant use.
  const idemKey = (input.idempotencyKey || "").trim() || null;
  const fpRequest = { method: verb, path: input.path, body: input.body ?? null, query: input.query ?? null };
  const fpHit = idemKey ? requestFingerprint(tool.id || tool.name, fpRequest) : null;
  const cached = idempotentHit(db, workspaceId, idemKey, fpHit);
  if (cached) return cached;

  const prep = await prepareCall(db, {
    workspaceId,
    tool,
    run,
    agentName,
    runId,
    userId: input.userId,
    connectUserId: input.connectUserId,
    resource: "",
    fetchImpl: input.fetchImpl,
  });
  if ("early" in prep) return prep.early;

  const outbound = injectAuth(sanitizeHeaders(input.headers, tool), tool, prep.token);
  if (!("Content-Type" in outbound)) outbound["Content-Type"] = "application/json";
  if (idemKey) outbound["Idempotency-Key"] = idemKey;

  return executeAndRecord(db, {
    workspaceId,
    runId,
    tool,
    requestArgs: { method: verb, path: input.path },
    method: verb,
    url,
    headers: outbound,
    body: forwardBody(input.body),
    token: prep.token,
    idemKey,
    ledgerOk: prep.ledgerOk,
    fingerprint: fpHit,
    connectUserId: prep.connectUserId,
    fetchImpl: input.fetchImpl,
  });
}
