"use client";

import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
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
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
	ActivityIcon,
	ArrowLeftIcon,
	FilterIcon,
	GitBranchIcon,
	Loader2Icon,
	PlusIcon,
} from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import type { Workflow } from "@/stores/workflows-store";
import type { Task } from "@/stores/runs-store";
import EmptyState from "@/components/empty-state";

const statuses = [
	{ label: "All", value: null },
	{ label: "Running", value: "running" },
	{ label: "Completed", value: "completed" },
	{ label: "Failed", value: "failed" },
	{ label: "Queued", value: "queued" },
] as const;

const statusColor = (status: string) => {
	switch (status) {
		case "Completed": return "text-emerald-400";
		case "Running": return "text-sky-400";
		case "Failed": return "text-red-400";
		case "Queued": return "text-amber-400";
		default: return "text-muted-foreground";
	}
};

const workflowStatusBadge = (status: string) => {
	switch (status) {
		case "Active": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
		case "Paused": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
		case "Draft": return "bg-muted text-muted-foreground border-border";
		default: return "bg-muted text-muted-foreground border-border";
	}
};

function RunSkeletonRow() {
	return (
		<TableRow className="h-12">
			<TableCell className="ps-6"><Skeleton className="h-4 w-20" /></TableCell>
			<TableCell><Skeleton className="h-4 w-40" /></TableCell>
			<TableCell><Skeleton className="h-4 w-16" /></TableCell>
			<TableCell><Skeleton className="h-4 w-24" /></TableCell>
			<TableCell><Skeleton className="h-4 w-12" /></TableCell>
			<TableCell className="pe-6"><Skeleton className="h-4 w-8 ms-auto" /></TableCell>
		</TableRow>
	);
}

