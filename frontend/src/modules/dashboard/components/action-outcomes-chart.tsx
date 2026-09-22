"use client";

import { Cell, Pie, PieChart } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export type OutcomeSlice = {
	name: string;
	label: string;
	value: number;
};

const chartConfig = {
	success: { label: "Success", color: "var(--chart-3)" },
	pending: { label: "Pending approval", color: "var(--chart-4)" },
	failed: { label: "Failed", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function ActionOutcomesChart({ data }: { data: OutcomeSlice[] }) {
	const success = data.find((slice) => slice.name === "success");

	return (
		<Card>
			<CardHeader>
				<CardTitle>Action outcomes</CardTitle>
				<CardDescription>Share of actions in the last 30 days.</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col items-center gap-6">
				<div className="relative">
					<ChartContainer className="aspect-square h-44" config={chartConfig}>
						<PieChart>
							<ChartTooltip content={<ChartTooltipContent hideLabel />} />
							<Pie
								data={data}
								dataKey="value"
								innerRadius={58}
								nameKey="name"
								outerRadius={84}
								paddingAngle={2}
								strokeWidth={0}
							>
								{data.map((entry) => (
									<Cell fill={`var(--color-${entry.name})`} key={entry.name} />
								))}
							</Pie>
						</PieChart>
					</ChartContainer>
					{success ? (
						<div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
							<div>
								<div className="text-[22px] leading-none font-medium tabular-nums">{success.value}%</div>
								<div className="mt-1 text-[11px] text-muted-foreground">success</div>
							</div>
						</div>
					) : null}
				</div>
				<ul className="w-full space-y-2">
					{data.map((entry) => (
						<li className="flex items-center gap-2 text-[13px]" key={entry.name}>
							<span
								className="size-2 rounded-full"
								style={{ backgroundColor: `var(--color-${entry.name})` }}
								aria-hidden
							/>
							<span className="text-muted-foreground">{entry.label}</span>
							<span className="ml-auto tabular-nums">{entry.value}%</span>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
