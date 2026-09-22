"use client";

import { cn } from "@/lib/utils";
import { actionLabel, actionText } from "@/lib/policy";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/empty-state";
import type { CapabilityMatrixData } from "@/lib/stores/policies-store";
import { BotIcon } from "lucide-react";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

/** Disambiguate agents that share a label — policy matches on name, so
 *  duplicates are indistinguishable to the engine and must be shown as such. */
function columnLabels(agents: { id: string; name: string }[]): Record<string, string> {
	const counts = new Map<string, number>();
	for (const agent of agents) counts.set(agent.name, (counts.get(agent.name) ?? 0) + 1);
	const labels: Record<string, string> = {};
	for (const agent of agents) {
		labels[agent.id] =
			(counts.get(agent.name) ?? 0) > 1 ? `${agent.name} · ${agent.id.slice(-4)}` : agent.name;
	}
	return labels;
}

/**
 * Effective decision per agent per action, projected from the current rules.
 * Evaluated with resource, user and amount unset — a rule conditioned on those
 * fields will not match here. This is a projection of the rules, not a replay
 * of traffic.
 */
export function CapabilityMatrix({
	data,
	loading,
}: {
	data: CapabilityMatrixData | null;
	loading: boolean;
}) {
	if (loading && !data) {
		return (
			<div className="grid gap-2 px-4 py-2">
				{[0, 1, 2].map((index) => (
					<Skeleton className="h-12 w-full rounded-[4px]" key={index} />
				))}
			</div>
		);
	}

	if (!data || data.agents.length === 0) {
		return (
			<div className="px-4 pb-4">
				<EmptyState
					title="No agents yet"
					description="Capability appears here once an agent exists in this workspace."
					icon={<BotIcon className="size-6 text-muted-foreground" />}
				/>
			</div>
		);
	}

	const labels = columnLabels(data.agents);

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="ps-4">Action</TableHead>
					{data.agents.map((agent) => (
						<TableHead className="text-right" key={agent.id} title={agent.id}>
							{labels[agent.id]}
						</TableHead>
					))}
				</TableRow>
			</TableHeader>
			<TableBody>
				{data.matrix.map((row) => (
					<TableRow className="h-12" key={row.action}>
						<TableCell className="ps-4 font-mono text-[12.5px]">{row.action}</TableCell>
						{data.agents.map((agent) => {
							const cell = row.cells[agent.id];
							return (
								<TableCell className="text-right" key={agent.id}>
									{cell ? (
										<span
											className={cn("text-[12.5px]", actionText[cell.decision])}
											title={
												cell.default
													? "No rule matched — falls to the default (deny)."
													: cell.rule
														? `Matched rule: ${cell.rule}`
														: "Nothing is gated while policy is off."
											}
										>
											{cell.default ? "Deny · default" : actionLabel[cell.decision]}
										</span>
									) : (
										<span className="text-[13px] text-muted-foreground/50">—</span>
									)}
								</TableCell>
							);
						})}
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
