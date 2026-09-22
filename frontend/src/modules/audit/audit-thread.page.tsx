"use client";

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/modules/dashboard/components/stat-card";
import { TraceView } from "@/modules/audit/components/trace-view";
import { AuditEventDetail } from "@/modules/audit/components/audit-event-detail";
import type { AuditEvent, AuditOutcome } from "@/modules/audit/components/audit-table";
import { outcomeText } from "@/lib/audit";
import { downloadAuditCsv } from "@/lib/audit-export";
import { useAuditStore } from "@/lib/stores/audit-store";
import { ArrowLeftIcon, DownloadIcon } from "lucide-react";

const severity: Record<AuditOutcome, number> = { success: 0, timeout: 1, escalated: 2, failed: 3, denied: 4 };

function worstOutcome(list: AuditEvent[]): AuditOutcome {
	return list.reduce<AuditOutcome>((acc, event) => (severity[event.outcome] > severity[acc] ? event.outcome : acc), "success");
}

export function AuditThreadPage() {
	const { threadId } = useParams<{ threadId: string }>();
	const events = useAuditStore((s) => s.events);
	const loading = useAuditStore((s) => s.loading);
	const fetchAudit = useAuditStore((s) => s.fetch);
	const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);

	useEffect(() => {
		fetchAudit();
	}, [fetchAudit]);

	const key = threadId && threadId !== "unchained" ? threadId : null;
	const threadEvents = useMemo(() => events.filter((event) => event.threadId === key), [events, key]);

	const runs = useMemo(() => {
		const map = new Map<string | null, AuditEvent[]>();
		for (const event of threadEvents) {
			const list = map.get(event.traceId) ?? [];
			list.push(event);
			map.set(event.traceId, list);
		}
		return Array.from(map.entries()).map(([traceId, list]) => ({ traceId, events: list }));
	}, [threadEvents]);

	const principal = threadEvents.find((event) => event.onBehalfOf !== "—")?.onBehalfOf ?? "—";
	const agents = Array.from(
		new Set(threadEvents.filter((event) => event.actorType === "agent").map((event) => event.actor))
	);
	const outcome = worstOutcome(threadEvents);
	const denied = threadEvents.filter((event) => event.outcome === "denied").length;
	const escalated = threadEvents.filter((event) => event.outcome === "escalated").length;

	return (
		<div className="flex flex-col gap-4">
			<Link
				to="/audit"
				className="inline-flex w-fit items-center gap-1.5 text-[12px] text-muted-foreground no-underline transition-[color] duration-150 ease-[var(--ease-out)] hover:text-foreground"
			>
				<ArrowLeftIcon className="size-3.5" />
				Audit
			</Link>

			<div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
				<div>
					<h1 className="font-display text-[22px] font-medium tracking-[-0.02em]">
						{key ?? "Unchained events"}
					</h1>
					<p className="mt-1 text-[13px] text-muted-foreground">
						{principal}
						{agents.length ? ` · ${agents.join(", ")}` : ""} ·{" "}
						<span className={outcomeText[outcome]}>{outcome}</span>
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => downloadAuditCsv(`audit-thread-${key ?? "unchained"}.csv`, threadEvents)}
				>
					<DownloadIcon className="size-3.5" />
					Export thread
				</Button>
			</div>

			{loading && events.length === 0 ? (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{[0, 1, 2, 3].map((index) => (
						<Skeleton className="h-[86px] rounded-[4px]" key={index} />
					))}
				</div>
			) : threadEvents.length === 0 ? (
				<p className="py-8 text-center text-[13px] text-muted-foreground">
					No events in this thread.
				</p>
			) : (
				<>
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<StatCard label="Runs" value={String(runs.length)} footnote="operations in this thread" />
						<StatCard label="Events" value={String(threadEvents.length)} footnote="recorded steps" />
						<StatCard label="Denied" value={String(denied)} footnote="blocked by policy" />
						<StatCard label="Escalated" value={String(escalated)} footnote="sent to a human" />
					</div>

					<Card>
						<CardHeader>
							<div className="space-y-1.5">
								<CardTitle>Trace</CardTitle>
								<CardDescription>Thread → runs → steps. Switch between the timeline and the call tree.</CardDescription>
							</div>
						</CardHeader>
						<CardContent className="px-0">
							<TraceView runs={runs} onSelectEvent={setSelectedEvent} />
						</CardContent>
					</Card>
				</>
			)}

			<AuditEventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} />
		</div>
	);
}
