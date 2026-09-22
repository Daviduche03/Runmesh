import { create } from "zustand";
import { apiGet } from "@/lib/api";
import type {
	AuditEvent,
	AuditMode,
	AuditOutcome,
	AuditActorType,
	AuditType,
} from "@/modules/audit/components/audit-table";

export type BackendAuditEvent = {
	id: string;
	event_type: string;
	actor: string;
	actor_type: AuditActorType;
	on_behalf_of: string;
	mode: AuditMode;
	type: AuditType;
	authority: string;
	outcome: AuditOutcome;
	trace_id: string | null;
	thread_id: string | null;
	agent_id: string | null;
	task_id: string | null;
	workflow_run_id: string | null;
	result: string | null;
	denial_reason: string | null;
	metadata: Record<string, unknown>;
	created_at: string;
};

function formatTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	const now = new Date();
	const sameDay = date.toDateString() === now.toDateString();
	const time = date.toLocaleTimeString("en-US", { hour12: false });
	if (sameDay) return time;
	return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time.slice(0, 5)}`;
}

function toAuditEvent(event: BackendAuditEvent): AuditEvent {
	return {
		id: event.id,
		time: formatTime(event.created_at),
		timestamp: new Date(event.created_at).getTime(),
		threadId: event.thread_id,
		traceId: event.trace_id,
		parentId: null,
		actor: event.actor,
		actorType: event.actor_type,
		onBehalfOf: event.on_behalf_of,
		mode: event.mode,
		type: event.type,
		action: event.event_type,
		authority: event.authority,
		outcome: event.outcome,
		offsetMs: 0,
		durationMs: 0,
	};
}

/** Offsets are relative to each run's first event (from real timestamps). */
function withOffsets(events: AuditEvent[]): AuditEvent[] {
	const groups = new Map<string, AuditEvent[]>();
	for (const event of events) {
		const key = event.traceId ?? `single:${event.id}`;
		const list = groups.get(key) ?? [];
		list.push(event);
		groups.set(key, list);
	}
	return events.map((event) => {
		const key = event.traceId ?? `single:${event.id}`;
		const group = groups.get(key) ?? [event];
		const start = Math.min(...group.map((e) => e.timestamp));
		return { ...event, offsetMs: Math.max(0, event.timestamp - start) };
	});
}

type AuditState = {
	events: AuditEvent[];
	total: number;
	loading: boolean;
	fetchedAt: number | null;
	fetch: () => Promise<void>;
};

const STALE_MS = 30_000;

export const useAuditStore = create<AuditState>((set, get) => ({
	events: [],
	total: 0,
	loading: false,
	fetchedAt: null,

	fetch: async () => {
		const state = get();
		if (state.loading) return;
		if (state.fetchedAt && Date.now() - state.fetchedAt < STALE_MS) return;

		set({ loading: true });
		try {
			const { data, meta } = await apiGet<BackendAuditEvent[]>("/api/v1/connect/audit?limit=100");
			set({
				events: withOffsets(data.map(toAuditEvent)),
				total: meta?.total ?? data.length,
				loading: false,
				fetchedAt: Date.now(),
			});
		} catch {
			set({ loading: false });
		}
	},
}));
