"use client";

import type * as React from "react";
import { Bar, BarChart, XAxis } from "recharts";
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
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";
import { BarChart3Icon, Loader2Icon } from "lucide-react";

type Props = {
	data: { day: string; tasks: number }[];
	loading?: boolean;
};

const chartConfig = {
	tasks: {
		label: "Tasks",
		color: "var(--chart-2)",
	},
} satisfies ChartConfig;

function CustomGradientBar(
	props: React.SVGProps<SVGRectElement> & {
		index?: number;
		dataKey?: string | number;
	}
) {
	const {
		fill,
		x = 0,
		y = 0,
		width = 0,
		height = 0,
		dataKey = "tasks",
		index = 0,
	} = props;
	const gid = `gradient-bar-${String(dataKey)}-${index}`;

	return (
		<>
			<rect
				fill={`url(#${gid})`}
				height={height}
				stroke="none"
				width={width}
				x={x}
				y={y}
			/>
			<rect fill={fill} height={2} stroke="none" width={width} x={x} y={y} />
			<defs>
				<linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
					<stop offset="0%" stopColor={fill} stopOpacity={0.5} />
					<stop offset="100%" stopColor={fill} stopOpacity={0} />
				</linearGradient>
			</defs>
		</>
	);
}

export function NetRevenueChart({ data, loading }: Props) {
	const first = data[0]?.tasks ?? 0;
	const last = data.at(-1)?.tasks ?? first;
	const growthPct = first ? (((last - first) / first) * 100).toFixed(1) : "0";

	return (
		<DashboardCard className="gap-0 md:col-span-2">
			<CardHeader className="gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<CardTitle>Task executions</CardTitle>
					{!loading && data.length > 0 && (
						<Delta value={Number(growthPct)} variant="badge">
							<DeltaIcon variant="trend" />
							<DeltaValue />
						</Delta>
					)}
				</div>
				<CardDescription>Daily task executions, last 7 days.</CardDescription>
			</CardHeader>
			<CardContent>
				{loading ? (
					<div className="flex h-60 items-center justify-center md:h-80">
						<Loader2Icon className="size-5 animate-spin text-muted-foreground" />
					</div>
				) : data.length === 0 ? (
					<div className="flex h-60 items-center justify-center md:h-80">
						<Empty>
							<EmptyHeader>
								<EmptyMedia>
									<BarChart3Icon className="size-5 text-muted-foreground" />
								</EmptyMedia>
								<EmptyTitle>No executions yet</EmptyTitle>
								<EmptyDescription>
									Task execution data will appear here once you publish your first task.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					</div>
				) : (
					<ChartContainer
						className="aspect-auto h-60 w-full md:h-80"
						config={chartConfig}
					>
						<BarChart accessibilityLayer data={data}>
							<XAxis
								axisLine={false}
								dataKey="day"
								interval={0}
								tickFormatter={(value) => String(value)}
								tickLine={false}
								tickMargin={10}
							/>
							<ChartTooltip
								content={<ChartTooltipContent hideLabel />}
								cursor={false}
							/>
							<Bar
								dataKey="tasks"
								fill="var(--color-tasks)"
								shape={<CustomGradientBar />}
							/>
						</BarChart>
					</ChartContainer>
				)}
			</CardContent>
		</DashboardCard>
	);
}
