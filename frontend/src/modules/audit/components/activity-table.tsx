"use client";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export type ActivityResult = "ok" | "pending" | "failed";

export type ActivityEvent = {
	time: string;
	action: string;
	grant: string;
	agent?: string;
	result: ActivityResult;
	detail?: string;
};

const resultText: Record<ActivityResult, string> = {
	ok: "text-muted-foreground/70",
	pending: "text-amber-400",
	failed: "text-red-400",
};

function ActivitySkeletonRow() {
	return (
		<TableRow className="h-11">
			<TableCell className="ps-4"><Skeleton className="h-4 w-12" /></TableCell>
			<TableCell><Skeleton className="h-4 w-40" /></TableCell>
			<TableCell><Skeleton className="h-4 w-16" /></TableCell>
			<TableCell className="pe-4"><Skeleton className="ms-auto h-4 w-16" /></TableCell>
		</TableRow>
	);
}

export function ActivityTable({
	events,
	loading,
	showAgent = false,
}: {
	events: ActivityEvent[];
	loading?: boolean;
	showAgent?: boolean;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="ps-4">Time</TableHead>
					{showAgent ? <TableHead>Agent</TableHead> : null}
					<TableHead>Action</TableHead>
					<TableHead>Grant</TableHead>
					<TableHead className="pe-4 text-right">Result</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{loading ? (
					Array.from({ length: 4 }).map((_, index) => <ActivitySkeletonRow key={index} />)
				) : (
					events.map((event, index) => (
						<TableRow key={`${event.time}-${index}`}>
							<TableCell className="ps-4 font-mono text-[12.5px] text-muted-foreground tabular-nums">
								{event.time}
							</TableCell>
							{showAgent ? (
								<TableCell className="text-[13px] font-medium">{event.agent}</TableCell>
							) : null}
							<TableCell className="font-mono text-[12.5px]">{event.action}</TableCell>
							<TableCell className="font-mono text-[12.5px] text-muted-foreground">{event.grant}</TableCell>
							<TableCell className={cn("pe-4 text-right font-mono text-[12px] capitalize", resultText[event.result])}>
								{event.result === "failed" && event.detail ? `failed · ${event.detail}` : event.result}
							</TableCell>
						</TableRow>
					))
				)}
			</TableBody>
		</Table>
	);
}
