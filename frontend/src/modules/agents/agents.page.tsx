"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/segmented-control";
import { FormSelect } from "@/components/form-select";
import { AgentCard } from "@/modules/agents/components/agent-card";
import EmptyState from "@/components/empty-state";
import type { AgentTone } from "@/modules/agents/components/agent-status";
import { BotIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { toUiAgent, useAgentsStore } from "@/lib/stores/agents-store";

const environmentOptions = [
	{ label: "No environment", value: "" },
	{ label: "Development", value: "dev" },
	{ label: "Staging", value: "staging" },
	{ label: "Production", value: "prod" },
] as const;

function AgentCardSkeleton() {
	return (
		<div className="min-h-[132px] rounded-[4px] border border-border bg-background p-5">
			<div className="flex items-center gap-2.5">
				<Skeleton className="size-8 rounded-full" />
				<div className="grid flex-1 gap-1.5">
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-3 w-16" />
				</div>
				<Skeleton className="h-4 w-14" />
			</div>
			<Skeleton className="mt-4 h-4 w-16" />
		</div>
	);
}

export function AgentsPage() {
	const agents = useAgentsStore((s) => s.agents);
	const loading = useAgentsStore((s) => s.loading);
	const creating = useAgentsStore((s) => s.creating);
	const fetchAgents = useAgentsStore((s) => s.fetch);
	const createAgent = useAgentsStore((s) => s.create);

	const [statusFilter, setStatusFilter] = useState<"all" | AgentTone>("all");
	const [modalOpen, setModalOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [environment, setEnvironment] = useState<string>("");
	const [parentId, setParentId] = useState<string>("");
	const [error, setError] = useState("");

	useEffect(() => {
		fetchAgents();
	}, [fetchAgents]);

	const uiAgents = agents.map(toUiAgent);
	const countBy = (status: AgentTone) => uiAgents.filter((agent) => agent.status === status).length;
	const filtered = statusFilter === "all" ? uiAgents : uiAgents.filter((agent) => agent.status === statusFilter);

	const openModal = () => {
		setName("");
		setDescription("");
		setEnvironment("");
		setParentId("");
		setError("");
		setModalOpen(true);
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim() || creating) return;
		setError("");
		const message = await createAgent({
			name: name.trim(),
			...(description.trim() && { description: description.trim() }),
			...(environment && { environment }),
			...(parentId && { parent_agent_id: parentId }),
		});
		if (message) {
			setError(message);
			return;
		}
		setModalOpen(false);
		toast.success(`Agent "${name.trim()}" registered`);
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
				<div>
					<h1 className="font-display text-[22px] font-medium tracking-[-0.02em]">Agents</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						The identities your agents act as, the access they hold, and what they are doing right now.
					</p>
				</div>
				<Button onClick={openModal}>
					<PlusIcon className="me-1.5 size-4" />
					Register agent
				</Button>
			</div>

			<div className="flex items-center justify-between gap-3">
				<span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
					{loading ? "…" : `${filtered.length} of ${uiAgents.length}`}
				</span>
				<SegmentedControl
					options={[
						{ label: `All (${uiAgents.length})`, value: "all" },
						{ label: `Running (${countBy("running")})`, value: "running" },
						{ label: `Idle (${countBy("idle")})`, value: "idle" },
						{ label: `Blocked (${countBy("blocked")})`, value: "blocked" },
						{ label: `Suspended (${countBy("suspended")})`, value: "suspended" },
					]}
					value={statusFilter}
					onChange={setStatusFilter}
				/>
			</div>
			{loading && uiAgents.length === 0 ? (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{[0, 1, 2, 3].map((i) => (
						<AgentCardSkeleton key={i} />
					))}
				</div>
			) : filtered.length > 0 ? (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{filtered.map((agent) => (
						<AgentCard key={agent.id} agent={agent} />
					))}
				</div>
			) : (
				<EmptyState
					title="No agents yet"
					description="Register your first agent to give it an identity."
					icon={<BotIcon className="size-6 text-muted-foreground" />}
				/>
			)}

			<Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Register agent">
				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<label className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
							Name
						</label>
						<Input
							placeholder="e.g. Atlas"
							value={name}
							onChange={(e) => setName(e.target.value)}
							autoFocus
						/>
					</div>
					<div className="grid gap-1.5">
						<label className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
							Description
						</label>
						<Input
							placeholder="What this agent is for"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
						/>
					</div>
					<div className="grid gap-1.5">
						<label className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
							Environment
						</label>
						<FormSelect
							options={environmentOptions}
							value={environment as (typeof environmentOptions)[number]["value"]}
							onChange={setEnvironment}
						/>
					</div>
					<div className="grid gap-1.5">
						<label className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
							Spawned by
						</label>
						<FormSelect
							options={[
								{ label: "No parent — top-level agent", value: "" },
								...agents.map((agent) => ({
									label: `${agent.name || "Untitled agent"} · ${agent.id}`,
									value: agent.id,
								})),
							]}
							value={parentId}
							onChange={setParentId}
						/>
					</div>
					{error ? <p className="text-sm text-red-400">{error}</p> : null}
					<div className="flex justify-end gap-2 border-t border-border pt-4">
						<Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={!name.trim() || creating}>
							{creating && <Loader2Icon className="me-1.5 size-4 animate-spin" />}
							Register agent
						</Button>
					</div>
				</form>
			</Modal>
		</div>
	);
}
