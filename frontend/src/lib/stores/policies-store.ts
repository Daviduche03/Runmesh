import { create } from "zustand";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

export type BackendPolicyRule = {
	id: string;
	priority: number;
	name: string;
	description: string;
	enabled: boolean;
	conditions: { field: string; operator: string; value: string }[];
	action: "allow" | "escalate" | "consent" | "deny";
	scope: string;
	mode: "enforce" | "log-only";
	caps: Record<string, string>;
	reversibility: "reversible" | "undoable" | "irreversible";
	decided: number;
	escalated: number;
	approvals: number;
	rejections: number;
	medianReviewMs: number;
	rego: string;
	created_at: string;
	updated_at: string;
};

export type PolicyRuleInput = {
	name: string;
	description?: string;
	conditions?: { field: string; operator: string; value: string }[];
	action?: BackendPolicyRule["action"];
	scope?: string;
	mode?: BackendPolicyRule["mode"];
	caps?: Record<string, string>;
	reversibility?: BackendPolicyRule["reversibility"];
	enabled?: boolean;
};

export type EvaluateStep = {
	id: string;
	priority: number;
	name: string;
	action: BackendPolicyRule["action"];
	status: "matched" | "skipped" | "disabled" | "not-reached";
	detail: string;
};

export type EvaluateResult = {
	decision: BackendPolicyRule["action"];
	rule: { id: string; priority: number; name: string } | null;
	reason: string;
	steps: EvaluateStep[];
	changeHint: string;
};

export type PolicyChange = {
	at: string;
	by: string;
	change: string;
	record: string;
};

export type CoverageGap = {
	action: string;
	blocked: number;
	agents: string[];
	lastSeen: string;
};

export type CapabilityCell = {
	decision: BackendPolicyRule["action"];
	rule: string | null;
	default: boolean;
};

export type CapabilityMatrixData = {
	agents: { id: string; name: string }[];
	matrix: { action: string; cells: Record<string, CapabilityCell> }[];
	configured: boolean;
};

type RawAuditEvent = {
	id: string;
	actor: string;
	created_at: string;
	metadata: Record<string, unknown>;
	resource_id: string | null;
};

function formatWhen(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${date
		.toLocaleTimeString("en-US", { hour12: false })
		.slice(0, 5)}`;
}

type PoliciesState = {
	rules: BackendPolicyRule[];
	loading: boolean;
	saving: boolean;
	changes: PolicyChange[];
	changesLoading: boolean;
	gaps: CoverageGap[];
	gapsTotal: number;
	gapsLoading: boolean;
	matrix: CapabilityMatrixData | null;
	matrixLoading: boolean;
	fetchedAt: number | null;
	fetch: () => Promise<void>;
	create: (input: PolicyRuleInput) => Promise<string | null>;
	update: (id: string, input: PolicyRuleInput) => Promise<string | null>;
	remove: (id: string) => Promise<string | null>;
	evaluate: (input: {
		agent: string;
		action: string;
		resource: string;
		user: string;
		amount: string;
	}) => Promise<EvaluateResult | null>;
	fetchChanges: () => Promise<void>;
	fetchGaps: () => Promise<void>;
	fetchMatrix: () => Promise<void>;
};

const STALE_MS = 30_000;

function refresh(state: { fetch: () => Promise<void> }) {
	return state.fetch();
}

export const usePoliciesStore = create<PoliciesState>((set, get) => ({
	rules: [],
	loading: false,
	saving: false,
	changes: [],
	changesLoading: false,
	gaps: [],
	gapsTotal: 0,
	gapsLoading: false,
	matrix: null,
	matrixLoading: false,
	fetchedAt: null,

	fetch: async () => {
		const state = get();
		if (state.loading) return;
		if (state.fetchedAt && Date.now() - state.fetchedAt < STALE_MS) return;

		set({ loading: true });
		try {
			const { data } = await apiGet<BackendPolicyRule[]>("/api/v1/policies/rules");
			set({ rules: data, loading: false, fetchedAt: Date.now() });
		} catch {
			set({ loading: false });
		}
	},

	create: async (input) => {
		set({ saving: true });
		try {
			await apiPost("/api/v1/policies/rules", input);
			set({ saving: false, fetchedAt: null });
			await refresh(get());
			return null;
		} catch (err) {
			set({ saving: false });
			return err instanceof Error ? err.message : "Failed to create rule.";
		}
	},

	update: async (id, input) => {
		set({ saving: true });
		try {
			await apiPatch(`/api/v1/policies/rules/${id}`, input);
			set({ saving: false, fetchedAt: null });
			await refresh(get());
			return null;
		} catch (err) {
			set({ saving: false });
			return err instanceof Error ? err.message : "Failed to update rule.";
		}
	},

	remove: async (id) => {
		set({ saving: true });
		try {
			await apiDelete(`/api/v1/policies/rules/${id}`);
			set({ saving: false, fetchedAt: null });
			await refresh(get());
			return null;
		} catch (err) {
			set({ saving: false });
			return err instanceof Error ? err.message : "Failed to delete rule.";
		}
	},

	evaluate: async (input) => {
		try {
			const { data } = await apiPost<EvaluateResult>("/api/v1/policies/evaluate", input);
			return data;
		} catch {
			return null;
		}
	},

	fetchChanges: async () => {
		set({ changesLoading: true });
		try {
			const { data } = await apiGet<RawAuditEvent[]>(
				"/api/v1/connect/audit?event_type=policy.updated&limit=100"
			);
			set({
				changes: data.map((event) => ({
					at: formatWhen(event.created_at),
					by: event.actor,
					change: String(event.metadata?.change ?? "Policy updated."),
					record: `${event.id.slice(0, 6)}…${event.id.slice(-4)}`,
				})),
				changesLoading: false,
			});
		} catch {
			set({ changesLoading: false });
		}
	},

	fetchGaps: async () => {
		set({ gapsLoading: true });
		try {
			const { data } = await apiGet<{ gaps: CoverageGap[]; total: number }>(
				"/api/v1/policies/coverage-gaps"
			);
			set({ gaps: data.gaps, gapsTotal: data.total, gapsLoading: false });
		} catch {
			set({ gapsLoading: false });
		}
	},

	fetchMatrix: async () => {
		set({ matrixLoading: true });
		try {
			const { data } = await apiGet<CapabilityMatrixData>("/api/v1/policies/capability-matrix");
			set({ matrix: data, matrixLoading: false });
		} catch {
			set({ matrixLoading: false });
		}
	},
}));
