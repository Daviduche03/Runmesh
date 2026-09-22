import { cn } from "@/lib/utils";

export type AgentTone = "running" | "idle" | "blocked" | "suspended";

const toneDot: Record<AgentTone, string> = {
	running: "bg-emerald-400",
	idle: "bg-muted-foreground/60",
	blocked: "bg-amber-400",
	suspended: "bg-red-400",
};

const toneText: Record<AgentTone, string> = {
	running: "text-emerald-400",
	idle: "text-muted-foreground",
	blocked: "text-amber-400",
	suspended: "text-red-400",
};

export function AgentStatus({ status, className }: { status: AgentTone; className?: string }) {
	return (
		<span className={cn("inline-flex items-center gap-1.5 text-[12px] capitalize", toneText[status], className)}>
			<span className={cn("size-1.5 shrink-0 rounded-full", toneDot[status])} aria-hidden />
			{status}
		</span>
	);
}
