"use client";

import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { AgentStatus, type AgentTone } from "@/modules/agents/components/agent-status";
import { copyText } from "@/lib/clipboard";
import { CopyIcon, MoreVerticalIcon, ShieldOffIcon, PauseIcon } from "lucide-react";

export type Agent = {
	id: string;
	name: string;
	status: AgentTone;
	grants: number;
	current: string;
	seen: string;
	framework?: string | null;
	model?: string | null;
	version?: number | null;
};

function AgentSkeletonRow() {
	return (
		<TableRow className="h-12">
			<TableCell className="ps-4"><Skeleton className="h-4 w-24" /></TableCell>
			<TableCell><Skeleton className="h-4 w-20" /></TableCell>
			<TableCell><Skeleton className="h-4 w-16" /></TableCell>
			<TableCell><Skeleton className="h-4 w-32" /></TableCell>
			<TableCell><Skeleton className="h-4 w-16" /></TableCell>
			<TableCell className="pe-4"><Skeleton className="ms-auto h-4 w-8" /></TableCell>
		</TableRow>
	);
}

export function AgentsTable({
	agents,
	loading,
	onSuspend,
}: {
	agents: Agent[];
	loading?: boolean;
	onSuspend?: (agent: Agent) => void;
}) {
	const navigate = useNavigate();

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="ps-4">Agent</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Access</TableHead>
					<TableHead>Current</TableHead>
					<TableHead>Last seen</TableHead>
					<TableHead className="pe-4 text-right">Actions</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{loading ? (
					Array.from({ length: 3 }).map((_, index) => <AgentSkeletonRow key={index} />)
				) : (
					agents.map((agent) => (
						<TableRow
							className="h-12 cursor-pointer active:bg-muted/70"
							key={agent.id}
							onClick={() => navigate(`/agents/${agent.id}`)}
						>
							<TableCell className="ps-4">
								<span className="flex items-baseline gap-2">
									<span className="font-medium">{agent.name}</span>
									<span className="font-mono text-[11px] text-muted-foreground">{agent.id}</span>
								</span>
							</TableCell>
							<TableCell><AgentStatus status={agent.status} /></TableCell>
							<TableCell className="text-[13px] text-muted-foreground">
								{agent.grants} {agent.grants === 1 ? "grant" : "grants"}
							</TableCell>
							<TableCell className="font-mono text-[12.5px] text-muted-foreground">{agent.current}</TableCell>
							<TableCell className="text-[13px] text-muted-foreground">{agent.seen}</TableCell>
							<TableCell className="pe-4 text-right" onClick={(e) => e.stopPropagation()}>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="icon-sm">
											<MoreVerticalIcon className="size-4" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onClick={() => copyText(agent.id, "Agent ID copied")}>
											<CopyIcon className="me-2 size-3.5" />
											Copy ID
										</DropdownMenuItem>
										<DropdownMenuItem
											className="text-destructive focus:text-destructive"
											onClick={onSuspend ? () => onSuspend(agent) : undefined}
										>
											<PauseIcon className="me-2 size-3.5" />
											Suspend agent
										</DropdownMenuItem>
										<DropdownMenuItem
											className="text-destructive focus:text-destructive"
											onClick={() => navigate(`/agents/${agent.id}`)}
										>
											<ShieldOffIcon className="me-2 size-3.5" />
											Manage access
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</TableCell>
						</TableRow>
					))
				)}
			</TableBody>
		</Table>
	);
}
