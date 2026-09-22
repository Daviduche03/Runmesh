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

export type WebhookDeadLetter = {
	id: string;
	webhook_id: string;
	webhook_name: string;
	event: string;
	event_id: string;
	body: Record<string, unknown>;
	last_status_code: number | null;
	last_error: string | null;
	attempts: number;
	failed_at: string;
	replayed_at: string | null;
	created_at: string;
};

type WebhooksState = {
	webhooks: Webhook[];
	deadLetters: WebhookDeadLetter[];
	loading: boolean;
	dlqLoading: boolean;
	fetchedAt: number | null;
	dlqFetchedAt: number | null;
	creating: boolean;
	rotating: boolean;
	replaying: string | null;
	fetch: () => Promise<void>;
	fetchDeadLetters: () => Promise<void>;
	create: (name: string, url: string, events: string) => Promise<string | null>;
	rotateSecret: (id: string) => Promise<string | null>;
	replayDeadLetter: (id: string) => Promise<void>;
	dismissDeadLetter: (id: string) => Promise<void>;
	remove: (id: string) => Promise<void>;
};

export const useWebhooksStore = create<WebhooksState>((set, get) => ({
	webhooks: [],
	deadLetters: [],
	loading: false,
	dlqLoading: false,
	fetchedAt: null,
	dlqFetchedAt: null,
	creating: false,
	rotating: false,
	replaying: null,

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

	fetchDeadLetters: async () => {
		const state = get();
		if (state.dlqLoading) return;
		if (state.dlqFetchedAt && Date.now() - state.dlqFetchedAt < STALE_MS) return;

		set({ dlqLoading: true });
		try {
			const { data } = await apiGet<WebhookDeadLetter[]>("/api/webhooks/dead-letters");
			set({ deadLetters: data, dlqLoading: false, dlqFetchedAt: Date.now() });
		} catch {
			set({ dlqLoading: false });
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

	replayDeadLetter: async (id: string) => {
		set({ replaying: id });
		try {
			await apiPost(`/api/webhooks/dead-letters/${id}/replay`);
			set({ replaying: null, dlqFetchedAt: null });
			await get().fetchDeadLetters();
		} catch {
			set({ replaying: null });
		}
	},

	dismissDeadLetter: async (id: string) => {
		await apiDelete(`/api/webhooks/dead-letters/${id}`);
		set({ dlqFetchedAt: null });
		await get().fetchDeadLetters();
	},

	remove: async (id: string) => {
		await apiDelete(`/api/webhooks/${id}`);
		set({ fetchedAt: null });
		await get().fetch();
	},
}));
