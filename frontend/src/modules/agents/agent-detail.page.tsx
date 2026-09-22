"use client";

import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/modules/dashboard/components/stat-card";
import { AgentStatus } from "@/modules/agents/components/agent-status";
import { GrantsTable, type Grant } from "@/modules/grants/components/grants-table";
import { TraceView } from "@/modules/audit/components/trace-view";
import { AuditEventDetail } from "@/modules/audit/components/audit-event-detail";
import type { AuditEvent, AuditOutcome, AuditType } from "@/modules/audit/components/audit-table";
import { ActionThroughputChart, type ThroughputPoint } from "@/modules/dashboard/components/action-throughput-chart";
import { ActionOutcomesChart, type OutcomeSlice } from "@/modules/dashboard/components/action-outcomes-chart";
import { useAgentsStore, toUiAgent } from "@/lib/stores/agents-store";
import { useGrantsStore, type BackendGrant } from "@/lib/stores/grants-store";
import { useAgentRunsStore, type BackendRun, type BackendRunEvent } from "@/lib/stores/agent-runs-store";
import { copyText } from "@/lib/clipboard";
import EmptyState from "@/components/empty-state";
import { toast } from "sonner";
import {
	ArrowLeftIcon,
	BotIcon,
	ChevronRightIcon,
	CopyIcon,
	KeyRoundIcon,
	Loader2Icon,
	PauseIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

function formatDateTime(iso: string | null): string {
	if (!iso) return "—";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "—";
	return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${date
		.toLocaleTimeString("en-US", { hour12: false })
		.slice(0, 5)}`;
}

function formatDurationMs(ms: number | null): string {
	if (ms == null) return "—";
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

function runDuration(run: BackendRun): string {
	if (!run.finished_at || !run.started_at) return run.status === "running" ? "running" : "—";
	const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
	if (Number.isNaN(ms) || ms < 0) return "—";
	return formatDurationMs(ms);
}

function grantExpiry(grant: BackendGrant): string {
	switch (grant.status) {
		case "pending":
			return "pending consent";
		case "revoked":
			return "revoked";
		case "denied":
			return "denied";
		case "expired":
			return "expired";
		default: {
			if (grant.valid_until == null) return "no expiry";
			const seconds = grant.seconds_until_expiration;
			if (seconds == null) return grant.valid_until;
			if (seconds < 3600) return `in ${Math.max(1, Math.round(seconds / 60))}m`;
			if (seconds < 86400) return `in ${Math.round(seconds / 3600)}h`;
			return `in ${Math.round(seconds / 86400)}d`;
		}
	}
}

function toGrantRow(grant: BackendGrant): Grant {
	const [first, ...rest] = grant.scopes;
	return {
		id: grant.id,
		scope: rest.length > 0 ? `${first} +${rest.length}` : (first ?? "—"),
		resource: grant.resource ?? "—",
		expiry: grantExpiry(grant),
		uses: `${grant.uses} / ${grant.max_uses ?? "—"}`,
		status: grant.status,
	};
}

function summarizeValue(value: unknown): string {
	try {
		const text = JSON.stringify(value);
		return text.length > 120 ? `${text.slice(0, 120)}…` : text;
	} catch {
		return "—";
	}
}

const traceType: Record<string, AuditType> = {
	"tool.call": "tool",
	"tool.result": "tool",
	error: "tool",
	"model.request": "agent",
	"model.response": "agent",
	"policy.decision": "policy",
	log: "system",
};

/** Map run events onto the audit trace model so a run reads exactly like
 *  an audit thread: run-as-root, results nested under calls via parentId.
 *  Authority stays "—" (run steps carry no grant); payloads travel in
 *  argsText/resultText. Child runs pair onto results in start order. */
function toTraceEvents(
	events: BackendRunEvent[],
	run: BackendRun,
	agentName: string,
	childRuns: { id: string; agent_id: string; agent_name: string | null }[] = []
): AuditEvent[] {
	const start = new Date(run.started_at).getTime();
	const base = Number.isNaN(start) ? 0 : start;
	const callIds = new Map<string, string[]>();
	let childIndex = 0;
	return events.map((event) => {
		const at = new Date(event.created_at).getTime();
		const timestamp = Number.isNaN(at) ? base : at;
		let parentId: string | null = null;
		let childRunId: string | null = null;
		let childAgentId: string | null = null;
		let childAgentName: string | null = null;
		if (event.kind === "tool.call") {
			const list = callIds.get(event.name) ?? [];
			list.push(event.id);
			callIds.set(event.name, list);
		} else if (event.kind === "tool.result" || event.kind === "error") {
			const list = callIds.get(event.name);
			const callId = list?.pop();
			if (callId) parentId = callId;
			const child = childRuns[childIndex];
			if (child) {
				childRunId = child.id;
				childAgentId = child.agent_id;
				childAgentName = child.agent_name;
			}
			childIndex += 1;
		}
		const isResult = event.kind === "tool.result" || event.kind === "error";
		return {
			id: event.id,
			time: formatDateTime(event.created_at),
			timestamp,
			threadId: run.parent_run_id,
			traceId: run.id,
			parentId,
			actor: agentName,
			actorType: "agent" as const,
			onBehalfOf: "—",
			mode: "autonomous" as const,
			type: traceType[event.kind] ?? ("system" as const),
			kindLabel: event.kind,
			action: event.name || event.kind,
			authority: "—",
			argsText: isResult ? null : summarizeValue(event.args),
			resultText: isResult ? summarizeValue(event.result) : null,
			childRunId,
			childAgentId,
			childAgentName,
			outcome: (event.kind === "error" ? "failed" : "success") as AuditOutcome,
			offsetMs: Math.max(0, timestamp - base),
			durationMs: event.duration_ms ?? 0,
		};
	});
}

function RunEvents({
	run,
	agentName,
	onSelectEvent,
	onOpenRun,
}: {
	run: BackendRun;
	agentName: string;
	onSelectEvent: (event: AuditEvent) => void;
	onOpenRun: (runId: string, agentId: string | null) => void;
}) {
	const detail = useAgentRunsStore((s) => s.detailsByRun[run.id]);
	const loading = useAgentRunsStore((s) => s.loadingRuns[run.id] ?? false);
	const fetchRun = useAgentRunsStore((s) => s.fetchRun);

	useEffect(() => {
		fetchRun(run.id);
	}, [fetchRun, run.id]);

	if (loading && !detail) {
		return (
			<div className="grid gap-2 px-4 py-3">
				{[0, 1].map((index) => (
					<Skeleton className="h-8 w-full rounded-[4px]" key={index} />
				))}
			</div>
		);
	}
	const events: BackendRunEvent[] = detail?.events ?? [];
	if (events.length === 0) {
		return <p className="px-4 py-3 text-[12.5px] text-muted-foreground">No events recorded.</p>;
	}
	const childRuns = (detail?.child_runs ?? []).map((child) => ({
		id: child.id,
		agent_id: child.agent_id,
		agent_name: child.agent_name,
	}));
	return (
		<div className="border-t border-border">
			<TraceView
				runs={[
					{
						traceId: run.id,
						runTitle: `${agentName} · run`,
						events: toTraceEvents(events, run, agentName, childRuns),
					},
				]}
				onSelectEvent={onSelectEvent}
				toolbar={false}
				showKinds
				onOpenRun={onOpenRun}
			/>
		</div>
	);
}

export function AgentDetailPage() {
	const { id } = useParams<{ id: string }>();
	const storeAgents = useAgentsStore((s) => s.agents);
	const loading = useAgentsStore((s) => s.loading);
	const fetchAgents = useAgentsStore((s) => s.fetch);
	const grants = useGrantsStore((s) => s.grants);
	const grantsLoading = useGrantsStore((s) => s.loading);
	const fetchGrants = useGrantsStore((s) => s.fetch);
	const revokeGrant = useGrantsStore((s) => s.revoke);
	const runsByAgent = useAgentRunsStore((s) => s.runsByAgent);
	const runsLoading = useAgentRunsStore((s) => s.loadingAgents);
	const fetchRuns = useAgentRunsStore((s) => s.fetchRuns);
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const [expandedRun, setExpandedRun] = useState<string | null>(() => searchParams.get("run"));
	const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);

	const handleOpenRun = (runId: string, agentId: string | null) => {
		if (agentId) navigate(`/agents/${agentId}?run=${runId}`);
	};

	useEffect(() => {
		if (storeAgents.length === 0) fetchAgents();
	}, [fetchAgents, storeAgents.length]);

	useEffect(() => {
		fetchGrants("all");
	}, [fetchGrants]);

	useEffect(() => {
		if (id) fetchRuns(id);
	}, [fetchRuns, id]);

	const found = storeAgents.find((item) => item.id === id);

	if (loading && !found) {
		return (
			<div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
				<Loader2Icon className="me-2 size-4 animate-spin" />
				Loading agent…
			</div>
		);
	}

	if (!found) {
		return (
			<div className="flex flex-col gap-4">
				<Link
					to="/agents"
					className="inline-flex w-fit items-center gap-1.5 text-[12px] text-muted-foreground no-underline transition-[color] duration-150 ease-[var(--ease-out)] hover:text-foreground"
				>
					<ArrowLeftIcon className="size-3.5" />
					Agents
				</Link>
				<p className="text-sm text-muted-foreground">Agent not found in this workspace.</p>
			</div>
		);
	}

	const agent = toUiAgent(found);
	const agentGrants = grants.filter((grant) => grant.agent_id === found.id);
	const runs = runsByAgent[found.id] ?? [];
	const runsBusy = runsLoading[found.id] ?? false;
	const completed = runs.filter((run) => run.status === "completed").length;
	const failed = runs.filter((run) => run.status === "failed").length;
	const eventTotal = runs.reduce((total, run) => total + run.event_count, 0);

	const throughput: ThroughputPoint[] = Array.from({ length: 30 }, (_, index) => {
		const date = new Date();
		date.setDate(date.getDate() - (29 - index));
		const key = date.toDateString();
		const actions = runs.filter(
			(run) => run.started_at && new Date(run.started_at).toDateString() === key
		).length;
		return { date: `${date.toLocaleString("en-US", { month: "short" })} ${date.getDate()}`, actions };
	});

	const outcomes: OutcomeSlice[] = [
		{ name: "success", label: "Completed", value: completed },
		{ name: "pending", label: "Running", value: runs.length - completed - failed },
		{ name: "failed", label: "Failed", value: failed },
	];

	const handleRevoke = async (grant: Grant) => {
		const message = await revokeGrant(grant.id);
		if (message) toast.error(message);
		else toast.success("Grant revoked");
	};

	return (
		<div className="flex flex-col gap-4">
			<Link
				to="/agents"
				className="inline-flex w-fit items-center gap-1.5 text-[12px] text-muted-foreground no-underline transition-[color] duration-150 ease-[var(--ease-out)] hover:text-foreground"
			>
				<ArrowLeftIcon className="size-3.5" />
				Agents
			</Link>

			<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="font-display text-[22px] font-medium tracking-[-0.02em]">{agent.name}</h1>
					<AgentStatus status={agent.status} />
					<span className="font-mono text-[12px] text-muted-foreground">{agent.id}</span>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button variant="outline" size="sm" onClick={() => copyText(found.id, "Agent ID copied")}>
						<CopyIcon className="me-1.5 size-3.5" />
						Copy ID
					</Button>
					<Button variant="outline" size="sm">
						Revoke all access
					</Button>
					<Button size="sm">
						<PauseIcon className="me-1.5 size-3.5" />
						Suspend agent
					</Button>
				</div>
			</div>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard label="Runs" value={String(runs.length)} footnote="recorded executions" />
				<StatCard label="Events" value={String(eventTotal)} footnote="tool calls, results, errors" />
				<StatCard
					label="Completed"
					value={runs.length ? `${Math.round((completed / runs.length) * 100)}%` : "—"}
					footnote={`${completed} of ${runs.length} runs`}
				/>
				<StatCard label="Grants held" value={String(agentGrants.length)} footnote="scoped access" />
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<ActionThroughputChart data={throughput} />
				<ActionOutcomesChart data={outcomes} />
			</div>

			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="space-y-1.5">
							<CardTitle>Runs</CardTitle>
							<CardDescription>Recorded executions. Select a run for its event trace.</CardDescription>
						</div>
						<span className="text-[12px] text-muted-foreground">{runs.length} runs</span>
					</div>
				</CardHeader>
				<CardContent className="px-0">
					{runsBusy && runs.length === 0 ? (
						<div className="grid gap-2 px-4 py-2">
							{[0, 1, 2].map((index) => (
								<Skeleton className="h-12 w-full rounded-[4px]" key={index} />
							))}
						</div>
					) : runs.length > 0 ? (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-8 ps-4"> </TableHead>
									<TableHead>Run</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right tabular-nums">Events</TableHead>
									<TableHead>Started</TableHead>
									<TableHead className="pe-4 text-right tabular-nums">Duration</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{runs.map((run) => {
									const expanded = expandedRun === run.id;
									return [
										<TableRow
											className="h-12 cursor-pointer active:bg-muted/70"
											key={run.id}
											onClick={() => setExpandedRun(expanded ? null : run.id)}
										>
											<TableCell className="ps-4">
												<ChevronRightIcon
													className={cn(
														"size-3.5 text-muted-foreground transition-transform duration-150 ease-[var(--ease-out)]",
														expanded && "rotate-90"
													)}
												/>
											</TableCell>
											<TableCell className="max-w-[220px]">
												<span className="block truncate font-mono text-[12.5px]">{run.id}</span>
												{run.parent_run_id ? (
													<span className="block truncate font-mono text-[11px] text-muted-foreground">
														↳ child of {run.parent_run_id}
													</span>
												) : null}
											</TableCell>
											<TableCell className="text-[12.5px]">
												<span
													className={cn(
														run.status === "completed" && "text-emerald-400",
														run.status === "failed" && "text-red-400",
														run.status === "running" && "text-sky-400"
													)}
												>
													{run.status}
												</span>
											</TableCell>
											<TableCell className="text-right text-[13px] text-muted-foreground tabular-nums">
												{run.event_count}
											</TableCell>
											<TableCell className="font-mono text-[12px] text-muted-foreground tabular-nums">
												{formatDateTime(run.started_at)}
											</TableCell>
											<TableCell className="pe-4 text-right font-mono text-[12px] text-muted-foreground tabular-nums">
												{runDuration(run)}
											</TableCell>
										</TableRow>,
										expanded ? (
											<TableRow key={`${run.id}-events`}>
												<TableCell colSpan={6} className="p-0">
													<RunEvents
														run={run}
														agentName={agent.name}
														onSelectEvent={setSelectedEvent}
														onOpenRun={handleOpenRun}
													/>
												</TableCell>
											</TableRow>
										) : null,
									];
								})}
							</TableBody>
						</Table>
					) : (
						<div className="px-4 pb-4">
							<EmptyState
								title="No runs yet"
								description="Runs appear here once this agent executes through the wrapper."
								icon={<BotIcon className="size-6 text-muted-foreground" />}
							/>
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="space-y-1.5">
							<CardTitle>Access</CardTitle>
							<CardDescription>Grants this agent currently holds.</CardDescription>
						</div>
						<span className="text-[12px] text-muted-foreground">{agentGrants.length} grants</span>
					</div>
				</CardHeader>
				<CardContent className="px-0">
					{grantsLoading && agentGrants.length === 0 ? (
						<GrantsTable grants={[]} loading />
					) : agentGrants.length > 0 ? (
						<GrantsTable grants={agentGrants.map(toGrantRow)} onRevoke={handleRevoke} />
					) : (
						<div className="px-4 pb-4">
							<EmptyState
								title="No grants held"
								description="This agent has no scoped access. Grants appear here once issued."
								icon={<KeyRoundIcon className="size-6 text-muted-foreground" />}
							/>
						</div>
					)}
				</CardContent>
			</Card>

			<AuditEventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} />
		</div>
	);
}
