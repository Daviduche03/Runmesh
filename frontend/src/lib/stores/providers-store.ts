import { create } from "zustand";
import { apiGet } from "@/lib/api";

export type BackendProvider = {
	id: string;
	scopes: string[];
	oauth_enabled: boolean;
};

type ProvidersState = {
	providers: BackendProvider[];
	loading: boolean;
	fetchedAt: number | null;
	fetch: () => Promise<void>;
};

const STALE_MS = 30_000;

export const useProvidersStore = create<ProvidersState>((set, get) => ({
	providers: [],
	loading: false,
	fetchedAt: null,

	fetch: async () => {
		const state = get();
		if (state.loading) return;
		if (state.fetchedAt && Date.now() - state.fetchedAt < STALE_MS) return;

		set({ loading: true });
		try {
			const { data } = await apiGet<BackendProvider[]>("/api/v1/connect/providers");
			set({ providers: data, loading: false, fetchedAt: Date.now() });
		} catch {
			set({ loading: false });
		}
	},
}));
