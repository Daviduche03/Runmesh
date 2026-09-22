export type PolicyAction = "allow" | "escalate" | "consent" | "deny";
export type PolicyCondition = { field: string; operator: string; value: string };
export type PolicyMode = "enforce" | "log-only";
export type Reversibility = "reversible" | "undoable" | "irreversible";

export type PolicyRule = {
	id: string;
	priority: number;
	name: string;
	description: string;
	enabled: boolean;
	conditions: PolicyCondition[];
	action: PolicyAction;
	scope: string;
	mode: PolicyMode;
	caps: { spend?: string; maxUses?: string; ttl?: string };
	history: { at: string; by: string; change: string }[];
	reversibility: Reversibility;
	decided: number;
	escalated: number;
	approvals: number;
	rejections: number;
	medianReviewMs: number;
	rego: string;
};

export const actionText: Record<PolicyAction, string> = {
	allow: "text-emerald-400",
	escalate: "text-amber-400",
	consent: "text-sky-400",
	deny: "text-red-400",
};

export const actionDot: Record<PolicyAction, string> = {
	allow: "bg-emerald-400",
	escalate: "bg-amber-400",
	consent: "bg-sky-400",
	deny: "bg-red-400",
};

export const actionLabel: Record<PolicyAction, string> = {
	allow: "Allow",
	escalate: "Require a human",
	consent: "Require consent",
	deny: "Deny",
};

const operatorRego: Record<string, string> = {
	is: "==",
	"is not": "!=",
	">": ">",
	"<": "<",
	contains: "contains",
};

/** Prose is the source; this is the artifact it compiles to. */
export function ruleRego(rule: PolicyRule): string {
	if (rule.rego) return rule.rego;
	const clauses = rule.conditions
		.map((condition) => {
			const field = condition.field === "action" ? "input.tool.name" : `input.${condition.field}`;
			const op = operatorRego[condition.operator] ?? "==";
			if (op === "contains") {
				return `  contains(${field}, ${JSON.stringify(condition.value)})`;
			}
			const value = /^-?\d+(\.\d+)?$/.test(condition.value) ? condition.value : JSON.stringify(condition.value);
			return `  ${field} ${op} ${value}`;
		})
		.join("\n");
	return `package runmesh.policy

import rego.v1

default decision := {"decision": "deny", "reason": "no rule matched"}

# ${rule.priority} · ${rule.name}
decision := {"decision": "${rule.action}"} if {
${clauses}
}
`;
}

export function rejectionRate(rule: PolicyRule): number | null {
	const reviewed = rule.approvals + rule.rejections;
	if (reviewed === 0) return null;
	return rule.rejections / reviewed;
}

export type OversightTone = "muted" | "ok" | "warn" | "danger";

export const toneText: Record<OversightTone, string> = {
	muted: "text-muted-foreground",
	ok: "text-emerald-400",
	warn: "text-amber-400",
	danger: "text-red-400",
};

export const toneDot: Record<OversightTone, string> = {
	muted: "bg-muted-foreground/40",
	ok: "bg-emerald-400",
	warn: "bg-amber-400",
	danger: "bg-red-400",
};

/** A gate that never rejects is not a gate. This is the whole point of the page. */
export function oversightVerdict(rule: PolicyRule): { tone: OversightTone; label: string; detail: string } {
	if (!rule.enabled) {
		return { tone: "muted", label: "disabled", detail: "Not evaluating. Nothing is gated by this rule." };
	}
	if (rule.escalated === 0) {
		return { tone: "muted", label: "no escalations", detail: "Nothing has reached a human yet." };
	}
	const reviewed = rule.approvals + rule.rejections;
	const unreviewed = rule.escalated - reviewed;
	if (unreviewed > 0) {
		return {
			tone: "warn",
			label: `${unreviewed} unreviewed`,
			detail: `${unreviewed} of ${rule.escalated} escalations are still waiting. Stale approvals decay in value.`,
		};
	}
	const rate = (rejectionRate(rule) ?? 0) * 100;
	if (rate < 5) {
		return {
			tone: "danger",
			label: "not gating",
			detail: `${rule.escalated} escalated, ${rule.rejections} rejected, median review ${formatMs(rule.medianReviewMs)}. Rubber stamp.`,
		};
	}
	return { tone: "ok", label: "healthy", detail: `${rate.toFixed(0)}% rejected. The gate is doing work.` };
}

