"use client";

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/modules/dashboard/components/stat-card";
import { SegmentedControl } from "@/components/segmented-control";
import { AuditTable, type AuditEvent, type AuditOutcome } from "@/modules/audit/components/audit-table";
import { AuditEventDetail } from "@/modules/audit/components/audit-event-detail";
import { outcomeText } from "@/lib/audit";
import { downloadAuditCsv } from "@/lib/audit-export";
import { useAuditStore } from "@/lib/stores/audit-store";
import EmptyState from "@/components/empty-state";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { DownloadIcon, ScrollTextIcon, SearchIcon } from "lucide-react";

const outcomeOptions = [
	{ label: "Any outcome", value: "all" },
	{ label: "Success", value: "success" },
	{ label: "Denied", value: "denied" },
	{ label: "Failed", value: "failed" },
	{ label: "Escalated", value: "escalated" },
] as const;

const modeOptions = [
	{ label: "Any mode", value: "all" },
	{ label: "Autonomous", value: "autonomous" },
	{ label: "Interactive", value: "interactive" },
] as const;

const viewOptions = [
	{ label: "Threads", value: "threads" },
	{ label: "Events", value: "events" },
] as const;

const severity: Record<AuditOutcome, number> = { success: 0, timeout: 1, escalated: 2, failed: 3, denied: 4 };

function worstOutcome(list: AuditEvent[]): AuditOutcome {
	return list.reduce<AuditOutcome>((acc, event) => (severity[event.outcome] > severity[acc] ? event.outcome : acc), "success");
}

