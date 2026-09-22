import type { AuditOutcome } from "@/modules/audit/components/audit-table";

export const outcomeText: Record<AuditOutcome, string> = {
	success: "text-emerald-400",
	denied: "text-red-400",
	failed: "text-red-400",
	escalated: "text-amber-400",
	timeout: "text-muted-foreground",
};

export function formatDuration(ms: number) {
	if (ms <= 0) return "—";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${Math.round(seconds % 60)}s`;
}