export function formatMs(ms: number): string {
	if (ms <= 0) return "—";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${Math.round(seconds % 60)}s`;
}

export function conditionSummary(rule: PolicyRule): string {
	return rule.conditions
		.map((condition) => `${condition.field} ${condition.operator} ${condition.value}`)
		.join(" · ");
}

export type PolicyRequest = {
	agent: string;
	action: string;
	resource: string;
	user: string;
	amount: string;
};

export type EvaluationStep = {
	rule: PolicyRule;
	status: "matched" | "skipped" | "disabled" | "not-reached";
	detail: string;
};

export type Evaluation = {
	decision: PolicyAction;
	rule: PolicyRule | null;
	reason: string;
	steps: EvaluationStep[];
	changeHint: string;
};

function fieldValue(field: string, request: PolicyRequest): string {
	switch (field) {
		case "action":
			return request.action;
		case "resource":
			return request.resource;
		case "agent":
			return request.agent;
		case "user":
			return request.user;
		case "amount":
			return request.amount;
		default:
			return "";
	}
}

function matches(condition: PolicyCondition, request: PolicyRequest): boolean {
	const actual = fieldValue(condition.field, request);
	const expected = condition.value;
	switch (condition.operator) {
		case "is":
			return actual === expected;
		case "is not":
			return actual !== expected;
		case "contains":
			return actual.includes(expected);
		case ">":
			return Number(actual) > Number(expected);
		case "<":
			return Number(actual) < Number(expected);
		default:
			return actual.includes(expected);
	}
}

/** First match wins. Disabled rules are skipped. Unmatched falls to default-deny. */
export function evaluateRequest(rules: PolicyRule[], request: PolicyRequest): Evaluation {
	const steps: EvaluationStep[] = [];
	let decision: PolicyAction | null = null;
	let matchedRule: PolicyRule | null = null;
	let matchedCondition: PolicyCondition | null = null;

	for (const rule of rules) {
		if (decision !== null) {
			steps.push({ rule, status: "not-reached", detail: "First match already decided." });
			continue;
		}
		if (!rule.enabled) {
			steps.push({ rule, status: "disabled", detail: "Disabled. Not evaluating." });
			continue;
		}
		const failing = rule.conditions.find((condition) => !matches(condition, request));
		if (failing) {
			steps.push({
				rule,
				status: "skipped",
				detail: `${fieldValue(failing.field, request) || "—"} does not satisfy ${failing.field} ${failing.operator} ${failing.value}`,
			});
			continue;
		}
		decision = rule.action;
		matchedRule = rule;
		matchedCondition = rule.conditions[0] ?? null;
		steps.push({ rule, status: "matched", detail: "All conditions matched." });
	}

	if (decision === null) {
		return {
			decision: "deny",
			rule: null,
			reason: `No rule matched. ${request.action} falls to the default (deny).`,
			steps,
			changeHint: "Add a rule that covers this action. Today it is blocked only by the default.",
		};
	}

	const reason =
		decision === "deny"
			? `${matchedRule?.name} denies this unconditionally.`
			: `${matchedRule?.name} matched on ${matchedCondition?.field} ${matchedCondition?.operator} ${matchedCondition?.value}.`;

	const changeHint =
		decision === "allow"
			? "Nothing needs to change. This runs without a human."
			: decision === "escalate"
				? `Allow it automatically by raising the spend cap above $${request.amount}.`
				: decision === "consent"
					? "A standing grant covering this scope would let it proceed without asking."
					: `Nothing overrides this. Move #${matchedRule?.priority} below another rule to change the outcome.`;

	return { decision, rule: matchedRule, reason, steps, changeHint };
}
