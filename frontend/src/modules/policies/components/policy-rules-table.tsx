"use client";

import { cn } from "@/lib/utils";
import {
	actionLabel,
	actionText,
	conditionSummary,
	oversightVerdict,
	toneDot,
	toneText,
	type PolicyRule,
} from "@/lib/policy";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export function PolicyRulesTable({
	rules,
	onSelect,
}: {
	rules: PolicyRule[];
	onSelect?: (rule: PolicyRule) => void;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="w-8 ps-4">#</TableHead>
					<TableHead>Rule</TableHead>
					<TableHead>Resolution</TableHead>
					<TableHead className="text-right tabular-nums">Escalated</TableHead>
					<TableHead className="pe-4 text-right">Oversight</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rules.map((rule) => {
					const verdict = oversightVerdict(rule);
					return (
						<TableRow
							key={rule.id}
							className={cn("h-12 cursor-pointer active:bg-muted/70", !rule.enabled && "opacity-55")}
							onClick={onSelect ? () => onSelect(rule) : undefined}
						>
							<TableCell className="ps-4 font-mono text-[12px] text-muted-foreground tabular-nums">
								{rule.priority}
							</TableCell>
							<TableCell className="max-w-[280px]">
								<span className="flex flex-wrap items-center gap-2">
									<span className="text-[13.5px] font-medium">{rule.name}</span>
									{rule.mode === "log-only" ? (
										<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
											log-only
										</span>
									) : null}
									{!rule.enabled ? (
										<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
											disabled
										</span>
									) : null}
								</span>
								<span className="block truncate font-mono text-[11.5px] text-muted-foreground">
									{conditionSummary(rule)}
								</span>
							</TableCell>
							<TableCell className={cn("text-[12.5px]", actionText[rule.action])}>
								{actionLabel[rule.action]}
							</TableCell>
							<TableCell className="text-right text-[13px] tabular-nums">
								{rule.escalated > 0 ? (
									<span className="text-amber-400">{rule.escalated}</span>
								) : (
									<span className="text-muted-foreground">—</span>
								)}
							</TableCell>
							<TableCell className="pe-4 text-right">
								<span className={cn("inline-flex items-center gap-1.5 text-[12.5px]", toneText[verdict.tone])}>
									<span className={cn("size-1.5 rounded-full", toneDot[verdict.tone])} aria-hidden />
									{verdict.label}
								</span>
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
