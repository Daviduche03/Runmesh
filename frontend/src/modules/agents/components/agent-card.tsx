"use client";

import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { AgentStatus } from "@/modules/agents/components/agent-status";
import { AgentAvatar } from "@/modules/agents/components/agent-avatar";
import type { Agent } from "@/modules/agents/components/agents-table";

// Same footprint as StatCard: identical grid, the same footer band,
// min-h matched to the KPI row height.
export function AgentCard({ agent }: { agent: Agent }) {
	const navigate = useNavigate();
	const activity = agent.current !== "—" ? `${agent.current} · ${agent.seen}` : agent.seen;

	return (
		<Card
			className="min-h-[132px] cursor-pointer transition-[border-color,background-color] duration-150 ease-[var(--ease-out)] hover:bg-muted/40 active:bg-muted/70"
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
			<CardContent>
				<p className="text-[13px] tabular-nums">
					{agent.grants} <span className="text-muted-foreground">{agent.grants === 1 ? "grant" : "grants"}</span>
				</p>
				{agent.framework || agent.model ? (
					<p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
						{[agent.framework, agent.model].filter(Boolean).join(" · ")}
						{agent.version != null && agent.version > 1 ? ` · v${agent.version}` : ""}
					</p>
				) : null}
			</CardContent>
			<CardFooter>
				<span className="truncate font-mono text-[11px] text-muted-foreground">{activity}</span>
			</CardFooter>
		</Card>
	);
}
