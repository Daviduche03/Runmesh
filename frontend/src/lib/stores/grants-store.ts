import { create } from "zustand";
import { apiGet, apiPost } from "@/lib/api";

export type GrantStatus = "pending" | "active" | "expired" | "revoked" | "denied";

export type BackendGrant = {
	id: string;
	agent_id: string | null;
	connect_user_id: string;
	user: string;
	provider: string | null;
	account_label: string | null;
	scopes: string[];
	resource: string | null;
	resource_filters: Record<string, unknown> | null;
	status: GrantStatus;
	approval_status: string;
	uses: number;
	max_uses: number | null;
	valid_until: string | null;
	seconds_until_expiration: number | null;
	environment: string | null;
	created_at: string;
};

type GrantsState = {
	grants: BackendGrant[];
	total: number;
	loading: boolean;
	acting: boolean;
	fetchedAt: number | null;
	fetchedStatus: string;
	fetch: (status?: string) => Promise<void>;
	approve: (id: string) => Promise<string | null>;
	deny: (id: string) => Promise<string | null>;
	revoke: (id: string) => Promise<string | null>;
};

const STALE_MS = 30_000;

export const useGrantsStore = create<GrantsState>((set, get) => ({
	grants: [],
	total: 0,
	loading: false,
	acting: false,
	fetchedAt: null,
	fetchedStatus: "__none__",

	fetch: async (status = "all") => {
		const state = get();
		if (state.loading) return;
		if (state.fetchedAt && Date.now() - state.fetchedAt < STALE_MS && state.fetchedStatus === status) return;

		set({ loading: true });
		try {
			const query = status === "all" ? "" : `?status=${status}`;
			const { data, meta } = await apiGet<BackendGrant[]>(`/api/v1/grants${query}`);
			set({ grants: data, total: meta?.total ?? data.length, loading: false, fetchedAt: Date.now(), fetchedStatus: status });
		} catch {
			set({ loading: false });
		}
	},

	approve: async (id) => {
		set({ acting: true });
		try {
			await apiPost(`/api/v1/connect/grants/${id}/approve`, {});
			set({ acting: false, fetchedAt: null });
			await get().fetch(get().fetchedStatus === "__none__" ? "all" : get().fetchedStatus);
			return null;
		} catch (err) {
			set({ acting: false });
			return err instanceof Error ? err.message : "Failed to approve grant.";
		}
	},

	deny: async (id) => {
		set({ acting: true });
		try {
			await apiPost(`/api/v1/connect/grants/${id}/deny`, { reason: "Denied from the Grants page" });
			set({ acting: false, fetchedAt: null });
			await get().fetch(get().fetchedStatus === "__none__" ? "all" : get().fetchedStatus);
			return null;
		} catch (err) {
			set({ acting: false });
			return err instanceof Error ? err.message : "Failed to deny grant.";
		}
	},

	revoke: async (id) => {
		set({ acting: true });
		try {
			await apiPost(`/api/v1/grants/${id}/revoke`, {});
			set({ acting: false, fetchedAt: null });
			await get().fetch(get().fetchedStatus === "__none__" ? "all" : get().fetchedStatus);
			return null;
		} catch (err) {
			set({ acting: false });
			return err instanceof Error ? err.message : "Failed to revoke grant.";
		}
	},
}));
