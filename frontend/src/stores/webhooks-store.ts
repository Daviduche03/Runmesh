import { create } from "zustand";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

const STALE_MS = 30_000;

export type Webhook = {
	id: string;
	name: string;
	url: string;
	events: string;
	status: string;
	secret?: string;
	secret_hint?: string;
	created_at: string;
	updated_at: string;
};

type WebhooksState = {
	webhooks: Webhook[];
	loading: boolean;
	fetchedAt: number | null;
	creating: boolean;
	rotating: boolean;
	fetch: () => Promise<void>;
	create: (name: string, url: string, events: string) => Promise<string | null>;
	rotateSecret: (id: string) => Promise<string | null>;
	remove: (id: string) => Promise<void>;
};

export const useWebhooksStore = create<WebhooksState>((set, get) => ({
	webhooks: [],
	loading: false,
	fetchedAt: null,
	creating: false,
	rotating: false,

	fetch: async () => {
		const state = get();
		if (state.loading) return;
		if (state.fetchedAt && Date.now() - state.fetchedAt < STALE_MS) return;

		set({ loading: true });
		try {
			const { data } = await apiGet<Webhook[]>("/api/webhooks");
			set({ webhooks: data, loading: false, fetchedAt: Date.now() });
		} catch {
			set({ loading: false });
		}
	},

	create: async (name: string, url: string, events: string) => {
		set({ creating: true });
		try {
			const { data } = await apiPost<Webhook>("/api/webhooks", { name, url, events });
			set({ creating: false, fetchedAt: null });
			await get().fetch();
			return data.secret ?? null;
		} catch {
			set({ creating: false });
			return null;
		}
	},

	rotateSecret: async (id: string) => {
		set({ rotating: true });
		try {
			const { data } = await apiPost<Webhook>(`/api/webhooks/${id}/rotate-secret`);
			set({ rotating: false, fetchedAt: null });
			await get().fetch();
			return data.secret ?? null;
		} catch {
			set({ rotating: false });
			return null;
		}
	},

	remove: async (id: string) => {
		await apiDelete(`/api/webhooks/${id}`);
		set({ fetchedAt: null });
		await get().fetch();
	},
}));
