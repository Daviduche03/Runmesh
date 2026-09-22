import { create } from "zustand";
import { apiGet } from "@/lib/api";

export type BackendTool = {
	id: string;
	name: string;
	action: string;
	kind: string;
	provider: string;
};

type ToolsState = {
	tools: BackendTool[];
	loading: boolean;
	fetchedAt: number | null;
	fetch: () => Promise<void>;
};

const STALE_MS = 30_000;

export const useToolsStore = create<ToolsState>((set, get) => ({
	tools: [],
	loading: false,
	fetchedAt: null,

	fetch: async () => {
		const state = get();
		if (state.loading) return;
		if (state.fetchedAt && Date.now() - state.fetchedAt < STALE_MS) return;

		set({ loading: true });
		try {
			const { data } = await apiGet<BackendTool[]>("/api/v1/tools");
			set({ tools: data, loading: false, fetchedAt: Date.now() });
		} catch {
			set({ loading: false });
		}
	},
}));
