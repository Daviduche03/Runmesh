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
	metadata: Record<string, unknown> | null;
	duration_ms?: number | null;
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

function summarizeValue(value: unknown): string | null {
	if (value == null) return null;
	if (typeof value === "string") return value;
	try {
		const json = JSON.stringify(value);
		return json.length > 500 ? `${json.slice(0, 500)}…` : json;
	} catch {
		return null;
	}
}

function toAuditEvent(event: BackendAuditEvent): AuditEvent {
	const metadata =
		event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
			? event.metadata
			: null;
	const kind = typeof metadata?.kind === "string" ? metadata.kind : event.event_type;
	const isAgentStep =
		kind.startsWith("tool.") ||
		kind === "error" ||
		kind === "policy.decision" ||
		kind.startsWith("model.");
	const isResult = kind === "tool.result" || kind === "error";
	const reason =
		event.denial_reason ?? (typeof metadata?.reason === "string" ? metadata.reason : null);
	const name = typeof metadata?.name === "string" && metadata.name ? metadata.name : null;
	const args = metadata && "args" in metadata ? metadata.args : undefined;
	const resultPayload = metadata && "result" in metadata ? metadata.result : undefined;
	const policyMeta =
		event.event_type === "policy.decision"
			? {
					decision: metadata?.decision,
					rule_id: metadata?.rule_id,
					rule_name: metadata?.rule_name,
					action: metadata?.action,
					scope: metadata?.scope,
					source: metadata?.source,
					default_applied: metadata?.default_applied,
					decision_id: metadata?.decision_id,
			  }
			: null;
	const cleanMeta = policyMeta
		? Object.fromEntries(Object.entries(policyMeta).filter(([, v]) => v !== undefined && v !== null && v !== ""))
		: metadata;

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
		kindLabel: isAgentStep ? kind : undefined,
		action: isAgentStep ? name || event.event_type : event.event_type,
		authority: event.authority,
		argsText: isAgentStep && !isResult ? summarizeValue(args ?? null) : null,
		resultText: isAgentStep && isResult ? summarizeValue(resultPayload ?? event.result) : null,
		outcome: event.outcome,
		reason,
		metadata: cleanMeta,
		offsetMs: 0,
		durationMs:
			typeof event.duration_ms === "number" && event.duration_ms > 0 ? event.duration_ms : 0,
	};
}

/** Offsets are relative to each run's first event (from real timestamps).
 *  Also fills parentId for tool results under matching calls, and policy
 *  decisions under the call that triggered them. */
function withOffsets(events: AuditEvent[]): AuditEvent[] {
	const groups = new Map<string, AuditEvent[]>();
	for (const event of events) {
		const key = event.traceId ?? `single:${event.id}`;
		const list = groups.get(key) ?? [];
		list.push(event);
		groups.set(key, list);
	}
	const parentByEvent = new Map<string, string>();
	for (const list of groups.values()) {
		const ordered = [...list].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
		const openCalls = new Map<string, string[]>();
		let lastCallId: string | null = null;
		for (const event of ordered) {
			const kind = event.kindLabel ?? event.action;
			const toolKey = event.action;
			if (kind === "tool.call") {
				const stack = openCalls.get(toolKey) ?? [];
				stack.push(event.id);
				openCalls.set(toolKey, stack);
				lastCallId = event.id;
			} else if (kind === "tool.result" || kind === "error") {
				const stack = openCalls.get(toolKey);
				const callId = stack?.pop();
				if (callId) parentByEvent.set(event.id, callId);
			} else if (event.type === "policy" && lastCallId) {
				parentByEvent.set(event.id, lastCallId);
			}
		}
	}
	return events.map((event) => {
		const key = event.traceId ?? `single:${event.id}`;
		const group = groups.get(key) ?? [event];
		const start = Math.min(...group.map((e) => e.timestamp));
		let durationMs = event.durationMs;
		if (durationMs <= 0) {
			const sorted = [...group].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
			const idx = sorted.findIndex((e) => e.id === event.id);
			const next = idx >= 0 ? sorted[idx + 1] : undefined;
			durationMs = next ? Math.max(0, next.timestamp - event.timestamp) : 0;
		}
		return {
			...event,
			offsetMs: Math.max(0, event.timestamp - start),
			parentId: parentByEvent.get(event.id) ?? null,
			durationMs,
		};
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
