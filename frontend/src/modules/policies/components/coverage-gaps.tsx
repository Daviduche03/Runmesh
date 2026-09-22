"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/empty-state";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { CoverageGap } from "@/lib/stores/policies-store";
import { EyeOffIcon, PlusIcon } from "lucide-react";

function relativeTime(iso: string): string {
	if (!iso) return "—";
	const ms = Date.now() - new Date(iso).getTime();
	if (Number.isNaN(ms) || ms < 0) return "just now";
	const minutes = Math.floor(ms / 60000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

/**
 * Default-deny makes gaps invisible: an unmatched action is refused, so nobody
 * learns it was wanted. This surfaces what the default is actually catching,
 * read from the decision ledger.
 */
export function CoverageGaps({
	gaps,
	loading,
	onAddRule,
}: {
	gaps: CoverageGap[];
	loading: boolean;
	onAddRule?: (gap: CoverageGap) => void;
}) {
	if (loading && gaps.length === 0) {
		return (
			<div className="grid gap-2 px-4 py-2">
				{[0, 1, 2].map((index) => (
					<Skeleton className="h-12 w-full rounded-[4px]" key={index} />
				))}
			</div>
		);
	}

	if (gaps.length === 0) {
		return (
			<div className="px-4 pb-4">
				<EmptyState
					title="No gaps yet"
					description="Requests that match no rule will appear here."
					icon={<EyeOffIcon className="size-6 text-muted-foreground" />}
				/>
			</div>
		);
	}

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="ps-4">Unmatched action</TableHead>
					<TableHead>Requested by</TableHead>
					<TableHead>Last seen</TableHead>
					<TableHead className="text-right tabular-nums">Blocked by default</TableHead>
					<TableHead className="pe-4 text-right"> </TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{gaps.map((gap) => (
					<TableRow className="h-12" key={gap.action}>
						<TableCell className="ps-4 font-mono text-[12.5px]">{gap.action}</TableCell>
						<TableCell className="text-[13px] text-muted-foreground">
							{gap.agents.join(", ") || "—"}
						</TableCell>
						<TableCell className="font-mono text-[12px] text-muted-foreground tabular-nums">
							{relativeTime(gap.lastSeen)}
						</TableCell>
						<TableCell className="text-right text-[13px] font-medium tabular-nums text-amber-400">
							{gap.blocked}
						</TableCell>
						<TableCell className="pe-4 text-right">
							<Button
								size="xs"
								variant="outline"
								onClick={onAddRule ? () => onAddRule(gap) : undefined}
							>
								<PlusIcon className="me-1 size-3" />
								Add rule
							</Button>
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