export function AuditPage() {
	const events = useAuditStore((s) => s.events);
	const loading = useAuditStore((s) => s.loading);
	const fetchAudit = useAuditStore((s) => s.fetch);
	const [view, setView] = useState<(typeof viewOptions)[number]["value"]>("threads");
	const [query, setQuery] = useState("");
	const [outcome, setOutcome] = useState<(typeof outcomeOptions)[number]["value"]>("all");
	const [mode, setMode] = useState<(typeof modeOptions)[number]["value"]>("all");
	const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
	const navigate = useNavigate();

	useEffect(() => {
		fetchAudit();
	}, [fetchAudit]);

	const filtered = useMemo(
		() =>
			events.filter((event) => {
				if (outcome !== "all" && event.outcome !== outcome) return false;
				if (mode !== "all" && event.mode !== mode) return false;
				if (query) {
					const q = query.toLowerCase();
					if (
						!event.actor.toLowerCase().includes(q) &&
						!event.onBehalfOf.toLowerCase().includes(q) &&
						!event.action.toLowerCase().includes(q) &&
						!event.authority.toLowerCase().includes(q) &&
						!(event.traceId ?? "").toLowerCase().includes(q)
					) {
						return false;
					}
				}
				return true;
			}),
		[events, query, outcome, mode]
	);

	const threads = useMemo(() => {
		const map = new Map<string | null, AuditEvent[]>();
		for (const event of filtered) {
			const list = map.get(event.threadId) ?? [];
			list.push(event);
			map.set(event.threadId, list);
		}
		return Array.from(map.entries()).map(([threadId, list]) => ({
			threadId,
			principal: list.find((event) => event.onBehalfOf !== "—")?.onBehalfOf ?? "—",
			agents: Array.from(new Set(list.filter((event) => event.actorType === "agent").map((event) => event.actor))),
			runs: new Set(list.map((event) => event.traceId)).size,
			count: list.length,
			started: [...list].sort((a, b) => a.timestamp - b.timestamp)[0]?.time ?? "—",
			outcome: worstOutcome(list),
		}));
	}, [filtered]);

	const denied = events.filter((event) => event.outcome === "denied").length;
	const escalated = events.filter((event) => event.outcome === "escalated").length;
	const attributed = events.length
		? Math.round((events.filter((event) => event.onBehalfOf !== "—").length / events.length) * 100)
		: 100;
	const unchained = events.filter((event) => event.threadId == null).length;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
				<div>
					<h1 className="font-display text-[22px] font-medium tracking-[-0.02em]">Audit</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						The accountability ledger. Threads group an agent session; runs group one operation; every event
						traces back to the human it was taken on behalf of.
					</p>
				</div>
				<Button variant="outline" size="sm" onClick={() => downloadAuditCsv("audit-export.csv", filtered)}>
					<DownloadIcon className="size-3.5" />
					Export
				</Button>
			</div>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard label="Denied" value={loading && events.length === 0 ? "…" : String(denied)} footnote="blocked by policy" />
				<StatCard label="Escalated" value={loading && events.length === 0 ? "…" : String(escalated)} footnote="sent to a human" />
				<StatCard label="Attributed" value={loading && events.length === 0 ? "…" : `${attributed}%`} footnote="traceable to a principal" />
				<StatCard label="Unchained" value={loading && events.length === 0 ? "…" : String(unchained)} footnote="operator & system events" />
			</div>

			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="space-y-1.5">
							<CardTitle>{view === "threads" ? "Threads" : "All events"}</CardTitle>
							<CardDescription>
								{view === "threads"
									? "Agent sessions. Open one for its runs and events."
									: "Immutable and append-only. Select a row for the full record."}
							</CardDescription>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<SegmentedControl options={viewOptions} value={view} onChange={setView} />
							<div className="relative">
								<SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
								<Input
									placeholder="Actor, principal, action, trace…"
									className="h-8 w-64 pl-8"
									value={query}
									onChange={(e) => setQuery(e.target.value)}
								/>
							</div>
						</div>
					</div>
				</CardHeader>
				<CardContent className="px-0">
					<div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
						<SegmentedControl options={outcomeOptions} value={outcome} onChange={setOutcome} />
						<SegmentedControl options={modeOptions} value={mode} onChange={setMode} />
					</div>

					{loading && events.length === 0 ? (
						<Table>
							<TableBody>
								{Array.from({ length: 5 }).map((_, index) => (
									<TableRow className="h-12" key={index}>
										<TableCell className="ps-4"><Skeleton className="h-4 w-32" /></TableCell>
										<TableCell><Skeleton className="h-4 w-24" /></TableCell>
										<TableCell><Skeleton className="h-4 w-24" /></TableCell>
										<TableCell className="pe-4"><Skeleton className="ms-auto h-4 w-16" /></TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					) : view === "threads" ? (
						threads.length > 0 ? (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="ps-4">Thread</TableHead>
										<TableHead>Principal</TableHead>
										<TableHead>Agents</TableHead>
										<TableHead className="text-right tabular-nums">Runs</TableHead>
										<TableHead className="text-right tabular-nums">Events</TableHead>
										<TableHead>Started</TableHead>
										<TableHead className="pe-4 text-right">Outcome</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{threads.map((thread) => (
										<TableRow
											className="h-12 cursor-pointer active:bg-muted/70"
											key={thread.threadId ?? "unchained"}
											onClick={() => navigate(`/audit/threads/${thread.threadId ?? "unchained"}`)}
										>
											<TableCell className="ps-4 font-mono text-[12.5px] font-medium">
												{thread.threadId ?? <span className="text-amber-400">unchained</span>}
											</TableCell>
											<TableCell className="text-[13px] text-muted-foreground">{thread.principal}</TableCell>
											<TableCell className="text-[13px]">{thread.agents.join(", ") || "—"}</TableCell>
											<TableCell className="text-right text-[13px] text-muted-foreground tabular-nums">
												{thread.runs}
											</TableCell>
											<TableCell className="text-right text-[13px] text-muted-foreground tabular-nums">
												{thread.count}
											</TableCell>
											<TableCell className="font-mono text-[12px] text-muted-foreground tabular-nums">
												{thread.started}
											</TableCell>
											<TableCell className={outcomeText[thread.outcome]}>{thread.outcome}</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						) : (
							<div className="px-4 pb-4">
								<EmptyState
									title="No audit events yet"
									description="Events appear here as agents act, connect accounts, and policy decides."
									icon={<ScrollTextIcon className="size-6 text-muted-foreground" />}
								/>
							</div>
						)
					) : filtered.length > 0 ? (
						<AuditTable events={filtered} onSelect={setSelectedEvent} />
					) : (
						<div className="px-4 pb-4">
							<EmptyState
								title="No audit events yet"
								description="Events appear here as agents act, connect accounts, and policy decides."
								icon={<ScrollTextIcon className="size-6 text-muted-foreground" />}
							/>
						</div>
					)}
				</CardContent>
			</Card>

			<AuditEventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} />
		</div>
	);
}
