import { create } from "zustand";

export type User = {
	id: string;
	name: string;
	email: string;
	avatar_url?: string;
};

const TOKEN_KEY = "runmesh-token";

function base64UrlDecode(str: string): string {
	str = str.replace(/-/g, "+").replace(/_/g, "/");
	const pad = str.length % 4;
	if (pad) str += "=".repeat(4 - pad);
	return atob(str);
}

function decodeTokenPayload(token: string): Record<string, unknown> | null {
	try {
		const decoded = base64UrlDecode(token);
		const parts = decoded.split(".");
		if (parts.length < 2) return null;
		return JSON.parse(parts[0]);
	} catch {
		return null;
	}
}

type AuthState = {
	token: string | null;
	user: User | null;
	isAuthenticated: boolean;
	isLoading: boolean;
	setToken: (token: string) => void;
	setUser: (user: User) => void;
	logout: () => void;
	fetchUser: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set, get) => ({
	token: localStorage.getItem(TOKEN_KEY),
	user: null,
	isAuthenticated: !!localStorage.getItem(TOKEN_KEY),
	isLoading: false,

	setToken: (token: string) => {
		localStorage.setItem(TOKEN_KEY, token);
		set({ token, isAuthenticated: true });
	},

	setUser: (user: User) => {
		set({ user });
	},

	logout: () => {
		localStorage.removeItem(TOKEN_KEY);
		set({ token: null, user: null, isAuthenticated: false });
	},

	fetchUser: async () => {
		const token = get().token;
		if (!token) return;

		set({ isLoading: true });
		try {
			const payload = decodeTokenPayload(token);
			if (payload) {
				set({
					user: {
						id: payload.id as string,
						email: (payload.email as string) ?? "",
						name: (payload.name as string) ?? (payload.email as string) ?? "",
					},
					isLoading: false,
				});
			}
		} catch {
			set({ isLoading: false });
		}
	},
}));
