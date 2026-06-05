import { create } from "zustand";
import { apiGet } from "@/lib/api";

const STALE_MS = 30_000;

export type AnalyticsData = {
	stats: {
		total_tasks: number;
		active_runs: number;
		completed_today: number;
		failed: number;
	};
	execution_chart: { day: string; tasks: number }[];
	run_status_chart: { date: string; successful: number; failed: number }[];
	recent_tasks: { id: string; endpoint: string; status: string; scheduled: string }[];
};

type AnalyticsState = {
	data: AnalyticsData | null;
	loading: boolean;
	fetchedAt: number | null;
	fetch: () => Promise<void>;
};

export const useAnalyticsStore = create<AnalyticsState>((set, get) => ({
	data: null,
	loading: false,
	fetchedAt: null,

	fetch: async () => {
		const state = get();
		if (state.loading) return;
		if (state.fetchedAt && Date.now() - state.fetchedAt < STALE_MS) return;

		set({ loading: true });
		try {
			const { data } = await apiGet<AnalyticsData>("/api/analytics");
			set({ data, loading: false, fetchedAt: Date.now() });
		} catch {
			set({ loading: false });
		}
	},
}));
