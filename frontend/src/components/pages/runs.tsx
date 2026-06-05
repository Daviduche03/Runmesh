"use client";

import { useState, useEffect } from "react";
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
import { Modal } from "@/components/ui/modal";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { SearchIcon, ActivityIcon, Loader2Icon, PlusIcon, FilterIcon } from "lucide-react";
import { useRunsStore, type Task } from "@/stores/runs-store";
import EmptyState from "@/components/empty-state"

const statusColor = (status: string) => {
	switch (status) {
		case "Completed": return "text-emerald-400";
		case "Running": return "text-sky-400";
		case "Failed": return "text-red-400";
		case "Pending": return "text-amber-400";
		default: return "text-muted-foreground";
	}
};

const statuses = [
	{ label: "All", value: null },
	{ label: "Running", value: "running" },
	{ label: "Completed", value: "completed" },
	{ label: "Failed", value: "failed" },
	{ label: "Pending", value: "pending" },
] as const;

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

export function RunsPage() {
	const tasks = useRunsStore((s) => s.tasks);
	const total = useRunsStore((s) => s.total);
	const loading = useRunsStore((s) => s.loading);
	const creating = useRunsStore((s) => s.creating);
	const statusFilter = useRunsStore((s) => s.statusFilter);
	const page = useRunsStore((s) => s.page);
	const setStatusFilter = useRunsStore((s) => s.setStatusFilter);
	const setPage = useRunsStore((s) => s.setPage);
	const fetch = useRunsStore((s) => s.fetch);
	const createTask = useRunsStore((s) => s.createTask);

	const [modalOpen, setModalOpen] = useState(false);
	const [url, setUrl] = useState("");
	const [payload, setPayload] = useState("{}");
	const [trigger, setTrigger] = useState("webhook");
	const [error, setError] = useState("");

	useEffect(() => {
		fetch();
	}, [page, statusFilter, fetch]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		if (!url.trim()) {
			setError("URL is required");
			return;
		}
		let parsedPayload: Record<string, unknown> = {};
		try {
			parsedPayload = JSON.parse(payload);
		} catch {
			setError("Payload must be valid JSON");
			return;
		}
		try {
			await createTask({
				url: url.trim(),
				payload: parsedPayload,
				execution_type: trigger,
			});
			setModalOpen(false);
			setUrl("");
			setPayload("{}");
		} catch {
			setError("Failed to create task");
		}
	};

	const totalPages = Math.ceil(total / 50);

	return (
		<div className="grid gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Runs</h1>
					<p className="text-sm text-muted-foreground mt-1">
						View and manage all task executions across your workspace.
					</p>
				</div>
				<Button onClick={() => setModalOpen(true)}>
					<PlusIcon className="size-4 me-1.5" />
					New task
				</Button>
			</div>

			<div className="flex items-center gap-3">
				<div className="relative w-full max-w-sm">
					<SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input placeholder="Search runs..." className="h-9 pl-9" />
				</div>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm" className="h-9 gap-2">
							<FilterIcon className="size-3.5" />
							{statusFilter ? statuses.find((s) => s.value === statusFilter)?.label ?? "Status" : "Status"}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start">
						<DropdownMenuRadioGroup value={statusFilter ?? ""} onValueChange={(v) => setStatusFilter(v || null)}>
							{statuses.map((s) => (
								<DropdownMenuRadioItem key={s.value ?? "all"} value={s.value ?? ""}>
									{s.label}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>
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
						{loading && tasks.length === 0 ? (
							<>
								<RunSkeletonRow />
								<RunSkeletonRow />
								<RunSkeletonRow />
								<RunSkeletonRow />
								<RunSkeletonRow />
							</>
						) : tasks.length === 0 ? (
							<TableRow>
								<TableCell colSpan={6} className="text-center py-8">
									<EmptyState
										title="No runs yet"
										description="Create your first task or workflow to see runs here."
										icon={<ActivityIcon className="size-6 text-muted-foreground" />}
									/>
								</TableCell>
							</TableRow>
						) : (
							<>
								{tasks.map((run: Task) => (
									<TableRow className="h-12" key={run.id}>
										<TableCell className="ps-6 font-medium tabular-nums">
											{run.id.slice(0, 8)}...
										</TableCell>
										<TableCell className="max-w-48 truncate text-muted-foreground">
											{run.endpoint}
										</TableCell>
										<TableCell>
											<span className={`font-medium text-sm ${statusColor(run.status)}`}>
												{run.status}
											</span>
										</TableCell>
										<TableCell className="text-muted-foreground text-sm">
											{run.scheduled}
										</TableCell>
										<TableCell className="tablular-nums text-muted-foreground text-sm">
											{run.duration ?? "—"}
										</TableCell>
										<TableCell className="pe-6 text-right tabular-nums text-muted-foreground text-sm">
											{run.retries}
										</TableCell>
									</TableRow>
								))}
								{loading && (
									<TableRow>
										<TableCell colSpan={6} className="text-center py-3 text-muted-foreground text-sm">
											<Loader2Icon className="size-4 inline animate-spin me-2" />
											Loading more...
										</TableCell>
									</TableRow>
								)}
							</>
						)}
					</TableBody>
				</Table>
			</div>

			{total > 0 && (
				<div className="flex items-center justify-between text-sm text-muted-foreground">
					<span>Showing {tasks.length} of {total} runs</span>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={page <= 1}
							onClick={() => setPage(page - 1)}
						>
							Previous
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={page >= totalPages}
							onClick={() => setPage(page + 1)}
						>
							Next
						</Button>
					</div>
				</div>
			)}

			<Modal open={modalOpen} onClose={() => { setModalOpen(false); setError(""); }} title="New task">
				<form onSubmit={handleSubmit} className="grid gap-4">
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
							<option value="webhook">Webhook</option>
							<option value="queue">Queue</option>
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

					{error && (
						<p className="text-sm text-red-400">{error}</p>
					)}

					<div className="flex justify-end gap-2 pt-2">
						<Button type="button" variant="outline" onClick={() => { setModalOpen(false); setError(""); }}>
							Cancel
						</Button>
						<Button type="submit" disabled={creating}>
							{creating && <Loader2Icon className="size-4 animate-spin me-1.5" />}
							Create task
						</Button>
					</div>
				</form>
			</Modal>
		</div>
	);
}
