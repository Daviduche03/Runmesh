"use client";

import { useId } from "react";
import { CartesianGrid, Line, LineChart, XAxis } from "recharts";
import { formatDate } from "@/components/formater";
import {
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import { DashboardCard } from "@/components/dashboard-card";
import { ActivityIcon, Loader2Icon } from "lucide-react";
import EmptyState from "./empty-state";

const VISIBLE_DAYS = 7;

type RunChartRow = {
	date: string;
	successful: number;
	failed: number;
};

type Props = {
	data: RunChartRow[];
	loading?: boolean;
};

function rowTotal(row: RunChartRow) {
	return row.successful + row.failed;
}

function growthPctForWindow(rows: readonly RunChartRow[]) {
	const first = rows[0];
	if (!first) return 0;
	const last = rows.at(-1);
	if (!last) return 0;
	const a = rowTotal(first);
	const b = rowTotal(last);
	if (!a) return 0;
	return ((b - a) / a) * 100;
}

const chartConfig = {
	successful: {
		label: "Successful",
		color: "var(--chart-2)",
	},
	failed: {
		label: "Failed",
		color: "var(--chart-1)",
	},
} satisfies ChartConfig;

export function ChannelSalesChart({ data, loading }: Props) {
	const chartUid = useId().replace(/:/g, "");
	const idLineGlow = `run-status-line-glow-${chartUid}`;
	const growthPctNum = growthPctForWindow(data);

	return (
		<DashboardCard className="gap-0 md:col-span-2">
			<CardHeader>
				<div className="min-w-0 space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<CardTitle>Run status</CardTitle>
						{!loading && data.length > 0 && (
							<Delta value={growthPctNum} variant="badge">
								<DeltaIcon variant="trend" />
								<DeltaValue />
							</Delta>
						)}
					</div>
					<CardDescription>
						Daily successful vs failed runs, last {VISIBLE_DAYS} days.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="flex h-60 items-center justify-center md:h-80">
				{loading ? (
					<div className="flex h-60 items-center justify-center md:h-80">
						<Loader2Icon className="size-5 animate-spin text-muted-foreground" />
					</div>
				) : data.length === 0 ? (
				<EmptyState 
					title="No data"
					description="No run data available for the selected period."
					icon={<ActivityIcon className="size-6 text-muted-foreground" />}
				/>
				) : (
					<ChartContainer
						className="aspect-auto h-60 w-full p-0 md:h-80"
						config={chartConfig}
					>
						<LineChart
							accessibilityLayer
							data={data}
							margin={{
								left: 12,
								right: 12,
								top: 8,
							}}
						>
							<CartesianGrid className="stroke-border" vertical={false} />
							<XAxis
								axisLine={false}
								dataKey="date"
								interval={0}
								tickFormatter={(value) => formatDate(String(value), "day-month")}
								tickLine={false}
								tickMargin={8}
							/>
							<ChartTooltip
								content={<ChartTooltipContent hideLabel />}
								cursor={false}
							/>
							<defs>
								<filter
									height="140%"
									id={idLineGlow}
									width="140%"
									x="-20%"
									y="-20%"
								>
									<feGaussianBlur result="blur" stdDeviation="10" />
									<feComposite in="SourceGraphic" in2="blur" operator="over" />
								</filter>
							</defs>
							<Line
								dataKey="failed"
								dot={false}
								filter={`url(#${idLineGlow})`}
								stroke="var(--color-failed)"
								strokeWidth={2}
								type="step"
							/>
							<Line
								dataKey="successful"
								dot={false}
								filter={`url(#${idLineGlow})`}
								stroke="var(--color-successful)"
								strokeWidth={2}
								type="step"
							/>
						</LineChart>
					</ChartContainer>
				)}
			</CardContent>
		</DashboardCard>
	);
}
