import { create } from "zustand";
import { apiGet, apiPost } from "@/lib/api";

const STALE_MS = 30_000;

export type WorkflowTask = {
	id: string;
	url: string;
	status: string;
	stepOrder: number;
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
	createdAt: string;
	tasks: WorkflowTask[];
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
	fetchedAt: number | null;
	fetch: () => Promise<void>;
	createWorkflow: (data: CreateWorkflowPayload) => Promise<void>;
};

export const useWorkflowsStore = create<WorkflowsState>((set, get) => ({
	workflows: [],
	loading: false,
	creating: false,
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
}));
