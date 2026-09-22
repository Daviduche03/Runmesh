import { create } from "zustand";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

const STALE_MS = 30_000;

export type ApiKey = {
	id: string;
	name: string;
	permissions: string[];
	created_at: string;
	last_used_at: string | null;
};

type ApiKeysState = {
	keys: ApiKey[];
	loading: boolean;
	fetchedAt: number | null;
	creating: boolean;
	freshKeys: Record<string, string>;
	fetch: () => Promise<void>;
	create: (name: string, permissions: string[]) => Promise<string | null>;
	remove: (id: string) => Promise<void>;
};

export const useApiKeysStore = create<ApiKeysState>((set, get) => ({
	keys: [],
	loading: false,
	fetchedAt: null,
	creating: false,
	freshKeys: {},

	fetch: async () => {
		const state = get();
		if (state.loading) return;
		if (state.fetchedAt && Date.now() - state.fetchedAt < STALE_MS) return;

		set({ loading: true });
		try {
			const { data } = await apiGet<ApiKey[]>("/api-keys");
			set({ keys: data, loading: false, fetchedAt: Date.now() });
		} catch {
			set({ loading: false });
		}
	},

	create: async (name: string, permissions: string[]) => {
		set({ creating: true });
		try {
			const { data } = await apiPost<{ id: string; name: string; key: string; permissions: string[] }>("/api-keys", { name, permissions });
			const rawKey = data.key;
			set((state) => ({
				creating: false,
				freshKeys: { ...state.freshKeys, [data.id]: rawKey },
				fetchedAt: null,
			}));
			await get().fetch();
			return rawKey;
		} catch {
			set({ creating: false });
			return null;
		}
	},

	remove: async (id: string) => {
		await apiDelete(`/api-keys/${id}`);
		set({ fetchedAt: null });
		await get().fetch();
	},
}));
