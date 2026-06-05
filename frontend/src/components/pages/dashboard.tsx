import { useEffect } from "react";
import { ChannelSalesChart } from "@/components/channel-sales-chart";
import { DashboardInvoices } from "@/components/dashboard-invoices";
import { NetRevenueChart } from "@/components/net-revenue-chart";
import { DashboardStats } from "@/components/stats";
import { useAnalyticsStore } from "@/stores/analytics-store";

export function Dashboard() {
	const data = useAnalyticsStore((s) => s.data);
	const loading = useAnalyticsStore((s) => s.loading);
	const fetch = useAnalyticsStore((s) => s.fetch);

	useEffect(() => {
		fetch();
	}, [fetch]);

	const statCards = data?.stats
		? [
				{ label: "Total tasks", value: data.stats.total_tasks.toLocaleString(), delta: 0 },
				{ label: "Active runs", value: data.stats.active_runs.toLocaleString(), delta: 0 },
				{ label: "Completed today", value: data.stats.completed_today.toLocaleString(), delta: 0 },
				{ label: "Failed", value: data.stats.failed.toLocaleString(), delta: 0 },
			]
		: [];

	return (
		<div className="grid grid-cols-1 gap-px bg-border p-px md:grid-cols-2 lg:grid-cols-4">
			<DashboardStats stats={statCards} loading={loading} />
			<NetRevenueChart data={data?.execution_chart ?? []} loading={loading} />
			<ChannelSalesChart data={data?.run_status_chart ?? []} loading={loading} />
			<DashboardInvoices tasks={data?.recent_tasks ?? []} loading={loading} />
		</div>
	);
}