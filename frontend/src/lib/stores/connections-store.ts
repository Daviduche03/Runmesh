import { create } from "zustand";
import { apiGet } from "@/lib/api";

export type BackendConnection = {
	id: string;
	connect_user_id: string;
	user: string;
	provider: string;
	account: string | null;
	scopes: string[];
	status: string;
	created_at: string;
};

type ConnectionsState = {
	connections: BackendConnection[];
	total: number;
	loading: boolean;
	fetchedAt: number | null;
	fetch: () => Promise<void>;
};

const STALE_MS = 30_000;

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
	connections: [],
	total: 0,
	loading: false,
	fetchedAt: null,

	fetch: async () => {
		const state = get();
		if (state.loading) return;
		if (state.fetchedAt && Date.now() - state.fetchedAt < STALE_MS) return;

		set({ loading: true });
		try {
			const { data, meta } = await apiGet<BackendConnection[]>("/api/v1/connections");
			set({ connections: data, total: meta?.total ?? data.length, loading: false, fetchedAt: Date.now() });
		} catch {
			set({ loading: false });
		}
	},
}));
