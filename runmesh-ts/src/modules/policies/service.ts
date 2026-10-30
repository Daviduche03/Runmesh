/**
 * Policy rules: stored conditions in, decisions out.
 *
 * Rules are workspace-scoped, ordered (first match wins), and stored as JSON conditions. The
 * compiled Rego artifact is generated on read. Enforcement runs at grant issuance: the engine
 * decides before a grant is minted, and every decision is written to `policy_decisions` so
 * oversight metrics are real.
 *
 * The action identity is server-derived (see `engine.buildActionIdentity`). Requests never
 * supply the label used for a security decision.
 */
import { and, asc, desc, eq, ne } from "drizzle-orm";
import createError from "http-errors";
import type { Db } from "../../core/db/client.js";
import {
  agents,
  connectGrants,
  policyDecisions,
  policyRules,
  tools,
} from "../../core/db/schema.js";
import type { PolicyDecisionRow, PolicyRuleRow } from "../../core/db/orm.js";
import { isHttpError } from "../../core/http/errors.js";
import {
  AUDIT_ACTOR,
  AUDIT_EVENT,
  AUDIT_RESOURCE,
  CONNECT_PROVIDER_IDS,
  recordAuditEvent,
} from "../connect/index.js";
import {
  POLICY_ACTIONS,
  POLICY_FIELDS,
  POLICY_MODES,
  POLICY_OPERATORS,
  POLICY_REVERSIBILITY,
  buildGrantContext,
  changeHint,
  evaluate,
} from "./engine.js";
import type {
  PolicyAction,
  PolicyCondition,
  PolicyContext,
  PolicyEvaluation,
  PolicyRule,
} from "./engine.js";

export { changeHint };

export const POLICY_NAME_MAX = 80;
export const POLICY_DESCRIPTION_MAX = 500;
const DECISION_SCAN_LIMIT = 5000;

const newId = (prefix: string): string =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

export interface RuleMetrics {
  decided: number;
  escalated: number;
  approvals: number;
  rejections: number;
  medianReviewMs: number;
}

export interface RuleWire extends PolicyRule {
  description: string;
  scope: string;
  caps: Record<string, unknown>;
  reversibility: string;
  created_at: string;
  updated_at: string;
  rego: string;
  decided: number;
  escalated: number;
  approvals: number;
  rejections: number;
  medianReviewMs: number;
}

export interface ServiceResult<T> {
  data: T;
  message?: string;
}

function parseJsonList(value: unknown, field: string): unknown[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw createError(500, `Stored ${field} is not valid JSON`);
  }
  if (!Array.isArray(parsed)) throw createError(500, `Stored ${field} is not a list`);
  return parsed;
}

function parseJsonDict(value: unknown, field: string): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw createError(500, `Stored ${field} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw createError(500, `Stored ${field} is not an object`);
  }
  return parsed as Record<string, unknown>;
}

export function validateConditions(raw: unknown): PolicyCondition[] {
  const conditions = Array.isArray(raw) ? raw : parseJsonList(raw, "conditions");
  const cleaned: PolicyCondition[] = [];

  for (const condition of conditions) {
    let field = "action";
    let operator = "is";
    let value = "";

    if (condition && typeof condition === "object" && !Array.isArray(condition)) {
      const entry = condition as Record<string, unknown>;
      field = String(entry.field || "action");
      operator = String(entry.operator || "is");
      value = String(entry.value || "");
    }

    if (!(POLICY_FIELDS as readonly string[]).includes(field)) {
      throw createError(400, `Condition field must be one of: ${POLICY_FIELDS.join(", ")}`);
    }
    if (!(POLICY_OPERATORS as readonly string[]).includes(operator)) {
      throw createError(400, `Condition operator must be one of: ${POLICY_OPERATORS.join(", ")}`);
    }
    cleaned.push({ field, operator, value });
  }

  return cleaned;
}

/** Python's `json.dumps` escapes non-ASCII; keep the compiled artifact byte-identical. */
function pyJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

const REGO_OPERATORS: Record<string, string> = {
  is: "==",
  "is not": "!=",
  ">": ">",
  "<": "<",
  contains: "contains",
};

/** Compile stored conditions to the Rego artifact. */
export function ruleRego(rule: {
  priority?: number | null;
  name?: string | null;
  action?: string | null;
  conditions?: unknown;
}): string {
  const clauses: string[] = [];

  for (const raw of parseJsonList(rule.conditions, "conditions")) {
    const condition = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const field = String(condition.field || "action");
    const operator = String(condition.operator || "is");
    const value = String(condition.value || "");
    const target = field === "action" ? "input.tool.name" : `input.${field}`;
    const op = REGO_OPERATORS[operator] ?? "==";

    if (op === "contains") {
      clauses.push(`  contains(${target}, ${pyJson(value)})`);
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      clauses.push(`  ${target} ${op} ${value}`);
    } else {
      clauses.push(`  ${target} ${op} ${pyJson(value)}`);
    }
  }

  return (
    "package runmesh.policy\n\n" +
    "import rego.v1\n\n" +
    'default decision := {"decision": "deny", "reason": "no rule matched"}\n\n' +
    `# ${rule.priority ?? ""} · ${rule.name ?? ""}\n` +
    `decision := {"decision": ${pyJson(rule.action ?? null)}} if {\n` +
    `${clauses.join("\n")}\n` +
    "}\n"
  );
}

