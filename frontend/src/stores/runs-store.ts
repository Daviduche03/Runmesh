import { create } from "zustand";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

const STALE_MS = 30_000;

export type Task = {
	id: string;
	endpoint: string;
	status: string;
	scheduled: string;
	duration: string | null;
	retries: number;
};

type RunnableStatus = "queued" | "running" | "completed" | "failed" | "pending";

type CreateTaskPayload = {
	url: string;
	payload?: Record<string, unknown>;
	type?: string;
	execution_type?: string;
	scheduled_at?: string | null;
	workflow_id?: string | null;
};

type RunsState = {
	tasks: Task[];
	total: number;
	loading: boolean;
	creating: boolean;
	deleting: boolean;
	fetchedAt: number | null;
	statusFilter: string | null;
	page: number;
	setStatusFilter: (status: string | null) => void;
	setPage: (page: number) => void;
	fetch: () => Promise<void>;
	createTask: (data: CreateTaskPayload) => Promise<void>;
	remove: (id: string) => Promise<boolean>;
	updateTaskStatus: (taskId: string, status: RunnableStatus) => void;
};

export const useRunsStore = create<RunsState>((set, get) => ({
	tasks: [],
	total: 0,
	loading: false,
	creating: false,
	deleting: false,
	fetchedAt: null,
	statusFilter: null,
	page: 1,

	setStatusFilter: (status: string | null) => {
		set({ statusFilter: status, page: 1, fetchedAt: null });
	},

	setPage: (page: number) => {
		set({ page, fetchedAt: null });
	},

	fetch: async () => {
		const state = get();
		if (state.loading) return;
		if (state.fetchedAt && Date.now() - state.fetchedAt < STALE_MS) return;

		set({ loading: true });
		try {
			const params = new URLSearchParams({ page: String(state.page), limit: "50" });
			if (state.statusFilter) params.set("status", state.statusFilter);

			const { data, meta } = await apiGet<Task[]>(`/api/v1/tasks?${params}`);
			set({ tasks: data, total: meta?.total ?? 0, loading: false, fetchedAt: Date.now() });
		} catch {
			set({ loading: false });
		}
	},

	createTask: async (data: CreateTaskPayload) => {
		set({ creating: true });
		try {
			await apiPost("/api/v1/tasks", data);
			set({ creating: false, fetchedAt: null });
			await get().fetch();
		} catch {
			set({ creating: false });
			throw new Error("Failed to create task");
		}
	},

	remove: async (id: string) => {
		set({ deleting: true });
		try {
			await apiDelete(`/api/v1/tasks/${id}`);
			set({ deleting: false, fetchedAt: null });
			await get().fetch();
			return true;
		} catch {
			set({ deleting: false });
			return false;
		}
	},

	updateTaskStatus: (taskId: string, status: RunnableStatus) => {
		set((state) => ({
			tasks: state.tasks.map((t) =>
				t.id === taskId ? { ...t, status: status.charAt(0).toUpperCase() + status.slice(1) } : t
			),
		}));
	},
}));
