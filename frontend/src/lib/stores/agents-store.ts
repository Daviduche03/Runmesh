import { create } from "zustand";
import { apiGet, apiPost } from "@/lib/api";
import type { Agent } from "@/modules/agents/components/agents-table";
import type { AgentTone } from "@/modules/agents/components/agent-status";

export type BackendAgentStatus = "active" | "suspended" | "archived";

export type BackendAgent = {
	id: string;
	workspace_id: string | null;
	name: string;
	description: string;
	status: BackendAgentStatus;
	parent_agent_id: string | null;
	project_id: string | null;
	environment: string | null;
	key_fingerprint: string | null;
	framework?: string | null;
	model?: string | null;
	version?: number | null;
	last_seen_at: string | null;
	created_at: string;
	updated_at: string;
};

export type CreateAgentPayload = {
	name: string;
	description?: string;
	parent_agent_id?: string;
	project_id?: string;
	environment?: string;
	public_key?: string;
};

function timeAgo(iso: string | null): string {
	if (!iso) return "never";
	const ms = Date.now() - new Date(iso).getTime();
	if (Number.isNaN(ms) || ms < 0) return "never";
	const minutes = Math.floor(ms / 60000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

const uiStatus = (status: BackendAgentStatus): AgentTone =>
	status === "suspended" ? "suspended" : "idle";

/** Map a backend identity row onto the card shape. Runtime fields
 *  (grants, current activity) come from grants/tasks later — for now
 *  they read as empty rather than fake. */
export function toUiAgent(agent: BackendAgent): Agent {
	return {
		id: agent.id,
		name: agent.name || "Untitled agent",
		status: uiStatus(agent.status),
		grants: 0,
		current: "—",
		seen: timeAgo(agent.last_seen_at),
		framework: agent.framework ?? null,
		model: agent.model ?? null,
		version: agent.version ?? null,
	};
}

const STALE_MS = 30_000;

type AgentsState = {
	agents: BackendAgent[];
	loading: boolean;
	creating: boolean;
	fetchedAt: number | null;
	fetch: () => Promise<void>;
	/** Returns the server error message, or null on success. */
	create: (data: CreateAgentPayload) => Promise<string | null>;
};

export const useAgentsStore = create<AgentsState>((set, get) => ({
	agents: [],
	loading: false,
	creating: false,
	fetchedAt: null,

	fetch: async () => {
		const state = get();
		if (state.loading) return;
		if (state.fetchedAt && Date.now() - state.fetchedAt < STALE_MS) return;

		set({ loading: true });
		try {
			const { data } = await apiGet<BackendAgent[]>("/api/v1/agents");
			set({ agents: data, loading: false, fetchedAt: Date.now() });
		} catch {
			set({ loading: false });
		}
	},

	create: async (data) => {
		const state = get();
		if (state.creating) return "Already creating an agent.";
		set({ creating: true });
		try {
			await apiPost("/api/v1/agents", data);
			set({ creating: false, fetchedAt: null });
			await get().fetch();
			return null;
		} catch (err) {
			set({ creating: false });
			return err instanceof Error ? err.message : "Failed to register agent.";
		}
	},
}));
