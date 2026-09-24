"use client";

import { CheckCheckIcon, GitCompareArrowsIcon } from "lucide-react";
import type { BackendRunEvent } from "@/lib/stores/agent-runs-store";

type Divergence = { index: number; original: unknown; replayed: unknown };
type ReplayDiffData = { identical: boolean; comparedSteps: number; divergences: Divergence[] };

/** The engine records its verdict as a `replay.diff` log event on the replay
 *  run, so the viewer needs no replay logic of its own. */
function parseDiff(events: BackendRunEvent[]): ReplayDiffData | null {
	const event = events.find((e) => e.kind === "log" && e.name === "replay.diff");
	if (!event) return null;
	const result = event.result as Partial<ReplayDiffData> | null;
	if (typeof result?.identical !== "boolean") return null;
	return {
		identical: result.identical,
		comparedSteps: Number(result.comparedSteps ?? 0),
		divergences: Array.isArray(result.divergences) ? (result.divergences as Divergence[]) : [],
	};
}

function Json({ value }: { value: unknown }) {
	return <code className="block truncate font-mono text-[11px] text-muted-foreground">{JSON.stringify(value)}</code>;
}

export function ReplayDiff({
	events,
	originRunId,
	onOpenRun,
}: {
	events: BackendRunEvent[];
	originRunId?: string | null;
	onOpenRun?: (runId: string) => void;
}) {
	const diff = parseDiff(events);
	if (!diff) {
		return (
			<p className="border-b border-border px-4 py-3 text-[12.5px] text-muted-foreground">
				Replay recorded, no diff yet.
			</p>
		);
	}
	return (
		<div className="border-b border-border px-4 py-3">
			<div className="flex flex-wrap items-center gap-2">
				{diff.identical ? (
					<span className="flex items-center gap-1.5 font-mono text-[12px] text-emerald-400">
						<CheckCheckIcon className="size-3.5" /> identical
					</span>
				) : (
					<span className="flex items-center gap-1.5 font-mono text-[12px] text-amber-400">
						<GitCompareArrowsIcon className="size-3.5" /> diverged
					</span>
				)}
				<span className="font-mono text-[11px] text-muted-foreground">
					{diff.comparedSteps} step{diff.comparedSteps === 1 ? "" : "s"} compared
				</span>
				{originRunId ? (
					<button
						type="button"
						onClick={() => onOpenRun?.(originRunId)}
						className="ms-auto font-mono text-[11px] text-sky-400 transition-colors duration-150 ease-[var(--ease-out)] hover:text-sky-300"
					>
						↻ replay of {originRunId}
					</button>
				) : null}
			</div>
			{diff.divergences.length > 0 ? (
				<ul className="mt-2 space-y-1.5">
					{diff.divergences.map((d) => (
						<li key={d.index} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-[11.5px]">
							<span className="font-mono text-muted-foreground tabular-nums">#{d.index}</span>
							<span className="min-w-0">
								<span className="text-muted-foreground/70">original </span>
								<Json value={d.original} />
								<span className="text-muted-foreground/70">replayed </span>
								<Json value={d.replayed} />
							</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
