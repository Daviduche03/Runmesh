import { create } from "zustand";
import { apiGet } from "@/lib/api";

export type BackendRunEvent = {
	id: string;
	kind: string;
	name: string;
	args: Record<string, unknown>;
	result: Record<string, unknown>;
	truncated: boolean;
	duration_ms: number | null;
	seq: number;
	created_at: string;
};

export type BackendRun = {
	id: string;
	agent_id: string;
	parent_run_id: string | null;
	thread_id: string | null;
	connect_user_id: string | null;
	status: string;
	event_count: number;
	started_at: string;
	finished_at: string | null;
	created_at: string;
};

export type BackendChildRun = {
	id: string;
	agent_id: string;
	agent_name: string | null;
	status: string;
	started_at: string | null;
};

export type BackendRunDetail = BackendRun & {
	usage: Record<string, unknown>;
	input: string | null;
	events: BackendRunEvent[];
	child_runs: BackendChildRun[];
};

type AgentRunsState = {
	runsByAgent: Record<string, BackendRun[]>;
	detailsByRun: Record<string, BackendRunDetail>;
	loadingAgents: Record<string, boolean>;
	loadingRuns: Record<string, boolean>;
	fetchRuns: (agentId: string) => Promise<void>;
	fetchRun: (runId: string) => Promise<void>;
};

export const useAgentRunsStore = create<AgentRunsState>((set, get) => ({
	runsByAgent: {},
	detailsByRun: {},
	loadingAgents: {},
	loadingRuns: {},

	fetchRuns: async (agentId) => {
		const state = get();
		if (state.loadingAgents[agentId]) return;
		set((s) => ({ loadingAgents: { ...s.loadingAgents, [agentId]: true } }));
		try {
			const { data } = await apiGet<BackendRun[]>(`/api/v1/agents/${agentId}/runs`);
			set((s) => ({
				runsByAgent: { ...s.runsByAgent, [agentId]: data },
				loadingAgents: { ...s.loadingAgents, [agentId]: false },
			}));
		} catch {
			set((s) => ({ loadingAgents: { ...s.loadingAgents, [agentId]: false } }));
		}
	},

	fetchRun: async (runId) => {
		const state = get();
		if (state.loadingRuns[runId] || state.detailsByRun[runId]) return;
		set((s) => ({ loadingRuns: { ...s.loadingRuns, [runId]: true } }));
		try {
			const { data } = await apiGet<BackendRunDetail>(`/api/v1/runs/${runId}`);
			set((s) => ({
				detailsByRun: { ...s.detailsByRun, [runId]: data },
				loadingRuns: { ...s.loadingRuns, [runId]: false },
			}));
		} catch {
			set((s) => ({ loadingRuns: { ...s.loadingRuns, [runId]: false } }));
		}
	},
}));