/** Rule shape the engine consumes: no metrics, no compiled artifact. */
export function baseRule(row: PolicyRuleRow): PolicyRule {
  return {
    id: row.id,
    priority: row.priority,
    name: row.name ?? "",
    description: row.description ?? "",
    enabled: Boolean(row.enabled),
    conditions: parseJsonList(row.conditions, "conditions") as PolicyCondition[],
    action: (row.action ?? "escalate") as PolicyAction,
    scope: row.scope ?? "all scopes",
    mode: (row.mode ?? "log-only") as PolicyRule["mode"],
    caps: parseJsonDict(row.caps, "caps"),
    reversibility: row.reversibility ?? "reversible",
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function serializeRule(row: PolicyRuleRow, metrics?: RuleMetrics): RuleWire {
  return {
    ...baseRule(row),
    decided: metrics?.decided ?? 0,
    escalated: metrics?.escalated ?? 0,
    approvals: metrics?.approvals ?? 0,
    rejections: metrics?.rejections ?? 0,
    medianReviewMs: metrics?.medianReviewMs ?? 0,
    rego: ruleRego(row),
  } as RuleWire;
}

function audited(
  db: Db,
  userId: string,
  workspaceId: string,
  ruleId: string,
  change: string,
): void {
  recordAuditEvent(db, {
    eventType: AUDIT_EVENT.POLICY_UPDATED,
    actorType: AUDIT_ACTOR.CONNECT_USER,
    actorId: userId,
    resourceType: AUDIT_RESOURCE.CONNECT_POLICY,
    resourceId: ruleId,
    result: "success",
    workspaceId,
    metadata: { change },
  });
}

/** Python's `round()` is half-to-even; JS `Math.round` is not. */
function pyRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

function millisBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const delta = Date.parse(end) - Date.parse(start);
  return Number.isNaN(delta) ? null : delta;
}

/** Oversight per rule, from real decisions and the grants they produced. */
function ruleMetrics(db: Db, workspaceId: string): Map<string, RuleMetrics> {
  const decisions = db
    .select()
    .from(policyDecisions)
    .where(eq(policyDecisions.workspaceId, workspaceId))
    .limit(DECISION_SCAN_LIMIT)
    .all();

  const grants = db
    .select({
      id: connectGrants.id,
      approvalStatus: connectGrants.approvalStatus,
      updatedAt: connectGrants.updatedAt,
    })
    .from(connectGrants)
    .where(eq(connectGrants.workspaceId, workspaceId))
    .limit(DECISION_SCAN_LIMIT)
    .all();

  const grantState = new Map(grants.map((grant) => [grant.id, grant]));

  const buckets = new Map<
    string,
    {
      decided: number;
      escalated: number;
      approvals: number;
      rejections: number;
      latencies: number[];
    }
  >();

  for (const decision of decisions) {
    if (!decision.ruleId) continue;

    let bucket = buckets.get(decision.ruleId);
    if (!bucket) {
      bucket = { decided: 0, escalated: 0, approvals: 0, rejections: 0, latencies: [] };
      buckets.set(decision.ruleId, bucket);
    }

    if (decision.enforced) {
      bucket.decided += 1;
      if (decision.decision === "escalate" || decision.decision === "consent") {
        bucket.escalated += 1;
      }
    }

    const grant = decision.grantId ? grantState.get(decision.grantId) : undefined;
    if (!grant) continue;

    if (grant.approvalStatus === "approved") {
      bucket.approvals += 1;
    } else if (grant.approvalStatus === "denied") {
      bucket.rejections += 1;
    } else {
      continue;
    }

    const delta = millisBetween(decision.createdAt, grant.updatedAt);
    if (delta !== null && delta >= 0) bucket.latencies.push(delta);
  }

  const out = new Map<string, RuleMetrics>();
  for (const [ruleId, bucket] of buckets) {
    const latencies = [...bucket.latencies].sort((left, right) => left - right);
    out.set(ruleId, {
      decided: bucket.decided,
      escalated: bucket.escalated,
      approvals: bucket.approvals,
      rejections: bucket.rejections,
      medianReviewMs: latencies.length > 0 ? pyRound(latencies[Math.floor(latencies.length / 2)]) : 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rules CRUD
// ---------------------------------------------------------------------------

export interface CreateRuleInput {
  name?: string | null;
  description?: string | null;
  conditions?: unknown;
  action?: string;
  scope?: string | null;
  mode?: string;
  caps?: Record<string, unknown> | null;
  reversibility?: string;
  enabled?: boolean;
}

export interface UpdateRuleInput {
  name?: string | null;
  description?: string | null;
  enabled?: boolean | null;
  conditions?: unknown;
  action?: string | null;
  scope?: string | null;
  mode?: string | null;
  caps?: Record<string, unknown> | null;
  reversibility?: string | null;
}

export function listRules(db: Db, workspaceId: string): RuleWire[] {
  const rows = db
    .select()
    .from(policyRules)
    .where(eq(policyRules.workspaceId, workspaceId))
    .orderBy(asc(policyRules.priority))
    .all();

  const metrics = ruleMetrics(db, workspaceId);
  return rows.map((row) => serializeRule(row, metrics.get(row.id)));
}

export function createRule(
  db: Db,
  userId: string,
  workspaceId: string,
  input: CreateRuleInput,
): ServiceResult<RuleWire> {
  const name = (input.name ?? "").trim();
  if (!name || name.length > POLICY_NAME_MAX) {
    throw createError(400, "Rule name is required (1-80 characters)");
  }

  const description = (input.description ?? "").trim();
  if (description.length > POLICY_DESCRIPTION_MAX) {
    throw createError(400, "Description must be under 500 characters");
  }

  const action = input.action ?? "escalate";
  if (!(POLICY_ACTIONS as readonly string[]).includes(action)) {
    throw createError(400, "Action must be allow, escalate, consent, or deny");
  }

  const mode = input.mode ?? "log-only";
  if (!(POLICY_MODES as readonly string[]).includes(mode)) {
    throw createError(400, "Mode must be enforce or log-only");
  }

  const reversibility = input.reversibility ?? "reversible";
  if (!(POLICY_REVERSIBILITY as readonly string[]).includes(reversibility)) {
    throw createError(
      400,
      "Reversibility must be reversible, undoable, or irreversible",
    );
  }

  const conditions = validateConditions(input.conditions ?? []);

  const existing = db
    .select({ priority: policyRules.priority })
    .from(policyRules)
    .where(eq(policyRules.workspaceId, workspaceId))
    .all();
  const priority = existing.reduce((max, row) => Math.max(max, row.priority), 0) + 1;

  const now = new Date().toISOString();
  const ruleId = newId("pol");

  db.insert(policyRules)
    .values({
      id: ruleId,
      workspaceId,
      priority,
      name,
      description,
      enabled: input.enabled ? 1 : 0,
      conditions: JSON.stringify(conditions),
      action,
      scope: (input.scope ?? "all scopes").trim() || "all scopes",
      mode,
      caps: JSON.stringify(input.caps ?? {}),
      reversibility,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  audited(db, userId, workspaceId, ruleId, `Created rule '${name}'.`);

  const row = db
    .select()
    .from(policyRules)
    .where(eq(policyRules.id, ruleId))
    .limit(1)
    .get();

  return { data: serializeRule(row!), message: "Policy rule created" };
}

function getOwnedRule(db: Db, workspaceId: string, ruleId: string): PolicyRuleRow {
  const row = db
    .select()
    .from(policyRules)
    .where(and(eq(policyRules.id, ruleId), eq(policyRules.workspaceId, workspaceId)))
    .limit(1)
    .get();

  // 404 either way: never confirm whether an id exists elsewhere.
  if (!row) throw createError(404, "Policy rule not found");
  return row;
}

export function updateRule(
  db: Db,
  userId: string,
  workspaceId: string,
  ruleId: string,
  input: UpdateRuleInput,
): ServiceResult<RuleWire> {
  const row = getOwnedRule(db, workspaceId, ruleId);
  const updates: Partial<typeof policyRules.$inferInsert> = {};

  if (input.name !== undefined && input.name !== null) {
    const name = input.name.trim();
    if (!name || name.length > POLICY_NAME_MAX) {
      throw createError(400, "Rule name is required (1-80 characters)");
    }
    updates.name = name;
  }

  if (input.description !== undefined && input.description !== null) {
    const description = input.description.trim();
    if (description.length > POLICY_DESCRIPTION_MAX) {
      throw createError(400, "Description must be under 500 characters");
    }
    updates.description = description;
  }

  if (input.enabled !== undefined && input.enabled !== null) {
    updates.enabled = input.enabled ? 1 : 0;
  }

  if (input.conditions !== undefined && input.conditions !== null) {
    updates.conditions = JSON.stringify(validateConditions(input.conditions));
  }

  if (input.action !== undefined && input.action !== null) {
    if (!(POLICY_ACTIONS as readonly string[]).includes(input.action)) {
      throw createError(400, "Action must be allow, escalate, consent, or deny");
    }
    updates.action = input.action;
  }

  if (input.scope !== undefined && input.scope !== null) {
    updates.scope = input.scope.trim() || "all scopes";
  }

  if (input.mode !== undefined && input.mode !== null) {
    if (!(POLICY_MODES as readonly string[]).includes(input.mode)) {
      throw createError(400, "Mode must be enforce or log-only");
    }
    updates.mode = input.mode;
  }

  if (input.caps !== undefined && input.caps !== null) {
    updates.caps = JSON.stringify(input.caps);
  }

  if (input.reversibility !== undefined && input.reversibility !== null) {
    if (!(POLICY_REVERSIBILITY as readonly string[]).includes(input.reversibility)) {
      throw createError(
        400,
        "Reversibility must be reversible, undoable, or irreversible",
      );
    }
    updates.reversibility = input.reversibility;
  }

  if (Object.keys(updates).length === 0) {
    return { data: serializeRule(row) };
  }

  updates.updatedAt = new Date().toISOString();
  db.update(policyRules).set(updates).where(eq(policyRules.id, ruleId)).run();

  audited(db, userId, row.workspaceId, ruleId, `Updated rule '${row.name}'.`);

  const updated = db
    .select()
    .from(policyRules)
    .where(eq(policyRules.id, ruleId))
    .limit(1)
    .get();

  return { data: serializeRule(updated!), message: "Policy rule updated" };
}

export function deleteRule(
  db: Db,
  userId: string,
  workspaceId: string,
  ruleId: string,
): ServiceResult<{ id: string }> {
  const row = getOwnedRule(db, workspaceId, ruleId);
  db.delete(policyRules).where(eq(policyRules.id, ruleId)).run();

  // Close the gap: renumber survivors so priority stays dense (first match wins).
  const survivors = db
    .select()
    .from(policyRules)
    .where(eq(policyRules.workspaceId, row.workspaceId))
    .orderBy(asc(policyRules.priority))
    .all();

  survivors.forEach((survivor, index) => {
    const priority = index + 1;
    if (survivor.priority === priority) return;
    db.update(policyRules)
      .set({ priority, updatedAt: new Date().toISOString() })
      .where(eq(policyRules.id, survivor.id))
      .run();
  });

  audited(db, userId, row.workspaceId, ruleId, `Deleted rule '${row.name}'.`);

  return { data: { id: ruleId }, message: "Policy rule deleted" };
}

export function reorderRules(
  db: Db,
  userId: string,
  workspaceId: string,
  ids: string[],
): ServiceResult<RuleWire[]> {
  const rows = db
    .select({ id: policyRules.id })
    .from(policyRules)
    .where(eq(policyRules.workspaceId, workspaceId))
    .all();

  const current = new Set(rows.map((row) => row.id));
  const requested = new Set(ids);
  const exact =
    ids.length === current.size &&
    requested.size === ids.length &&
    [...current].every((id) => requested.has(id));

  if (!exact) {
    throw createError(
      400,
      "ids must contain exactly the workspace's rule ids, in the new order",
    );
  }

  // Distinct negative temps first: UNIQUE(workspace_id, priority) forbids swaps in place.
  const now = new Date().toISOString();
  ids.forEach((ruleId, index) => {
    db.update(policyRules)
      .set({ priority: -(index + 1), updatedAt: now })
      .where(eq(policyRules.id, ruleId))
      .run();
  });
  ids.forEach((ruleId, index) => {
    db.update(policyRules)
      .set({ priority: index + 1, updatedAt: now })
      .where(eq(policyRules.id, ruleId))
      .run();
  });

  audited(db, userId, workspaceId, ids[0] ?? "-", "Reordered rules.");

  const ordered = db
    .select()
    .from(policyRules)
    .where(eq(policyRules.workspaceId, workspaceId))
    .orderBy(asc(policyRules.priority))
    .all();

  return {
    data: ordered.map((row) => serializeRule(row)),
    message: "Policy rules reordered",
  };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** Strictest wins when several candidates are evaluated (deny > escalate/consent > allow). */
const DECISION_RANK: Record<string, number> = { deny: 3, escalate: 2, consent: 2, allow: 0 };

/**
 * Rules in priority order, plus whether any enabled enforce rule exists.
 *
 * `configured` gates default-deny: a workspace that has not opted into policy keeps working
 * exactly as before.
 */
export function loadRules(db: Db, workspaceId: string): {
  rules: PolicyRule[];
  configured: boolean;
} {
  const rows = db
    .select()
    .from(policyRules)
    .where(eq(policyRules.workspaceId, workspaceId))
    .orderBy(asc(policyRules.priority))
    .all();

  const rules = rows.map(baseRule);
  const configured = rules.some(
    (rule) => rule.enabled && (rule.mode ?? "enforce") === "enforce",
  );
  return { rules, configured };
}

/**
 * Evaluate a request whose capability is one of several candidates.
 *
 * At issuance a grant requests a *set* of scopes, and the provider is the connection. So the
 * capability being decided is the provider plus each requested scope. Rules that match any
 * candidate decide; when none match, the provider candidate's result governs (which preserves
 * default-deny and coarse provider-level rules).
 */
export function evaluateCapabilities(
  rules: PolicyRule[],
  context: PolicyContext,
  candidates: unknown[],
): { context: PolicyContext; result: PolicyEvaluation } {
  const ordered: string[] = [];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (value && !ordered.includes(value)) ordered.push(value);
  }
  if (ordered.length === 0) ordered.push(String(context.action ?? ""));

  const evaluations = ordered.map((candidate) => {
    const candidateContext = { ...context, action: candidate };
    return { context: candidateContext, result: evaluate(rules, candidateContext) };
  });

  const settled = evaluations.filter((pair) => pair.result.settled);
  const pool = settled.length > 0 ? settled : [evaluations[0]];

  return pool.reduce((winner, pair) => {
    const rank = DECISION_RANK[pair.result.decision] ?? 0;
    const winnerRank = DECISION_RANK[winner.result.decision] ?? 0;
    return rank > winnerRank ? pair : winner;
  });
}

export interface RecordDecisionInput {
  workspaceId: string;
  ruleId?: string | null;
  decision: string;
  mode: string;
  enforced: boolean;
  defaultApplied: boolean;
  context: PolicyContext | Record<string, string>;
  agentId?: string | null;
  agentLabel?: string;
  connectUserId?: string | null;
  userLabel?: string;
  source?: string;
  grantId?: string | null;
  reason?: string;
  enforcement?: string;
  runId?: string | null;
}

export function recordDecision(db: Db, input: RecordDecisionInput): string {
  const decisionId = newId("pdec");

  db.insert(policyDecisions)
    .values({
      id: decisionId,
      workspaceId: input.workspaceId,
      ruleId: input.ruleId ?? null,
      decision: input.decision,
      mode: input.mode,
      enforced: input.enforced ? 1 : 0,
      defaultApplied: input.defaultApplied ? 1 : 0,
      enforcement: input.enforcement ?? "cooperative",
      action: String(input.context.action ?? ""),
      scope: String(input.context.scope ?? ""),
      resource: String(input.context.resource ?? ""),
      agentId: input.agentId ?? null,
      agentLabel: input.agentLabel ?? "",
      connectUserId: input.connectUserId ?? null,
      userLabel: input.userLabel ?? "",
      source: input.source ?? "grant",
      grantId: input.grantId ?? null,
      reason: input.reason ?? "",
      runId: input.runId ?? null,
      createdAt: new Date().toISOString(),
    })
    .run();

  return decisionId;
}

function decisionReason(
  decision: string,
  rule: PolicyRule | null,
  defaultApplied: boolean,
  configured: boolean,
): string {
  if (!configured) return "No enforcing rule configured; issuance proceeds.";
  if (defaultApplied) return "No enabled rule matched and policy is on; blocked by default.";
  if (rule === null) return `Policy decided ${decision}.`;

  const name = rule.name || rule.id || "";
  if (decision === "deny") return `${name} denies this.`;
  if (decision === "escalate") return `${name} requires a human before this runs.`;
  if (decision === "consent") return `${name} requires user consent.`;
  return `${name} allows this.`;
}

export interface EnforceGrantIssuanceInput {
  workspaceId: string;
  provider?: string | null;
  scopes?: unknown[] | null;
  resource?: string;
  agentId?: string | null;
  agentLabel?: string;
  connectUserId?: string | null;
  userLabel?: string;
  source?: string;
  restrictive?: boolean;
  grantId?: string | null;
  actionOverride?: string | null;
  enforcement?: string;
  runId?: string | null;
  strictRecord?: boolean;
}

export interface EnforceGrantIssuanceResult {
  decision: PolicyAction;
  rule: PolicyRule | null;
  enforced: boolean;
  defaultApplied: boolean;
  configured: boolean;
  blocks: boolean;
  reason: string;
  context: PolicyContext | Record<string, string>;
  decisionId: string | null;
  ledgerOk: boolean;
}

/**
 * Evaluate policy at issuance or on a tool call, and record every decision.
 *
 * Full mode (`restrictive: false`) applies the whole mapping: allow → auto-approve,
 * escalate/consent → pending, deny → block. Restrictive mode (the consent path) only blocks an
 * explicit enforced deny — the end user's act is the authority there, so policy may forbid but
 * never auto-approve.
 *
 * `actionOverride` carries the registry-derived action on the call path; it is server-owned
 * (from the tool row), never a caller-supplied string.
 *
 * With `strictRecord: false` the ledger writes (decision rows, audit) are best-effort: a
 * recording failure is flagged in `ledgerOk` but never vetoes the decision itself. The ledger
 * must not stop an allowed call.
 */
export function enforceGrantIssuance(
  db: Db,
  input: EnforceGrantIssuanceInput,
): EnforceGrantIssuanceResult {
  const workspaceId = input.workspaceId;
  const agentId = input.agentId ?? null;
  const agentLabel = input.agentLabel ?? "";
  const connectUserId = input.connectUserId ?? null;
  const userLabel = input.userLabel ?? "";
  const source = input.source ?? "grant";
  const enforcement = input.enforcement ?? "cooperative";
  const runId = input.runId ?? null;
  const grantId = input.grantId ?? null;
  const strictRecord = input.strictRecord ?? true;

  let context = buildGrantContext({
    provider: input.provider,
    scopes: input.scopes,
    resource: input.resource,
    agent: agentLabel,
    user: userLabel,
  });

  const { rules, configured } = loadRules(db, workspaceId);

  let candidates: unknown[];
  if (input.actionOverride) {
    // Call path: the capability is exactly the registered tool action.
    context.action = input.actionOverride;
    candidates = [input.actionOverride];
  } else {
    // Issuance: the capability is the provider, or a requested scope qualified as
    // `provider.scope` (`google.gmail.send`) — the same vocabulary tool actions use, so one
    // rule fires at both tiers. Bare scopes stay as aliases so rules written before
    // qualification keep matching.
    const providerAction = context.action;
    const cleanScopes = (input.scopes ?? [])
      .map((scope) => String(scope).trim())
      .filter((scope) => scope.length > 0);
    const qualified = providerAction
      ? cleanScopes.map((scope) => `${providerAction}.${scope}`)
      : [];
    candidates = [providerAction, ...qualified, ...cleanScopes];
  }

  const won = evaluateCapabilities(rules, context, candidates);
  context = won.context;
  const result = won.result;

  let decision: PolicyAction;
  let rule: PolicyRule | null;
  let enforced: boolean;
  let defaultApplied: boolean;
  let mode: string;

  if (!configured) {
    decision = "allow";
    rule = null;
    enforced = false;
    defaultApplied = false;
    mode = "none";
  } else {
    decision = result.decision;
    rule = result.rule;
    enforced = true;
    defaultApplied = result.defaultApplied;
    mode = result.settled ? "enforce" : "none";
  }

  // Restrictive (consent) path: only a settled enforce deny blocks.
  const blocks = enforced && decision === "deny" && (result.settled || !input.restrictive);

  let ledgerOk = true;
  const kept = <T>(write: () => T): T | null => {
    try {
      return write();
    } catch (err) {
      if (isHttpError(err) || strictRecord) throw err;
      ledgerOk = false;
      return null;
    }
  };

  for (const shadow of result.shadowed) {
    kept(() =>
      recordDecision(db, {
        workspaceId,
        ruleId: shadow.id,
        decision: shadow.action ?? "allow",
        mode: "log-only",
        enforced: false,
        defaultApplied: false,
        context,
        agentId,
        agentLabel,
        connectUserId,
        userLabel,
        source,
        grantId,
        reason: `${shadow.name} would have ${shadow.action}ed.`,
        enforcement,
        runId,
      }),
    );
  }

  const reason = decisionReason(decision, rule, defaultApplied, configured);
  const decisionId = kept(() =>
    recordDecision(db, {
      workspaceId,
      ruleId: rule?.id ?? null,
      decision,
      mode,
      enforced,
      defaultApplied,
      context,
      agentId,
      agentLabel,
      connectUserId,
      userLabel,
      source,
      grantId,
      reason,
      enforcement,
      runId,
    }),
  );

  if (enforced) {
    kept(() =>
      recordAuditEvent(db, {
        eventType: AUDIT_EVENT.POLICY_DECISION,
        actorType: AUDIT_ACTOR.SYSTEM,
        actorId: agentId ?? connectUserId ?? "policy",
        connectUserId,
        resourceType: grantId ? AUDIT_RESOURCE.CONNECT_GRANT : AUDIT_RESOURCE.CONNECT_POLICY,
        resourceId: grantId ?? rule?.id ?? "",
        agentId,
        result: decision === "deny" ? "denied" : "success",
        workspaceId,
        denialReason: reason,
        metadata: {
          decision,
          decision_id: decisionId,
          rule_id: rule?.id ?? null,
          rule_name: rule?.name ?? null,
          action: context.action,
          scope: context.scope,
          source,
          default_applied: defaultApplied,
          reason,
        },
      }),
    );
  }

  return {
    decision,
    rule,
    enforced,
    defaultApplied,
    configured,
    blocks,
    reason,
    context,
    decisionId: decisionId ?? null,
    ledgerOk,
  };
}

export interface DecideActionInput {
  /** Server-derived action, e.g. `git.force_push` or `github.issue.create`. */
  action: string;
  resource?: string;
  agentId?: string | null;
  agentLabel?: string;
  connectUserId?: string | null;
  userLabel?: string;
  runId?: string | null;
  source?: string;
}

export interface DecideActionResult {
  decision: PolicyAction;
  reason: string;
  rule: { id: string | null; name: string; priority: number | null } | null;
  decisionId: string | null;
  configured: boolean;
  enforced: boolean;
  defaultApplied: boolean;
}

/**
 * Call-path decision. The action is supplied by the server (from the tool assessment), never
 * by the caller's label, and every decision is written to `policy_decisions`.
 *
 * This is the same evaluator as grant issuance — one rule set, one ledger — exposed under a
 * name that says what the call path is doing.
 */
export function decideAction(
  db: Db,
  workspaceId: string,
  input: DecideActionInput,
): DecideActionResult {
  const result = enforceGrantIssuance(db, {
    workspaceId,
    actionOverride: input.action,
    resource: input.resource ?? "",
    agentId: input.agentId ?? null,
    agentLabel: input.agentLabel ?? "",
    connectUserId: input.connectUserId ?? null,
    userLabel: input.userLabel ?? "",
    runId: input.runId ?? null,
    source: input.source ?? "tool-call",
    enforcement: "cooperative",
    strictRecord: false,
  });

  return {
    decision: result.decision,
    reason: result.reason,
    rule: result.rule
      ? {
          id: result.rule.id ?? null,
          name: String(result.rule.name ?? ""),
          priority: result.rule.priority ?? null,
        }
      : null,
    decisionId: result.decisionId,
    configured: result.configured,
    enforced: result.enforced,
    defaultApplied: result.defaultApplied,
  };
}

export interface EvaluateRequestInput {
  action?: string;
  agent?: string;
  resource?: string;
  user?: string;
  amount?: string;
}

/**
 * Dry-run. Walks rules in priority order, first match wins, unmatched falls to default-deny.
 *
 * No side effects — this simulates, it does not enforce, and its action comes from the caller
 * on purpose.
 */
export function evaluateRequest(
  db: Db,
  workspaceId: string,
  input: EvaluateRequestInput,
): Record<string, unknown> {
  const { rules } = loadRules(db, workspaceId);
  const context = {
    action: input.action ?? "",
    agent: input.agent ?? "",
    scope: "",
    resource: input.resource ?? "",
    user: input.user ?? "",
    amount: input.amount ?? "0",
    time: "",
  };

  const result = evaluate(rules, context);
  const matched = result.rule;

  if (!matched) {
    return {
      decision: "deny",
      rule: null,
      reason: `No rule matched. ${context.action} falls to the default (deny).`,
      steps: result.steps,
      changeHint: changeHint("deny", null, context.amount),
    };
  }

  const first = matched.conditions?.[0] ?? { field: "", operator: "", value: "" };
  const reason =
    result.decision === "deny"
      ? `${matched.name} denies this unconditionally.`
      : `${matched.name} matched on ${first.field} ${first.operator} ${first.value}.`;

  return {
    decision: result.decision,
    rule: { id: matched.id, priority: matched.priority, name: matched.name },
    reason,
    steps: result.steps,
    changeHint: changeHint(result.decision, matched, context.amount),
  };
}

/**
 * Actions that were requested, matched no rule, and fell to the default.
 *
 * Default-deny makes these invisible at the point of refusal; the decision ledger is the only
 * place they survive. Grouped by action so an operator can see what is asking for a rule.
 */
export function coverageGaps(
  db: Db,
  workspaceId: string,
): { gaps: Array<Record<string, unknown>>; total: number } {
  const rows = db
    .select()
    .from(policyDecisions)
    .where(
      and(
        eq(policyDecisions.workspaceId, workspaceId),
        eq(policyDecisions.defaultApplied, 1),
      ),
    )
    .orderBy(desc(policyDecisions.createdAt))
    .all();

  const grouped = new Map<
    string,
    { action: string; blocked: number; agents: string[]; lastSeen: string }
  >();

  for (const row of rows) {
    const action = (row.action ?? "").trim() || "(unnamed action)";
    let entry = grouped.get(action);
    if (!entry) {
      entry = { action, blocked: 0, agents: [], lastSeen: "" };
      grouped.set(action, entry);
    }
    entry.blocked += 1;

    const label = (row.agentLabel ?? "").trim();
    if (label && !entry.agents.includes(label)) entry.agents.push(label);

    const created = row.createdAt ?? "";
    if (created > entry.lastSeen) entry.lastSeen = created;
  }

  const gaps = [...grouped.values()].sort((left, right) => right.blocked - left.blocked);
  return { gaps, total: rows.length };
}

/**
 * Resolved decision per agent per known action, from the current rules.
 *
 * Evaluated with resource, user and amount unset, so a rule conditioned on those fields will
 * not match here — this projects the rules, it does not replay traffic. `configured` is false
 * when no enforcing rule exists, in which case nothing is gated and every cell is the default.
 */
export function capabilityMatrix(
  db: Db,
  workspaceId: string,
): Record<string, unknown> {
  const { rules, configured } = loadRules(db, workspaceId);

  const agentRows = db
    .select()
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), ne(agents.status, "archived")))
    .orderBy(asc(agents.name))
    .all();
  const agentList = agentRows.map((row) => ({
    id: row.id,
    name: row.name || row.id,
  }));

  const actions: string[] = [...CONNECT_PROVIDER_IDS];
  const toolRows = db
    .select({ action: tools.action })
    .from(tools)
    .where(eq(tools.workspaceId, workspaceId))
    .orderBy(asc(tools.name))
    .all();
  for (const row of toolRows) {
    const action = (row.action ?? "").trim();
    if (action && !actions.includes(action)) actions.push(action);
  }

  const matrix = actions.map((action) => {
    const cells: Record<string, Record<string, unknown>> = {};
    for (const agent of agentList) {
      // The engine matches on the agent label, so evaluate by name even though cells are
      // keyed by id (names are not unique).
      const result = evaluate(rules, {
        action,
        agent: agent.name,
        scope: "",
        resource: "",
        user: "",
        amount: "",
        time: "",
      });
      cells[agent.id] = {
        decision: configured ? result.decision : "allow",
        rule: result.rule?.name ?? null,
        default: configured ? result.defaultApplied : false,
      };
    }
    return { action, cells };
  });

  return { agents: agentList, matrix, configured };
}

export type { PolicyDecisionRow };
