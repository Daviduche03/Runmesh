"use client";

import { useMemo, useState, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/segmented-control";
import { outcomeText, formatDuration } from "@/lib/audit";
import type { AuditEvent, AuditOutcome, AuditType } from "@/modules/audit/components/audit-table";
import {
	BotIcon,
	CheckCheckIcon,
	ChevronRightIcon,
	KeyRoundIcon,
	ScrollTextIcon,
	SearchIcon,
	ServerIcon,
	ShieldCheckIcon,
	TicketIcon,
	WrenchIcon,
} from "lucide-react";

export type TraceRun = {
	traceId: string | null;
	/** Display title for the run header. Falls back to the first step's actor/action. */
	runTitle?: string;
	events: AuditEvent[];
};

type TreeEvent = AuditEvent & { __children: TreeEvent[] };

const typeIcon: Record<AuditType, ComponentType<{ className?: string }>> = {
	agent: BotIcon,
	tool: WrenchIcon,
	approval: CheckCheckIcon,
	consent: ShieldCheckIcon,
	grant: KeyRoundIcon,
	token: TicketIcon,
	policy: ScrollTextIcon,
	system: ServerIcon,
};

const typeColor: Record<AuditType, string> = {
	agent: "text-foreground",
	tool: "text-sky-400",
	approval: "text-amber-400",
	consent: "text-emerald-400",
	grant: "text-violet-400",
	token: "text-muted-foreground",
	policy: "text-foreground",
	system: "text-muted-foreground",
};

const barBg: Record<AuditOutcome, string> = {
	success: "bg-emerald-400/70",
	denied: "bg-red-400/70",
	failed: "bg-red-400/70",
	escalated: "bg-amber-400/70",
	timeout: "bg-muted-foreground/40",
};

const severity: Record<AuditOutcome, number> = { success: 0, timeout: 1, escalated: 2, failed: 3, denied: 4 };

function worstOutcome(list: AuditEvent[]): AuditOutcome {
	return list.reduce<AuditOutcome>((acc, event) => (severity[event.outcome] > severity[acc] ? event.outcome : acc), "success");
}

function OutcomeMark({ outcome }: { outcome: AuditOutcome }) {
	if (outcome === "success") {
		return <span className="size-1.5 shrink-0 rounded-full bg-emerald-400/60" aria-label="success" />;
	}
	return <span className={cn("shrink-0 font-mono text-[11px]", outcomeText[outcome])}>{outcome}</span>;
}

function TypeMark({ type }: { type: AuditType }) {
	const Icon = typeIcon[type];
	return <Icon className={cn("size-3.5 shrink-0", typeColor[type])} />;
}

const modeOptions = [
	{ label: "Tree", value: "tree" },
	{ label: "Timeline", value: "timeline" },
] as const;

const focusOptions = [
	{ label: "All", value: "all" },
	{ label: "Denied", value: "denied" },
	{ label: "Escalated", value: "escalated" },
	{ label: "Failed", value: "failed" },
] as const;

function TreeNode({
	event,
	parentActor,
	collapsed,
	onToggle,
	onSelect,
	showKinds,
	onOpenRun,
}: {
	event: TreeEvent;
	parentActor: string;
	collapsed: Set<string>;
	onToggle: (id: string) => void;
	onSelect?: (event: AuditEvent) => void;
	showKinds?: boolean;
	onOpenRun?: (runId: string, agentId: string | null) => void;
}) {
	const children = event.__children;
	const isCollapsed = collapsed.has(event.id);
	const showActor = event.actor !== parentActor;

	return (
		<li className="relative">
			<span aria-hidden className="absolute top-[15px] -left-3 h-px w-3 bg-border" />
			<button
				type="button"
				onClick={onSelect ? () => onSelect(event) : undefined}
				className="flex w-full items-center gap-2.5 rounded-[3px] px-2 py-1.5 text-left transition-colors duration-150 ease-[var(--ease-out)] hover:bg-muted/40 active:bg-muted/70"
			>
				{children.length > 0 ? (
					<span
						onClick={(clickEvent) => {
							clickEvent.stopPropagation();
							onToggle(event.id);
						}}
						className="grid size-3.5 shrink-0 cursor-pointer place-items-center text-muted-foreground"
					>
						<ChevronRightIcon
							className={cn("size-3.5 transition-transform duration-150 ease-[var(--ease-out)]", !isCollapsed && "rotate-90")}
						/>
					</span>
				) : (
					<span className="size-3.5 shrink-0" />
				)}
				<TypeMark type={event.type} />
				<span className="truncate font-mono text-[12.5px]">{event.action}</span>
				{showKinds && event.kindLabel ? (
					<span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/70">{event.kindLabel}</span>
				) : null}
				{showActor ? (
					<span className="shrink-0 text-[12px] text-muted-foreground">{event.actor}</span>
				) : null}
				<span className="ms-1 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
					{formatDuration(event.durationMs)}
				</span>
				<OutcomeMark outcome={event.outcome} />
			</button>
			{event.childRunId && onOpenRun ? (
				<button
					type="button"
					onClick={(clickEvent) => {
						clickEvent.stopPropagation();
						onOpenRun(event.childRunId as string, event.childAgentId ?? null);
					}}
					className="ms-9 mt-1 flex w-fit items-center gap-1.5 font-mono text-[11px] text-sky-400 no-underline transition-[color] duration-150 ease-[var(--ease-out)] hover:text-sky-300"
				>
					↳ opened {event.childAgentName ?? "run"} · {event.childRunId}
				</button>
			) : null}
			{children.length > 0 && !isCollapsed ? (
				<ul className="relative ms-4 border-l border-border ps-3">
					{children.map((child) => (
						<TreeNode
							event={child}
							key={child.id}
							parentActor={event.actor}
							collapsed={collapsed}
							onToggle={onToggle}
							onSelect={onSelect}
							showKinds={showKinds}
							onOpenRun={onOpenRun}
						/>
					))}
				</ul>
			) : null}
		</li>
	);
}

export function TraceView({
	runs,
	onSelectEvent,
	toolbar = true,
	showKinds = false,
	onOpenRun,
}: {
	runs: TraceRun[];
	onSelectEvent?: (event: AuditEvent) => void;
	/** Embedded single-run views hide the toolbar; the audit page keeps it. */
	toolbar?: boolean;
	/** Surface the raw step kind (tool.call vs tool.result) next to the action. */
	showKinds?: boolean;
	/** Navigate to a spawned child run (subagent delegation). */
	onOpenRun?: (runId: string, agentId: string | null) => void;
}) {
	const [mode, setMode] = useState<(typeof modeOptions)[number]["value"]>("tree");
	const [focus, setFocus] = useState<(typeof focusOptions)[number]["value"]>("all");
	const [query, setQuery] = useState("");
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

	const visibleRuns = useMemo(() => {
		const matches = (event: AuditEvent) => {
			if (focus !== "all" && event.outcome !== focus) return false;
			if (query) {
				const q = query.toLowerCase();
				return [event.action, event.actor, event.onBehalfOf, event.authority, event.traceId ?? ""].some((value) =>
					value.toLowerCase().includes(q)
				);
			}
			return true;
		};
		return runs
			.map((run) => ({
				traceId: run.traceId,
				events: [...run.events].sort((a, b) => a.offsetMs - b.offsetMs).filter(matches),
			}))
			.filter((run) => run.events.length > 0);
	}, [runs, focus, query]);

	const treeRuns = useMemo(
		() =>
			visibleRuns.map((run) => {
				const ids = new Set(run.events.map((event) => event.id));
				const build = (parentId: string | null): TreeEvent[] =>
					run.events
						.filter((event) =>
							parentId === null ? !event.parentId || !ids.has(event.parentId) : event.parentId === parentId
						)
						.map((event) => ({ ...event, __children: build(event.id) }));
				return { traceId: run.traceId, roots: build(null), events: run.events };
			}),
		[visibleRuns]
	);

	const parentIds = useMemo(() => {
		const set = new Set<string>();
		const walk = (nodes: TreeEvent[]) => {
			for (const node of nodes) {
				if (node.__children.length > 0) set.add(node.id);
				walk(node.__children);
			}
		};
		for (const run of treeRuns) {
			set.add(`run:${run.traceId ?? "direct"}`);
			walk(run.roots);
		}
		return set;
	}, [treeRuns]);

	const allCollapsed = parentIds.size > 0 && collapsed.size >= parentIds.size;

	const toggleNode = (id: string) => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(parentIds));

	const allVisible = visibleRuns.flatMap((run) => run.events);
	const minMs = allVisible.length ? Math.min(...allVisible.map((event) => event.offsetMs)) : 0;
	const maxMs = allVisible.length ? Math.max(...allVisible.map((event) => event.offsetMs + event.durationMs)) : 1;
	const total = Math.max(maxMs - minMs, 1);
	const pct = (ms: number) => `${Math.max(0, Math.min(100, ((ms - minMs) / total) * 100))}%`;

	const effectiveMode = toolbar ? mode : "tree";

	return (
		<div className="flex flex-col">
			{toolbar ? (
				<div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
					<SegmentedControl options={modeOptions} value={mode} onChange={setMode} />
					<SegmentedControl options={focusOptions} value={focus} onChange={setFocus} />
					<div className="ms-auto flex items-center gap-2">
						{mode === "tree" ? (
							<Button variant="ghost" size="sm" onClick={toggleAll} disabled={parentIds.size === 0}>
								{allCollapsed ? "Expand all" : "Collapse all"}
							</Button>
						) : null}
						<div className="relative">
							<SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder="Search steps…"
								className="h-8 w-44 pl-8"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
							/>
						</div>
					</div>
				</div>
			) : null}

			{visibleRuns.length === 0 ? (
				<p className="px-4 py-8 text-center text-[13px] text-muted-foreground">No steps match.</p>
			) : effectiveMode === "tree" ? (
				<div className="divide-y divide-border">
					{treeRuns.map((run, runIndex) => {
						const runKey = `run:${run.traceId ?? "direct"}`;
						const runCollapsed = collapsed.has(runKey);
						const root = run.roots[0];
						const runTitle = runs[runIndex]?.runTitle;
						const runStart = Math.min(...run.events.map((event) => event.offsetMs));
						const runEnd = Math.max(...run.events.map((event) => event.offsetMs + event.durationMs));
						return (
							<section className="py-1" key={runKey}>
								<button
									type="button"
									onClick={() => toggleNode(runKey)}
									className="flex w-full items-center gap-2.5 rounded-[3px] px-2 py-2 text-left transition-colors duration-150 ease-[var(--ease-out)] hover:bg-muted/40 active:bg-muted/70"
								>
									<span className="grid size-3.5 shrink-0 place-items-center text-muted-foreground">
										<ChevronRightIcon
											className={cn(
												"size-3.5 transition-transform duration-150 ease-[var(--ease-out)]",
												!runCollapsed && "rotate-90"
											)}
										/>
									</span>
									{runTitle ? (
										<span className="text-[13px] font-medium">{runTitle}</span>
									) : (
										<>
											<span className="text-[13px] font-medium">{root?.actor ?? "run"}</span>
											<span className="font-mono text-[12.5px] text-muted-foreground">{root?.action ?? "—"}</span>
										</>
									)}
									<span className="font-mono text-[11px] text-muted-foreground/70">{run.traceId ?? "direct"}</span>
									{root && root.onBehalfOf !== "—" ? (
										<span className="text-[11px] text-muted-foreground">· {root.onBehalfOf}</span>
									) : null}
									<span className="ms-1 font-mono text-[11px] text-muted-foreground tabular-nums">
										{formatDuration(runEnd - runStart)}
									</span>
									<span className="font-mono text-[11px] text-muted-foreground/70">{run.events.length} step{run.events.length === 1 ? "" : "s"}</span>
									<OutcomeMark outcome={worstOutcome(run.events)} />
								</button>
								{!runCollapsed ? (
									<ul className="relative ms-4 border-l border-border ps-3">
										{run.roots.map((node) => (
										<TreeNode
											event={node}
											key={node.id}
											parentActor={run.roots[0]?.actor ?? ""}
											collapsed={collapsed}
											onToggle={toggleNode}
											onSelect={onSelectEvent}
											showKinds={showKinds}
											onOpenRun={onOpenRun}
										/>
										))}
									</ul>
								) : null}
							</section>
						);
					})}
				</div>
			) : (
				<div>
					<div className="grid grid-cols-[minmax(0,360px)_minmax(0,1fr)] items-center gap-4 border-b border-border px-4 py-2">
						<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Step</span>
						<div className="relative h-4">
							{[0, 25, 50, 75, 100].map((tick) => (
								<span
									className="absolute top-0 -translate-x-1/2 font-mono text-[10px] text-muted-foreground/60"
									key={tick}
									style={{ left: `${tick}%` }}
								>
									{formatDuration(minMs + (tick / 100) * total)}
								</span>
							))}
						</div>
					</div>
					{visibleRuns.map((run) => {
						const runStart = Math.min(...run.events.map((event) => event.offsetMs));
						const runEnd = Math.max(...run.events.map((event) => event.offsetMs + event.durationMs));
						return (
							<div key={run.traceId ?? "direct"}>
								<div className="grid grid-cols-[minmax(0,360px)_minmax(0,1fr)] items-center gap-4 border-y border-border bg-muted/20 px-4 py-2">
									<span className="flex items-center gap-2">
										<span className="font-mono text-[12px] font-medium">{run.traceId ?? "direct"}</span>
										<span className="font-mono text-[11px] text-muted-foreground/70">
											{run.events.length} step{run.events.length === 1 ? "" : "s"}
										</span>
									</span>
									<div className="relative h-2">
										<span
											className="absolute top-0 h-2 rounded-[2px] bg-muted-foreground/40"
											style={{ left: pct(runStart), width: `max(2px, ${pct(runEnd - runStart)})` }}
										/>
									</div>
								</div>
								{run.events.map((event) => (
									<button
										type="button"
										onClick={onSelectEvent ? () => onSelectEvent(event) : undefined}
										className="grid w-full grid-cols-[minmax(0,360px)_minmax(0,1fr)] items-center gap-4 border-b border-border/60 px-4 py-2 text-left transition-colors duration-150 ease-[var(--ease-out)] hover:bg-muted/30 active:bg-muted/60"
										key={event.id}
									>
										<span className="flex min-w-0 items-center gap-2.5">
											<TypeMark type={event.type} />
											<span className="truncate font-mono text-[12.5px]">{event.action}</span>
											{showKinds && event.kindLabel ? (
												<span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/70">{event.kindLabel}</span>
											) : null}
											<span className="shrink-0 text-[12px] text-muted-foreground">{event.actor}</span>
											<span className="ms-1 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
												{formatDuration(event.durationMs)}
											</span>
											<OutcomeMark outcome={event.outcome} />
										</span>
										<span className="relative h-4">
											<span
												className={cn("absolute top-1 h-2 rounded-[2px]", barBg[event.outcome])}
												style={{ left: pct(event.offsetMs), width: `max(2px, ${pct(event.durationMs)})` }}
												title={formatDuration(event.durationMs)}
											/>
										</span>
									</button>
								))}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
