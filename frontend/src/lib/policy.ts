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
