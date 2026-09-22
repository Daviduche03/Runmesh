import { create } from "zustand";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

const STALE_MS = 30_000;

export type WorkflowTask = {
	id: string;
	url: string;
	status: string;
	stepOrder: number;
};

export type WorkflowGraphNode = {
	id: string;
	type: "trigger" | "http";
	position: { x: number; y: number };
	data: Record<string, unknown>;
};

export type WorkflowGraphEdge = {
	id: string;
	source: string;
	target: string;
};

export type WorkflowGraph = {
	nodes: WorkflowGraphNode[];
	edges: WorkflowGraphEdge[];
};

export type Workflow = {
	id: string;
	name: string;
	description: string;
	trigger: string;
	triggerType: string;
	triggerConfig: string;
	endpoint: string;
	status: string;
	lastRun: string;
	runs: number;
	stepCount?: number;
	createdAt: string;
	updatedAt?: string;
	tasks: WorkflowTask[];
	graph?: WorkflowGraph;
};

type CreateWorkflowPayload = {
	name: string;
	description: string;
	trigger_type: string;
	trigger_config: string;
};

type WorkflowsState = {
	workflows: Workflow[];
	loading: boolean;
	creating: boolean;
	deleting: boolean;
	fetchedAt: number | null;
	fetch: () => Promise<void>;
	createWorkflow: (data: CreateWorkflowPayload) => Promise<void>;
	remove: (id: string) => Promise<boolean>;
};

export const useWorkflowsStore = create<WorkflowsState>((set, get) => ({
	workflows: [],
	loading: false,
	creating: false,
	deleting: false,
	fetchedAt: null,

	fetch: async () => {
		const state = get();
		if (state.loading) return;
		if (state.fetchedAt && Date.now() - state.fetchedAt < STALE_MS) return;

		set({ loading: true });
		try {
			const { data } = await apiGet<Workflow[]>("/api/v1/workflows");
			set({ workflows: data, loading: false, fetchedAt: Date.now() });
		} catch {
			set({ loading: false });
		}
	},

	createWorkflow: async (data: CreateWorkflowPayload) => {
		const state = get();
		if (state.creating) return;

		set({ creating: true });
		try {
			await apiPost("/api/v1/workflows", data);
			set({ fetchedAt: null });
			await get().fetch();
			set({ creating: false });
		} catch (err) {
			set({ creating: false });
			throw err;
		}
	},

	remove: async (id: string) => {
		set({ deleting: true });
		try {
			await apiDelete(`/api/v1/workflows/${id}`);
			set({ deleting: false, fetchedAt: null });
			await get().fetch();
			return true;
		} catch {
			set({ deleting: false });
			return false;
		}
	},
}));
