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
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchIcon, PlayIcon, PauseIcon, GitBranchIcon, FilterIcon, Loader2Icon, MoreVerticalIcon, CopyIcon, CheckIcon, Trash2Icon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useWorkflowsStore, type Workflow } from "@/stores/workflows-store";
import EmptyState from "@/components/empty-state";
import { Modal } from "../ui/modal";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";

const statusBadge = (status: string) => {
	switch (status) {
		case "Completed": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
		case "Running": return "bg-sky-500/10 text-sky-400 border-sky-500/20";
		case "Failed": return "bg-red-500/10 text-red-400 border-red-500/20";
		case "Active": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
		case "Paused": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
		case "Draft": return "bg-muted text-muted-foreground border-border";
		default: return "bg-muted text-muted-foreground border-border";
	}
};

const triggerIcon = (trigger: string) => {
	switch (trigger) {
		case "Webhook": return <PlayIcon className="size-3.5 text-sky-400" />;
		case "Schedule": return <PauseIcon className="size-3.5 text-purple-400" />;
		default: return null;
	}
};

function formatLastRun(value: string) {
	if (!value) return "—";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function WorkflowSkeletonRow() {
	return (
		<TableRow className="h-12">
			<TableCell className="ps-6"><Skeleton className="h-4 w-32" /></TableCell>
			<TableCell><Skeleton className="h-4 w-16" /></TableCell>
			<TableCell><Skeleton className="h-4 w-40" /></TableCell>
			<TableCell><Skeleton className="h-4 w-14" /></TableCell>
			<TableCell><Skeleton className="h-4 w-24" /></TableCell>
			<TableCell className="pe-6"><Skeleton className="h-4 w-12 ms-auto" /></TableCell>
			<TableCell className="pe-6"><Skeleton className="h-4 w-8 ms-auto" /></TableCell>
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

	const [statusFilter, setStatusFilter] = useState("");
	const [triggerFilter, setTriggerFilter] = useState("");
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
		if (statusFilter && w.status !== statusFilter) return false;
		if (triggerFilter && w.trigger !== triggerFilter) return false;
		return true;
	});

	useEffect(() => {
		fetch();
	}, [fetch]);

	return (
		<div className="grid gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Workflows</h1>
					<p className="text-sm text-muted-foreground mt-1">
						Automate tasks with webhook-triggered and scheduled workflows.
					</p>
				</div>
				<Button onClick={() => setModalOpen(true)}>
					<GitBranchIcon className="size-4 me-1.5" />
					New workflow
				</Button>
			</div>

			<div className="flex items-center gap-3">
				<div className="relative w-full max-w-sm">
					<SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input placeholder="Search workflows..." className="h-9 pl-9" />
				</div>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm" className="gap-2">
							<FilterIcon className="size-3.5" />
							{statusFilter || "Status"}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start">
						<DropdownMenuRadioGroup value={statusFilter} onValueChange={setStatusFilter}>
							<DropdownMenuRadioItem value="">All</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="Active">Active</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="Paused">Paused</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="Draft">Draft</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm" className="gap-2">
							<FilterIcon className="size-3.5" />
							{triggerFilter || "Trigger"}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start">
						<DropdownMenuRadioGroup value={triggerFilter} onValueChange={setTriggerFilter}>
							<DropdownMenuRadioItem value="">All</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="Webhook">Webhook</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="Schedule">Schedule</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="Manual">Manual</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<div className="rounded-none border border-border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="ps-6">Name</TableHead>
							<TableHead>Trigger</TableHead>
							<TableHead>Endpoint</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Last run</TableHead>
							<TableHead className="text-right tabular-nums">Total runs</TableHead>
							<TableHead className="pe-6 text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{loading && filtered.length === 0 ? (
							<>
								<WorkflowSkeletonRow />
								<WorkflowSkeletonRow />
								<WorkflowSkeletonRow />
								<WorkflowSkeletonRow />
								<WorkflowSkeletonRow />
							</>
						) : filtered.length === 0 ? (
							<TableRow>
								<TableCell colSpan={7} className="text-center py-8">
									<EmptyState
										title="No workflows yet"
										description="Create a workflow to group and automate tasks."
										icon={<GitBranchIcon className="size-6 text-muted-foreground" />}
									/>
								</TableCell>
							</TableRow>
						) : (
							filtered.map((w: Workflow) => (
								<TableRow
									className="h-12 cursor-pointer"
									key={w.id}
									onClick={() => navigate(`/workflows/${w.id}`)}
								>
									<TableCell className="ps-6 font-medium">{w.name}</TableCell>
									<TableCell>
										<div className="flex items-center gap-1.5 text-sm text-muted-foreground">
											{triggerIcon(w.trigger)}
											{w.trigger}
										</div>
									</TableCell>
									<TableCell className="max-w-48 truncate text-muted-foreground font-mono text-sm">
										{w.endpoint || "—"}
									</TableCell>
									<TableCell>
										<span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium ${statusBadge(w.status)}`}>
											{w.status}
										</span>
									</TableCell>
									<TableCell className="text-muted-foreground text-sm">
										{formatLastRun(w.lastRun)}
									</TableCell>
									<TableCell className="text-right tabular-nums text-muted-foreground text-sm">
										{w.runs.toLocaleString()}
									</TableCell>
									<TableCell className="pe-6 text-right" onClick={(e) => e.stopPropagation()}>
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
			</div>

			{filtered.length > 0 && (
				<div className="flex items-center justify-between text-sm text-muted-foreground">
					<span>Showing {filtered.length} workflow{filtered.length !== 1 ? "s" : ""}</span>
				</div>
			)}

			<Modal open={modalOpen} onClose={() => { setModalOpen(false); setError(""); }} title="New workflow">
				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Name</label>
						<Input
							placeholder="Webhook sync"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
						/>
					</div>

					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Description</label>
						<textarea
							className="flex min-h-20 w-full rounded-none border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							placeholder="What this workflow does and when it runs"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							required
						/>
					</div>

					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Trigger type</label>
						<select
							className="flex h-9 w-full rounded-none border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							value={triggerType}
							onChange={(e) => setTriggerType(e.target.value)}
						>
							<option value="manual">Manual</option>
							<option value="queue">Queue</option>
							<option value="schedule">Schedule</option>
						</select>
					</div>

					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Trigger config (JSON)</label>
						<textarea
							className="flex min-h-24 w-full rounded-none border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							value={triggerConfig}
							onChange={(e) => setTriggerConfig(e.target.value)}
						/>
					</div>

					{error && (
						<p className="text-sm text-red-400">{error}</p>
					)}

					<div className="flex justify-end gap-2 pt-2">
						<Button type="button" variant="outline" onClick={() => { setModalOpen(false); setError(""); }}>
							Cancel
						</Button>
						<Button type="submit" disabled={creating}>
							{creating && <Loader2Icon className="size-4 animate-spin me-1.5" />}
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
					if (ok) setDeleteTarget(null);
				}}
				confirming={deleting}
			/>
		</div>
	);
}
