"use client";

import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AgentStatus } from "@/modules/agents/components/agent-status";
import { AgentAvatar } from "@/modules/agents/components/agent-avatar";
import type { Agent } from "@/lib/stores/agents-store";

export function AgentCard({ agent }: { agent: Agent }) {
	const navigate = useNavigate();
	const activity = agent.current !== "—" ? `${agent.current} · ${agent.seen}` : agent.seen;

	return (
		<Card
			className="cursor-pointer gap-4 py-4 transition-[background-color] duration-150 ease-[var(--ease-out)] hover:bg-muted/30 active:bg-muted/50"
			onClick={() => navigate(`/agents/${agent.id}`)}
		>
			<CardHeader>
				<div className="flex items-center gap-2.5">
					<AgentAvatar agent={agent} size="default" />
					<div className="min-w-0">
						<div className="truncate text-[13px] font-medium">{agent.name}</div>
						<div className="truncate font-mono text-[10px] text-muted-foreground">{agent.id}</div>
					</div>
					<span className="ms-auto shrink-0">
						<AgentStatus status={agent.status} />
					</span>
				</div>
			</CardHeader>
			<CardContent className="flex items-center justify-between gap-2">
				<span className="truncate font-mono text-[11px] text-muted-foreground">{activity}</span>
				<span className="shrink-0 text-[13px] tabular-nums">
					{agent.grants} <span className="text-muted-foreground">{agent.grants === 1 ? "grant" : "grants"}</span>
				</span>
			</CardContent>
		</Card>
	);
}
