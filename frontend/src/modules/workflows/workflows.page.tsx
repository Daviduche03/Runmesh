"use client";

import { useEffect, useState } from "react";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedControl } from "@/components/segmented-control";
import { FormSelect } from "@/components/form-select";
import { SearchIcon, PlayIcon, ClockIcon, GitBranchIcon, Loader2Icon, MoreVerticalIcon, CopyIcon, CheckIcon, Trash2Icon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useWorkflowsStore, type Workflow } from "@/lib/stores/workflows-store";
import EmptyState from "@/components/empty-state";
import { Modal } from "@/components/ui/modal";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";

const statusColor = (status: string) => {
	switch (status) {
		case "Active": return "text-emerald-400";
		case "Paused": return "text-amber-400";
		case "Running": return "text-sky-400";
		case "Completed": return "text-emerald-400";
		case "Failed": return "text-red-400";
		default: return "text-muted-foreground";
	}
};

const triggerIcon = (trigger: string) => {
	switch (trigger) {
		case "Webhook": return <PlayIcon className="size-3.5 text-muted-foreground" />;
		case "Schedule": return <ClockIcon className="size-3.5 text-muted-foreground" />;
		default: return null;
	}
};

const triggerTypeOptions = [
	{ label: "Manual", value: "manual" },
	{ label: "Queue", value: "queue" },
	{ label: "Schedule", value: "schedule" },
] as const;

