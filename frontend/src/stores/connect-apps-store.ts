import { create } from "zustand";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

const STALE_MS = 30_000;

export type ConnectApp = {
	id: string;
	name: string;
	slug: string;
	redirect_uris: string[];
	allowed_providers: string[];
	status: string;
	created_at: string;
	updated_at: string;
};

export type ConnectGrant = {
	id: string;
	connect_user_id: string;
	connection_id: string;
	scopes: string[];
	status: string;
	granted_at: string;
};

type ConnectAppsState = {
	apps: ConnectApp[];
	grantsByApp: Record<string, ConnectGrant[]>;
	loading: boolean;
	grantsLoading: boolean;
	fetchedAt: number | null;
	creating: boolean;
	deleting: boolean;
	fetch: () => Promise<void>;
	fetchGrants: (appId: string) => Promise<void>;
	create: (payload: {
		name: string;
		slug: string;
		redirect_uris: string[];
		allowed_providers: string[];
	}) => Promise<boolean>;
	remove: (id: string) => Promise<boolean>;
};

export const useConnectAppsStore = create<ConnectAppsState>((set, get) => ({
	apps: [],
	grantsByApp: {},
	loading: false,
	grantsLoading: false,
	fetchedAt: null,
	creating: false,
	deleting: false,

	fetch: async () => {
		const state = get();
		if (state.loading) return;
		if (state.fetchedAt && Date.now() - state.fetchedAt < STALE_MS) return;

		set({ loading: true });
		try {
			const { data } = await apiGet<ConnectApp[]>("/api/v1/connect/apps");
			set({ apps: data, loading: false, fetchedAt: Date.now() });
		} catch {
			set({ loading: false });
		}
	},

	fetchGrants: async (appId: string) => {
		set({ grantsLoading: true });
		try {
			const { data } = await apiGet<ConnectGrant[]>(`/api/v1/connect/apps/${appId}/grants`);
			set((state) => ({
				grantsByApp: { ...state.grantsByApp, [appId]: data },
				grantsLoading: false,
			}));
		} catch {
			set({ grantsLoading: false });
		}
	},

	create: async (payload) => {
		set({ creating: true });
		try {
			await apiPost<ConnectApp>("/api/v1/connect/apps", payload);
			set({ creating: false, fetchedAt: null });
			await get().fetch();
			return true;
		} catch {
			set({ creating: false });
			return false;
		}
	},

	remove: async (id: string) => {
		set({ deleting: true });
		try {
			await apiDelete(`/api/v1/connect/apps/${id}`);
			set((state) => {
				const grantsByApp = { ...state.grantsByApp };
				delete grantsByApp[id];
				return {
					deleting: false,
					fetchedAt: null,
					grantsByApp,
				};
			});
			await get().fetch();
			return true;
		} catch {
			set({ deleting: false });
			return false;
		}
	},
}));
