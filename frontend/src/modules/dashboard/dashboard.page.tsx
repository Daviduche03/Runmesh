import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/modules/dashboard/components/stat-card";
import { ActionThroughputChart, type ThroughputPoint } from "@/modules/dashboard/components/action-throughput-chart";
import { ActionOutcomesChart, type OutcomeSlice } from "@/modules/dashboard/components/action-outcomes-chart";
import { AuditTable } from "@/modules/audit/components/audit-table";
import { useAuditStore } from "@/lib/stores/audit-store";

const throughput: ThroughputPoint[] = Array.from({ length: 30 }, (_, index) => {
	const date = new Date(2026, 3, 19);
	date.setDate(date.getDate() + index);
	const actions = Math.round(96 + 28 * Math.sin(index / 3.1) + (index > 23 ? 26 : 0) + (index % 5 === 0 ? 12 : 0));
	return { date: `${date.toLocaleString("en-US", { month: "short" })} ${date.getDate()}`, actions };
});

const outcomes: OutcomeSlice[] = [
	{ name: "success", label: "Success", value: 82 },
	{ name: "pending", label: "Pending approval", value: 9 },
	{ name: "failed", label: "Failed", value: 9 },
];

export function Dashboard() {
	const recentEvents = useAuditStore((s) => s.events);
	const auditLoading = useAuditStore((s) => s.loading);
	const fetchAudit = useAuditStore((s) => s.fetch);

	useEffect(() => {
		fetchAudit();
	}, [fetchAudit]);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
				<div>
					<h1 className="font-display text-[22px] font-medium tracking-[-0.02em]">Control room</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						What is waiting on you, what is running, and what is wrong.
					</p>
				</div>
				<Button asChild variant="outline" size="sm">
					<Link to="/policies">Review policies</Link>
				</Button>
			</div>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard label="Pending consent" value="3" footnote="awaiting users" />
				<StatCard label="Active agents" value="3" footnote="1 awaiting policy" />
				<StatCard label="Actions today" value="128" delta={12.4} footnote="vs yesterday" />
				<StatCard label="Success rate" value="98.4%" delta={1.1} footnote="vs last week" />
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<ActionThroughputChart data={throughput} />
				<ActionOutcomesChart data={outcomes} />
			</div>

			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="space-y-1.5">
							<CardTitle>Recent audit</CardTitle>
							<CardDescription>Who did what, on whose behalf.</CardDescription>
						</div>
						<Button asChild variant="outline" size="sm">
							<Link to="/audit">View all</Link>
						</Button>
					</div>
				</CardHeader>
				<CardContent className="px-0">
					<AuditTable events={recentEvents.slice(0, 5)} loading={auditLoading && recentEvents.length === 0} compact />
				</CardContent>
			</Card>
		</div>
	);
}
