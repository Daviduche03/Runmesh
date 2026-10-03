"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/stores/agents-store";

const statusDot: Record<Agent["status"], string> = {
	running: "bg-emerald-400",
	idle: "bg-muted-foreground/60",
	blocked: "bg-amber-400",
	suspended: "bg-red-400",
};

// Playful squircle faces — deterministic per agent id. Squircles is v10-only,
// so the URL pins the 10.x API (verified live).
const DICE_VERSION = "10.x";
const DICE_STYLE = "squircles";

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
				src={`https://api.dicebear.com/${DICE_VERSION}/${DICE_STYLE}/svg?seed=${encodeURIComponent(agent.id)}`}
				alt={`${agent.name} avatar`}
				className={cn(agent.status === "suspended" && "opacity-60")}
			/>
			<AvatarFallback>{agent.name.slice(0, 1).toUpperCase()}</AvatarFallback>
			<span
				className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card", statusDot[agent.status])}
				aria-hidden
			/>
		</Avatar>
	);
}
