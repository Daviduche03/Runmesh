"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { Agent } from "@/modules/agents/components/agents-table";

const statusDot: Record<Agent["status"], string> = {
	running: "bg-emerald-400",
	idle: "bg-muted-foreground/60",
	blocked: "bg-amber-400",
	suspended: "bg-red-400",
};

// Abstract geometric identity — deterministic per agent, serious enough for
// a control plane, no faces or robots. Verified against the 9.x API.
const DICE_STYLE = "shapes";

export function AgentAvatar({
	agent,
	size = "lg",
	className,
}: {
	agent: Agent;
	size?: "default" | "sm" | "lg";
	className?: string;
}) {
	return (
		<Avatar size={size} className={cn("relative", className)}>
			<AvatarImage
				src={`https://api.dicebear.com/9.x/${DICE_STYLE}/svg?seed=${encodeURIComponent(agent.id)}&backgroundColor=transparent`}
				alt={`${agent.name} avatar`}
				className={cn("grayscale", agent.status === "suspended" && "opacity-60")}
			/>
			<AvatarFallback>{agent.name.slice(0, 1).toUpperCase()}</AvatarFallback>
			<span
				className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card", statusDot[agent.status])}
				aria-hidden
			/>
		</Avatar>
	);
}
