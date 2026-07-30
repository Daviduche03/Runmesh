import { useEffect } from "react";
import { ChannelSalesChart } from "@/components/channel-sales-chart";
import { DashboardInvoices } from "@/components/dashboard-invoices";
import { NetRevenueChart } from "@/components/net-revenue-chart";
import { DashboardStats } from "@/components/stats";
import { useAnalyticsStore } from "@/stores/analytics-store";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ActivityIcon, GitBranchIcon } from "lucide-react";

export function Dashboard() {
	const data = useAnalyticsStore((s) => s.data);
	const loading = useAnalyticsStore((s) => s.loading);
	const fetch = useAnalyticsStore((s) => s.fetch);

	useEffect(() => {
		fetch();
	}, [fetch]);

	const statCards = data?.stats
		? [
				{ label: "Agent actions", value: data.stats.total_tasks.toLocaleString(), delta: 0 },
				{ label: "Active runs", value: data.stats.active_runs.toLocaleString(), delta: 0 },
				{ label: "Completed today", value: data.stats.completed_today.toLocaleString(), delta: 0 },
				{ label: "Needs attention", value: data.stats.failed.toLocaleString(), delta: 0 },
			]
		: [];

	return (
		<div className="grid gap-4">
			<div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Agent operations</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Watch durable actions, workflow runs, delegated access, and workspace activity from one control plane.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button asChild variant="outline" size="sm">
						<Link to="/workflows">
							<GitBranchIcon className="size-4" />
							New workflow
						</Link>
					</Button>
					<Button asChild size="sm">
						<Link to="/runs">
							<ActivityIcon className="size-4" />
							New action
						</Link>
					</Button>
				</div>
			</div>

			<div className="grid grid-cols-1 gap-px bg-border p-px md:grid-cols-2 lg:grid-cols-4">
				<DashboardStats stats={statCards} loading={loading} />
				<NetRevenueChart data={data?.execution_chart ?? []} loading={loading} />
				<ChannelSalesChart data={data?.run_status_chart ?? []} loading={loading} />
				<DashboardInvoices tasks={data?.recent_tasks ?? []} loading={loading} />
			</div>
		</div>
	);
}
