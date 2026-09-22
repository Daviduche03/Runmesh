import type { PolicyRule } from "@/lib/policy";

export const policyDraftRule: PolicyRule = {
	id: "new",
	priority: 7,
	name: "New rule",
	description: "A draft. It starts disabled and log-only so it can watch before it acts.",
	enabled: false,
	conditions: [{ field: "action", operator: "is", value: "" }],
	action: "escalate",
	scope: "all scopes",
	mode: "log-only",
	caps: {},
	reversibility: "reversible",
	decided: 0,
	escalated: 0,
	approvals: 0,
	rejections: 0,
	medianReviewMs: 0,
	rego: "",
	history: [],
};