function formatLastRun(value: string) {
	if (!value) return "—";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function WorkflowSkeletonRow() {
	return (
		<TableRow className="h-12">
			<TableCell className="ps-4"><Skeleton className="h-4 w-32" /></TableCell>
			<TableCell><Skeleton className="h-4 w-20" /></TableCell>
			<TableCell><Skeleton className="h-4 w-40" /></TableCell>
			<TableCell><Skeleton className="h-4 w-14" /></TableCell>
			<TableCell><Skeleton className="h-4 w-24" /></TableCell>
			<TableCell><Skeleton className="h-4 w-12" /></TableCell>
			<TableCell className="pe-4"><Skeleton className="ms-auto h-4 w-8" /></TableCell>
		</TableRow>
	);
}

export function WorkflowsPage() {
	const workflows = useWorkflowsStore((s) => s.workflows);
	const loading = useWorkflowsStore((s) => s.loading);
	const fetch = useWorkflowsStore((s) => s.fetch);
	const createWorkflow = useWorkflowsStore((s) => s.createWorkflow);
	const creating = useWorkflowsStore((s) => s.creating);
	const removeWorkflow = useWorkflowsStore((s) => s.remove);
	const deleting = useWorkflowsStore((s) => s.deleting);

	const [statusFilter, setStatusFilter] = useState("all");
	const [triggerFilter, setTriggerFilter] = useState("all");
	const [searchQuery, setSearchQuery] = useState("");
	const navigate = useNavigate();

	const [modalOpen, setModalOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [triggerType, setTriggerType] = useState("manual");
	const [triggerConfig, setTriggerConfig] = useState("{}");
	const [error, setError] = useState("");
	const [copied, setCopied] = useState<string | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

	const copyValue = (key: string, value: string) => {
		navigator.clipboard.writeText(value);
		setCopied(key);
		setTimeout(() => setCopied(null), 2000);
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		if (!name.trim()) {
			setError("Name is required");
			return;
		}
		if (!description.trim() || description.trim().length < 8) {
			setError("Description is required (at least 8 characters)");
			return;
		}
		if (description.trim().toLowerCase() === name.trim().toLowerCase()) {
			setError("Description must be different from the workflow name");
			return;
		}
		let parsedConfig: Record<string, unknown> = {};
		try {
			parsedConfig = JSON.parse(triggerConfig);
		} catch {
			setError("Trigger config must be valid JSON");
			return;
		}
		try {
			await createWorkflow({
				name: name.trim(),
				description: description.trim(),
				trigger_type: triggerType,
				trigger_config: JSON.stringify(parsedConfig),
			});
			setModalOpen(false);
			toast.success(`Workflow "${name.trim()}" created`);
			setName("");
			setDescription("");
			setTriggerType("manual");
			setTriggerConfig("{}");
		} catch (err) {
			console.error(err);
			setError("Failed to create workflow");
		}
	};

	const filtered = workflows.filter((w) => {
		if (statusFilter !== "all" && w.status !== statusFilter) return false;
		if (triggerFilter !== "all" && w.trigger !== triggerFilter) return false;
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			if (!w.name.toLowerCase().includes(q) && !w.endpoint.toLowerCase().includes(q)) return false;
		}
		return true;
	});

	useEffect(() => {
		fetch();
	}, [fetch]);

	const statusFilterOptions = [
		{ label: `All (${workflows.length})`, value: "all" },
		{ label: `Active (${workflows.filter((w) => w.status === "Active").length})`, value: "Active" },
		{ label: `Paused (${workflows.filter((w) => w.status === "Paused").length})`, value: "Paused" },
		{ label: `Draft (${workflows.filter((w) => w.status === "Draft").length})`, value: "Draft" },
	];
	const triggerFilterOptions = [
		{ label: `All triggers (${workflows.length})`, value: "all" },
		{ label: `Webhook (${workflows.filter((w) => w.trigger === "Webhook").length})`, value: "Webhook" },
		{ label: `Schedule (${workflows.filter((w) => w.trigger === "Schedule").length})`, value: "Schedule" },
		{ label: `Manual (${workflows.filter((w) => w.trigger === "Manual").length})`, value: "Manual" },
	];

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
				<div>
					<h1 className="font-display text-[22px] font-medium tracking-[-0.02em]">Workflows</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Orchestrate durable agent runs with manual, webhook, and scheduled triggers.
					</p>
				</div>
				<Button onClick={() => setModalOpen(true)}>
					<GitBranchIcon className="me-1.5 size-4" />
					New workflow
				</Button>
			</div>

			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="space-y-1.5">
							<CardTitle>All workflows</CardTitle>
							<CardDescription>Manual, webhook, and scheduled triggers.</CardDescription>
						</div>
						<div className="relative w-full max-w-xs">
							<SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder="Search workflows…"
								className="h-8 pl-8"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
							/>
						</div>
					</div>
				</CardHeader>
				<CardContent className="px-0">
					<div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
						<SegmentedControl
							options={statusFilterOptions}
							value={statusFilter}
							onChange={setStatusFilter}
						/>
						<SegmentedControl
							options={triggerFilterOptions}
							value={triggerFilter}
							onChange={setTriggerFilter}
						/>
					</div>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="ps-4">Name</TableHead>
								<TableHead>Trigger</TableHead>
								<TableHead>Endpoint</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Last run</TableHead>
								<TableHead className="text-right tabular-nums">Runs</TableHead>
								<TableHead className="pe-4 text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{loading && filtered.length === 0 ? (
								Array.from({ length: 5 }).map((_, index) => <WorkflowSkeletonRow key={index} />)
							) : filtered.length === 0 ? (
								<TableRow>
									<TableCell colSpan={7} className="py-8">
										<EmptyState
											title="No workflows yet"
											description="Create a workflow to chain runs, retries, and agent handoffs."
											icon={<GitBranchIcon className="size-6 text-muted-foreground" />}
										/>
									</TableCell>
								</TableRow>
							) : (
								filtered.map((w: Workflow) => (
									<TableRow
										className="h-12 cursor-pointer active:bg-muted/70"
										key={w.id}
										onClick={() => navigate(`/workflows/${w.id}`)}
									>
										<TableCell className="ps-4 font-medium">{w.name}</TableCell>
										<TableCell>
											<div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
												{triggerIcon(w.trigger)}
												{w.trigger}
											</div>
										</TableCell>
										<TableCell className="max-w-48 truncate font-mono text-[12.5px] text-muted-foreground">
											{w.endpoint || "—"}
										</TableCell>
										<TableCell className={`text-[12.5px] font-medium ${statusColor(w.status)}`}>
											{w.status}
										</TableCell>
										<TableCell className="text-[13px] text-muted-foreground">{formatLastRun(w.lastRun)}</TableCell>
										<TableCell className="text-right text-[13px] text-muted-foreground tabular-nums">
											{w.runs.toLocaleString()}
										</TableCell>
										<TableCell className="pe-4 text-right" onClick={(e) => e.stopPropagation()}>
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button variant="ghost" size="icon-sm">
														<MoreVerticalIcon className="size-4 text-muted-foreground" />
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end" className="min-w-40">
													<DropdownMenuItem onClick={() => copyValue(`id-${w.id}`, w.id)}>
														{copied === `id-${w.id}` ? (
															<CheckIcon className="size-4 text-emerald-400" />
														) : (
															<CopyIcon className="size-4" />
														)}
														Copy workflow ID
													</DropdownMenuItem>
													{w.endpoint ? (
														<DropdownMenuItem onClick={() => copyValue(`endpoint-${w.id}`, w.endpoint)}>
															{copied === `endpoint-${w.id}` ? (
																<CheckIcon className="size-4 text-emerald-400" />
															) : (
																<CopyIcon className="size-4" />
															)}
															Copy endpoint
														</DropdownMenuItem>
													) : null}
													<DropdownMenuItem
														variant="destructive"
														onClick={() => setDeleteTarget({ id: w.id, name: w.name })}
													>
														<Trash2Icon className="size-4" />
														Delete workflow
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			{filtered.length > 0 ? (
				<p className="text-[13px] text-muted-foreground">
					Showing {filtered.length} workflow{filtered.length !== 1 ? "s" : ""}
				</p>
			) : null}

			<Modal open={modalOpen} onClose={() => { setModalOpen(false); setError(""); }} title="New workflow">
				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<label className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Name</label>
						<Input placeholder="Webhook sync" value={name} onChange={(e) => setName(e.target.value)} required />
					</div>
					<div className="grid gap-1.5">
						<label className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Description</label>
						<textarea
							className="flex min-h-20 w-full rounded-[4px] border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							placeholder="What this agent workflow does and when it runs"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							required
						/>
					</div>
					<div className="grid gap-1.5">
						<label className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Trigger type</label>
						<FormSelect
							value={triggerType as (typeof triggerTypeOptions)[number]["value"]}
							onChange={setTriggerType}
							options={triggerTypeOptions}
						/>
					</div>
					<div className="grid gap-1.5">
						<label className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Trigger config (JSON)</label>
						<textarea
							className="flex min-h-24 w-full rounded-[4px] border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							value={triggerConfig}
							onChange={(e) => setTriggerConfig(e.target.value)}
						/>
					</div>
					{error && <p className="text-sm text-red-400">{error}</p>}
					<div className="flex justify-end gap-2 border-t border-border pt-4">
						<Button type="button" variant="outline" onClick={() => { setModalOpen(false); setError(""); }}>
							Cancel
						</Button>
						<Button type="submit" disabled={creating}>
							{creating && <Loader2Icon className="me-1.5 size-4 animate-spin" />}
							Create workflow
						</Button>
					</div>
				</form>
			</Modal>

			<DeleteConfirmModal
				open={!!deleteTarget}
				onClose={() => setDeleteTarget(null)}
				title="Delete workflow"
				itemName={deleteTarget?.name ?? ""}
				description="All runs and steps for this workflow will be permanently removed."
				onConfirm={async () => {
					if (!deleteTarget) return;
					const ok = await removeWorkflow(deleteTarget.id);
					if (ok) {
						setDeleteTarget(null);
						toast.success(`Workflow "${deleteTarget.name}" deleted`);
					}
				}}
				confirming={deleting}
			/>
		</div>
	);
}
