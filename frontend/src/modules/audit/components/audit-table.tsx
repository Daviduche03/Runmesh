"use client";

import { cn } from "@/lib/utils";
import { outcomeText } from "@/lib/audit";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export type AuditOutcome = "success" | "denied" | "failed" | "escalated" | "timeout";
export type AuditActorType = "agent" | "operator" | "system";
export type AuditMode = "autonomous" | "interactive";
export type AuditType = "agent" | "tool" | "approval" | "consent" | "grant" | "token" | "policy" | "system";

export type AuditEvent = {
	id: string;
	time: string;
	timestamp: number;
	threadId: string | null;
	traceId: string | null;
	parentId: string | null;
	actor: string;
	actorType: AuditActorType;
	onBehalfOf: string;
	mode: AuditMode;
	type: AuditType;
	/** Raw step kind (e.g. tool.call vs tool.result). Shown only where requested. */
	kindLabel?: string;
	action: string;
	authority: string;
	/** Run-event payloads. Separate from authority: args for calls, result for results/errors. */
	argsText?: string | null;
	resultText?: string | null;
	/** Child run spawned by this step (subagent delegation), paired by start order. */
	childRunId?: string | null;
	childAgentId?: string | null;
	childAgentName?: string | null;
	outcome: AuditOutcome;
	offsetMs: number;
	durationMs: number;
};

function RunCell({ traceId }: { traceId: string | null }) {
	if (!traceId) {
		return <span className="font-mono text-[12px] text-amber-400">unchained</span>;
	}
	return <span className="font-mono text-[12px] text-muted-foreground">{traceId}</span>;
}

function AuditSkeletonRow({ compact }: { compact: boolean }) {
	return (
		<TableRow className="h-12">
			<TableCell className="ps-4"><Skeleton className="h-4 w-20" /></TableCell>
			<TableCell><Skeleton className="h-4 w-20" /></TableCell>
			<TableCell><Skeleton className="h-4 w-28" /></TableCell>
			{compact ? null : <TableCell><Skeleton className="h-4 w-16" /></TableCell>}
			<TableCell><Skeleton className="h-4 w-32" /></TableCell>
			<TableCell className="pe-4"><Skeleton className="ms-auto h-4 w-14" /></TableCell>
		</TableRow>
	);
}

export function AuditTable({
	events,
	loading,
	compact = false,
	onSelect,
}: {
	events: AuditEvent[];
	loading?: boolean;
	compact?: boolean;
	onSelect?: (event: AuditEvent) => void;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="ps-4">Time</TableHead>
					<TableHead>Actor</TableHead>
					<TableHead>On behalf of</TableHead>
					{compact ? null : <TableHead>Run</TableHead>}
					<TableHead>Action</TableHead>
					<TableHead className="pe-4 text-right">Outcome</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{loading ? (
					Array.from({ length: compact ? 4 : 6 }).map((_, index) => (
						<AuditSkeletonRow compact={compact} key={index} />
					))
				) : (
					events.map((event) => (
						<TableRow
							className={cn("h-12", onSelect && "cursor-pointer active:bg-muted/70")}
							key={event.id}
							onClick={onSelect ? () => onSelect(event) : undefined}
						>
							<TableCell className="ps-4 font-mono text-[12px] text-muted-foreground tabular-nums">
								{event.time}
							</TableCell>
							<TableCell>
								<span className="flex items-center gap-2">
									<span className="text-[13px] font-medium">{event.actor}</span>
									<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
										{event.actorType}
									</span>
								</span>
							</TableCell>
							<TableCell className="text-[13px] text-muted-foreground">{event.onBehalfOf}</TableCell>
							{compact ? null : (
								<TableCell><RunCell traceId={event.traceId} /></TableCell>
							)}
							<TableCell className="font-mono text-[12.5px]">{event.action}</TableCell>
							<TableCell className={cn("pe-4 text-right font-mono text-[12px]", outcomeText[event.outcome])}>
								{event.outcome}
							</TableCell>
						</TableRow>
					))
				)}
			</TableBody>
		</Table>
	);
}
