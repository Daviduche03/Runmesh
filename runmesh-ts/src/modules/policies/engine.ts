/**
 * Pure policy evaluation. No DB, no HTTP.
 *
 * The engine takes a context built from *server-verified* facts. The action identity for a
 * security decision is never taken from the caller's label — it is derived from the
 * connection (or, later, the registered tool catalog). That is the point: the thing being
 * enforced must not get to name itself.
 *
 * Evaluation is first-match-wins. A matched `log-only` rule is recorded as a shadow and does
 * not decide, so a rule can be watched before it is allowed to act. Unmatched falls to the
 * engine default (deny); callers decide whether the default applies at all.
 */

export const POLICY_ACTIONS = ["allow", "escalate", "consent", "deny"] as const;
export type PolicyAction = (typeof POLICY_ACTIONS)[number];

export const POLICY_MODES = ["enforce", "log-only"] as const;
export type PolicyMode = (typeof POLICY_MODES)[number];

export const POLICY_FIELDS = ["action", "agent", "scope", "resource", "user", "amount", "time"] as const;
export type PolicyField = (typeof POLICY_FIELDS)[number];

export const POLICY_OPERATORS = [
  "is",
  "is not",
  "contains",
  "not contains",
  "matches",
  "in",
  "not in",
  "starts with",
  "ends with",
  "length >",
  "length <",
  ">",
  "<",
  "within",
] as const;
export type PolicyOperator = (typeof POLICY_OPERATORS)[number];

export const POLICY_REVERSIBILITY = ["reversible", "undoable", "irreversible"] as const;

export interface PolicyCondition {
  field?: PolicyField | string;
  operator?: PolicyOperator | string;
  value?: string;
}

export interface PolicyRule {
  id?: string;
  priority?: number;
  name?: string;
  action?: PolicyAction;
  mode?: PolicyMode;
  enabled?: boolean;
  conditions?: PolicyCondition[];
  [key: string]: unknown;
}

export interface PolicyContext extends Record<string, string> {
  action: string;
  scope: string;
  resource: string;
  agent: string;
  user: string;
  amount: string;
  time: string;
}

export type StepStatus = "matched" | "skipped" | "disabled" | "shadow" | "not-reached";

export interface EvaluationStep {
  id: string | null;
  priority: number | null;
  name: string;
  action: PolicyAction | null;
  status: StepStatus;
  detail: string;
}

export interface ShadowedRule {
  id: string | null;
  priority: number | null;
  name: string;
  action: PolicyAction | null;
}

export interface PolicyEvaluation {
  decision: PolicyAction;
  rule: PolicyRule | null;
  /** True when an enforce-mode rule actually decided. */
  settled: boolean;
  defaultApplied: boolean;
  steps: EvaluationStep[];
  shadowed: ShadowedRule[];
}

/**
 * Canonical action for a grant, derived from the connection row.
 *
 * At issuance the unit of authority is a provider connection, so the action is the provider
 * (`github`, `stripe`). Tool-level actions such as `stripe.charge` belong to the call path,
 * where the identity is derived from the registered tool catalog — never from a runtime
 * string the wrapped agent supplies.
 */
export function buildActionIdentity(provider: string | null | undefined): string {
  return (provider ?? "").trim().toLowerCase();
}

export function buildGrantContext(input: {
  provider?: string | null;
  scopes?: unknown[] | null;
  resource?: string;
  agent?: string;
  user?: string;
  amount?: string;
  when?: string;
}): PolicyContext {
  const normalized = [
    ...new Set(
      (input.scopes ?? [])
        .map((scope) => String(scope).trim().toLowerCase())
        .filter((scope) => scope.length > 0),
    ),
  ].sort();

  return {
    action: buildActionIdentity(input.provider),
    scope: normalized.join(", "),
    resource: String(input.resource ?? ""),
    agent: String(input.agent ?? ""),
    user: String(input.user ?? ""),
    amount: String(input.amount ?? ""),
    time: String(input.when ?? ""),
  };
}

/** Python truthiness for context lookup: missing, empty and "0"-ish values read as "". */
export function contextValue(field: string | undefined, context: PolicyContext | Record<string, string>): string {
  const value = context[field ?? "action"];
  return value ? String(value) : "";
}

function csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** `int(value)` semantics: optional sign, digits, and digit-group underscores. */
function parseInteger(value: string): number | null {
  const cleaned = value.trim().replace(/_/g, "");
  if (!/^[+-]?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** `float(re.sub(...))` semantics: strip currency/separators, then parse. */
function parseNumber(value: string): number {
  const cleaned = value.replace(/[^0-9.\-]/g, "");
  return cleaned ? Number(cleaned) : Number.NaN;
}

export function conditionMatches(
  condition: PolicyCondition,
  context: PolicyContext | Record<string, string>,
): boolean {
  const actual = contextValue(condition.field ?? "action", context);
  const expected = String(condition.value ?? "");
  const operator = condition.operator ?? "is";

  switch (operator) {
    case "is":
      return actual === expected;
    case "is not":
      return actual !== expected;
    case "contains":
      return actual.includes(expected);
    case "not contains":
      return !actual.includes(expected);
    case "matches":
      try {
        return new RegExp(expected).test(actual);
      } catch {
        return false;
      }
    case "in":
      return csv(expected).includes(actual);
    case "not in":
      return !csv(expected).includes(actual);
    case "starts with":
      return actual.startsWith(expected);
    case "ends with":
      return actual.endsWith(expected);
    case "length >":
    case "length <": {
      const bound = parseInteger(expected);
      if (bound === null) return false;
      return operator === "length >" ? actual.length > bound : actual.length < bound;
    }
    case ">":
    case "<": {
      const left = parseNumber(actual);
      const right = parseNumber(expected);
      return operator === ">" ? left > right : left < right;
    }
    default:
      // `within` needs a clock context we do not carry yet; treat as containment and let
      // the trace say so.
      return actual.includes(expected);
  }
}

export function evaluate(
  rules: PolicyRule[],
  context: PolicyContext | Record<string, string>,
): PolicyEvaluation {
  const steps: EvaluationStep[] = [];
  const shadowed: ShadowedRule[] = [];
  let decision: PolicyAction | null = null;
  let matched: PolicyRule | null = null;

  for (const rule of rules) {
    const base = {
      id: rule.id ?? null,
      priority: rule.priority ?? null,
      name: rule.name ?? "",
      action: rule.action ?? null,
    };

    if (decision !== null) {
      steps.push({
        ...base,
        status: "not-reached",
        detail: "First match already decided.",
      });
      continue;
    }

    if (!rule.enabled) {
      steps.push({ ...base, status: "disabled", detail: "Disabled. Not evaluating." });
      continue;
    }

    const failing = (rule.conditions ?? []).find(
      (condition) => !conditionMatches(condition, context),
    );
    if (failing) {
      const actual = contextValue(failing.field ?? "action", context) || "—";
      steps.push({
        ...base,
        status: "skipped",
        detail: `${actual} does not satisfy ${failing.field} ${failing.operator} ${failing.value}`,
      });
      continue;
    }

    if ((rule.mode ?? "enforce") === "log-only") {
      shadowed.push({
        id: rule.id ?? null,
        priority: rule.priority ?? null,
        name: rule.name ?? "",
        action: rule.action ?? null,
      });
      steps.push({ ...base, status: "shadow", detail: "Log-only. Recorded, not enforced." });
      continue;
    }

    decision = rule.action ?? null;
    matched = rule;
    steps.push({ ...base, status: "matched", detail: "All conditions matched." });
  }

  if (decision === null) {
    return {
      decision: "deny",
      rule: null,
      settled: false,
      defaultApplied: true,
      steps,
      shadowed,
    };
  }

  return {
    decision,
    rule: matched,
    settled: true,
    defaultApplied: false,
    steps,
    shadowed,
  };
}

export function changeHint(
  decision: PolicyAction,
  rule: PolicyRule | null,
  requestAmount = "",
): string {
  if (decision === "allow") return "Nothing needs to change. This runs without a human.";
  if (decision === "escalate") {
    return `Allow it automatically by raising the spend cap above $${requestAmount}.`;
  }
  if (decision === "consent") {
    return "A standing grant covering this scope would let it proceed without asking.";
  }
  if (rule && rule.priority !== undefined && rule.priority !== null) {
    return `Nothing overrides this. Move #${rule.priority} below another rule to change the outcome.`;
  }
  return "Add a rule that covers this action. Today it is blocked only by the default.";
}

/** Wire shape: the field names the Policies API and the simulator UI already speak. */
export interface EvaluationWire {
  decision: PolicyAction;
  rule: PolicyRule | null;
  settled: boolean;
  default_applied: boolean;
  steps: EvaluationStep[];
  shadowed: ShadowedRule[];
}

export function serializeEvaluation(evaluation: PolicyEvaluation): EvaluationWire {
  return {
    decision: evaluation.decision,
    rule: evaluation.rule,
    settled: evaluation.settled,
    default_applied: evaluation.defaultApplied,
    steps: evaluation.steps,
    shadowed: evaluation.shadowed,
  };
}
