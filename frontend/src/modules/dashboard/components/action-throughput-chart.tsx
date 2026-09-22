"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ChevronDownIcon } from "lucide-react";

export type ThroughputPoint = {
	date: string;
	actions: number;
};

const chartConfig = {
	actions: {
		label: "Actions",
		color: "var(--chart-2)",
	},
} satisfies ChartConfig;

export function ActionThroughputChart({ data }: { data: ThroughputPoint[] }) {
	return (
		<Card className="lg:col-span-2">
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="space-y-1.5">
						<CardTitle>Action throughput</CardTitle>
						<CardDescription>Durable action executions per day, last 30 days.</CardDescription>
					</div>
					<Button variant="outline" size="sm">
						Last 30 days
						<ChevronDownIcon className="size-4" />
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				<ChartContainer className="aspect-auto h-64 w-full" config={chartConfig}>
					<AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
						<defs>
							<linearGradient id="fillActions" x1="0" x2="0" y1="0" y2="1">
								<stop offset="0%" stopColor="var(--color-actions)" stopOpacity={0.32} />
								<stop offset="100%" stopColor="var(--color-actions)" stopOpacity={0} />
							</linearGradient>
						</defs>
						<CartesianGrid className="stroke-border" vertical={false} />
						<XAxis axisLine={false} dataKey="date" interval={4} tickLine={false} tickMargin={8} />
						<YAxis axisLine={false} tickLine={false} tickMargin={8} width={30} />
						<ChartTooltip content={<ChartTooltipContent hideLabel />} />
						<Area
							dataKey="actions"
							fill="url(#fillActions)"
							stroke="var(--color-actions)"
							strokeWidth={2}
							type="monotone"
						/>
					</AreaChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}