export function WorkflowDetailPage() {
	const { workflowId = "" } = useParams();
	const [workflow, setWorkflow] = useState<Workflow | null>(null);
	const [tasks, setTasks] = useState<Task[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [statusFilter, setStatusFilter] = useState<string | null>(null);
	const [loadingWorkflow, setLoadingWorkflow] = useState(true);
	const [loadingRuns, setLoadingRuns] = useState(true);
	const [error, setError] = useState("");
	const [modalOpen, setModalOpen] = useState(false);
	const [creating, setCreating] = useState(false);
	const [url, setUrl] = useState("");
	const [payload, setPayload] = useState("{}");
	const [trigger, setTrigger] = useState("queue");
	const [createError, setCreateError] = useState("");

	const fetchWorkflow = useCallback(async () => {
		if (!workflowId) return;
		setLoadingWorkflow(true);
		setError("");
		try {
			const { data: workflow } = await apiGet<Workflow>(`/api/v1/workflows/${workflowId}`);
			setWorkflow(workflow);
		} catch {
			setError("Workflow not found");
			setWorkflow(null);
		} finally {
			setLoadingWorkflow(false);
		}
	}, [workflowId]);

	const fetchRuns = useCallback(async () => {
		if (!workflowId) return;
		setLoadingRuns(true);
		const params = new URLSearchParams({
			page: String(page),
			limit: "50",
			workflow_id: workflowId,
		});
		if (statusFilter) params.set("status", statusFilter);

		try {
			const { data: runs, meta } = await apiGet<Task[]>(`/api/v1/tasks?${params}`);
			setTasks(runs);
			setTotal(meta?.total ?? 0);
		} catch {
			setTasks([]);
			setTotal(0);
		} finally {
			setLoadingRuns(false);
		}
	}, [workflowId, page, statusFilter]);

	useEffect(() => {
		fetchWorkflow();
	}, [fetchWorkflow]);

	useEffect(() => {
		fetchRuns();
	}, [fetchRuns]);

	const handleCreateTask = async (e: React.FormEvent) => {
		e.preventDefault();
		setCreateError("");
		if (!url.trim()) {
			setCreateError("URL is required");
			return;
		}
		let parsedPayload: Record<string, unknown> = {};
		try {
			parsedPayload = JSON.parse(payload);
		} catch {
			setCreateError("Payload must be valid JSON");
			return;
		}
		setCreating(true);
		try {
			await apiPost("/api/v1/tasks", {
				url: url.trim(),
				payload: parsedPayload,
				execution_type: trigger,
				workflow_id: workflowId,
			});
			setModalOpen(false);
			setUrl("");
			setPayload("{}");
			setTrigger("queue");
			await Promise.all([fetchWorkflow(), fetchRuns()]);
		} catch {
			setCreateError("Failed to create task");
		} finally {
			setCreating(false);
		}
	};

	const totalPages = Math.ceil(total / 50);

	if (loadingWorkflow) {
		return (
			<div className="grid gap-4">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-28 w-full" />
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}

	if (error || !workflow) {
		return (
			<div className="grid gap-4">
				<Button asChild variant="outline" className="w-fit">
					<Link to="/workflows">
						<ArrowLeftIcon className="size-4 me-1.5" />
						Back to workflows
					</Link>
				</Button>
				<EmptyState
					title="Workflow not found"
					description="This workflow may have been deleted or you do not have access."
					icon={<GitBranchIcon className="size-6 text-muted-foreground" />}
				/>
			</div>
		);
	}

	return (
		<div className="grid gap-4">
			<div className="flex items-start justify-between gap-4">
				<div className="grid gap-3">
					<Button asChild variant="ghost" className="h-8 w-fit px-2 -ms-2 text-muted-foreground">
						<Link to="/workflows">
							<ArrowLeftIcon className="size-4 me-1.5" />
							Workflows
						</Link>
					</Button>
					<div className="flex items-center gap-3">
						<h1 className="text-xl font-semibold tracking-tight">{workflow.name}</h1>
						<Badge className={workflowStatusBadge(workflow.status)} variant="outline">
							{workflow.status}
						</Badge>
					</div>
					<p className="max-w-2xl text-sm text-muted-foreground">
						{workflow.description || "No description provided."}
					</p>
				</div>
			</div>

			<div className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-4">
				<div>
					<p className="text-xs text-muted-foreground">Trigger</p>
					<p className="text-sm font-medium">{workflow.trigger}</p>
				</div>
				<div>
					<p className="text-xs text-muted-foreground">Workflow ID</p>
					<p className="truncate font-mono text-sm">{workflow.id}</p>
				</div>
				<div>
					<p className="text-xs text-muted-foreground">Total runs</p>
					<p className="text-sm font-medium">{workflow.runs}</p>
				</div>
				<div>
					<p className="text-xs text-muted-foreground">Steps configured</p>
					<p className="text-sm font-medium">{workflow.tasks.length}</p>
				</div>
			</div>

			<div className="flex items-center justify-between gap-3">
				<div>
					<h2 className="text-lg font-medium">Tasks</h2>
					<p className="text-sm text-muted-foreground">
						Steps in this workflow. New tasks are queued for execution.
					</p>
				</div>
				<Button onClick={() => setModalOpen(true)}>
					<PlusIcon className="size-4 me-1.5" />
					Add task
				</Button>
			</div>

			<div className="rounded-lg border border-border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="ps-6">Step</TableHead>
							<TableHead>Endpoint</TableHead>
							<TableHead>Status</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{workflow.tasks.length === 0 ? (
							<TableRow>
								<TableCell colSpan={3} className="py-8 text-center">
									<EmptyState
										title="No tasks yet"
										description="Add a task to define a step in this workflow."
										icon={<GitBranchIcon className="size-6 text-muted-foreground" />}
									/>
								</TableCell>
							</TableRow>
						) : (
							workflow.tasks.map((task, index) => (
								<TableRow className="h-12" key={task.id}>
									<TableCell className="ps-6 tabular-nums text-muted-foreground">
										{task.stepOrder || index + 1}
									</TableCell>
									<TableCell className="max-w-md truncate font-mono text-sm text-muted-foreground">
										{task.url}
									</TableCell>
									<TableCell>
										<span className={`text-sm font-medium ${statusColor(task.status)}`}>
											{task.status}
										</span>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<div className="flex items-center justify-between gap-3">
				<div>
					<h2 className="text-lg font-medium">Runs</h2>
					<p className="text-sm text-muted-foreground">
						Task executions for this workflow.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm" className="h-9 gap-2">
							<FilterIcon className="size-3.5" />
							{statusFilter ? statuses.find((s) => s.value === statusFilter)?.label ?? "Status" : "Status"}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuRadioGroup value={statusFilter ?? ""} onValueChange={(v) => { setStatusFilter(v || null); setPage(1); }}>
							{statuses.map((s) => (
								<DropdownMenuRadioItem key={s.value ?? "all"} value={s.value ?? ""}>
									{s.label}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>
				</div>
			</div>

			<div className="rounded-lg border border-border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="ps-6">Task ID</TableHead>
							<TableHead>Endpoint</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Scheduled</TableHead>
							<TableHead>Duration</TableHead>
							<TableHead className="pe-6 text-right">Retries</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{loadingRuns && tasks.length === 0 ? (
							<>
								<RunSkeletonRow />
								<RunSkeletonRow />
								<RunSkeletonRow />
							</>
						) : tasks.length === 0 ? (
							<TableRow>
								<TableCell colSpan={6} className="py-8 text-center">
									<EmptyState
										title="No runs yet"
										description="Runs appear here when tasks execute for this workflow."
										icon={<ActivityIcon className="size-6 text-muted-foreground" />}
									/>
								</TableCell>
							</TableRow>
						) : (
							tasks.map((run) => (
								<TableRow className="h-12" key={run.id}>
									<TableCell className="ps-6 font-medium tabular-nums">
										{run.id.slice(0, 8)}...
									</TableCell>
									<TableCell className="max-w-48 truncate text-muted-foreground">
										{run.endpoint}
									</TableCell>
									<TableCell>
										<span className={`text-sm font-medium ${statusColor(run.status)}`}>
											{run.status}
										</span>
									</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{run.scheduled}
									</TableCell>
									<TableCell className="text-sm tabular-nums text-muted-foreground">
										{run.duration ?? "—"}
									</TableCell>
									<TableCell className="pe-6 text-right text-sm tabular-nums text-muted-foreground">
										{run.retries}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{total > 0 && (
				<div className="flex items-center justify-between text-sm text-muted-foreground">
					<span>Showing {tasks.length} of {total} runs</span>
					<div className="flex gap-2">
						<Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
							Previous
						</Button>
						<Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
							Next
						</Button>
					</div>
				</div>
			)}

			<Modal open={modalOpen} onClose={() => { setModalOpen(false); setCreateError(""); }} title="Add task">
				<form onSubmit={handleCreateTask} className="grid gap-4">
					<div className="grid gap-1.5">
						<label className="text-sm font-medium">URL</label>
						<Input
							placeholder="https://example.com/webhook"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
						/>
					</div>

					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Trigger</label>
						<select
							className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							value={trigger}
							onChange={(e) => setTrigger(e.target.value)}
						>
							<option value="queue">Queue</option>
							<option value="webhook">Webhook</option>
							<option value="schedule">Schedule</option>
						</select>
					</div>

					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Payload (JSON)</label>
						<textarea
							className="flex min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							value={payload}
							onChange={(e) => setPayload(e.target.value)}
						/>
					</div>

					{createError && (
						<p className="text-sm text-red-400">{createError}</p>
					)}

					<div className="flex justify-end gap-2 pt-2">
						<Button type="button" variant="outline" onClick={() => { setModalOpen(false); setCreateError(""); }}>
							Cancel
						</Button>
						<Button type="submit" disabled={creating}>
							{creating && <Loader2Icon className="size-4 animate-spin me-1.5" />}
							Add task
						</Button>
					</div>
				</form>
			</Modal>
		</div>
	);
}
