"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeftIcon, GitBranchIcon, Loader2Icon, PlayIcon, PlusIcon, SaveIcon, StopCircleIcon, ListIcon, KeyRoundIcon } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { Workflow } from "@/stores/workflows-store";
import EmptyState from "@/components/empty-state";
import {
	WorkflowGraphCanvas,
	type WorkflowGraphCanvasHandle,
} from "@/components/workflows/workflow-graph-canvas";
import {
	emptyWorkflowGraph,
	layoutWorkflowGraph,
	normalizeWorkflowGraph,
	parseWorkflowGraph,
	tasksToWorkflowGraph,
	type WorkflowGraph,
} from "@/lib/workflow-graph";
import { workflowHeaderSubtitle, workflowHeaderTitle } from "@/lib/workflow-header";

type WorkflowRun = {
	id: string;
	status: string;
	triggeredBy: string;
	currentStep: number;
	startedAt: string;
	completedAt: string;
	duration: string | null;
};

const RUN_POLL_MS = 2000;

function workflowRunIsActive(workflow: Workflow): boolean {
	const status = workflow.status.toLowerCase();
	if (status === "running") return true;
	return workflow.tasks.some((task) => {
		const taskStatus = task.status.toLowerCase();
		return taskStatus === "running" || taskStatus === "queued";
	});
}

function taskStatusKey(workflow: Workflow): string {
	return workflow.tasks.map((task) => `${task.id}:${task.status}`).join("|");
}

function resolveWorkflowGraph(workflow: Workflow): WorkflowGraph {
	const parsed = parseWorkflowGraph(workflow.graph);
	if (parsed?.nodes?.length) {
		return normalizeWorkflowGraph(parsed);
	}
	if (workflow.tasks.length > 0) {
		return layoutWorkflowGraph(
			normalizeWorkflowGraph(tasksToWorkflowGraph(workflow.triggerType, workflow.tasks)),
		);
	}
	return emptyWorkflowGraph(workflow.triggerType);
}

export function WorkflowDetailPage() {
	const { workflowId = "" } = useParams();
	const canvasRef = useRef<WorkflowGraphCanvasHandle>(null);
	const [workflow, setWorkflow] = useState<Workflow | null>(null);
	const [loadingWorkflow, setLoadingWorkflow] = useState(true);
	const [saving, setSaving] = useState(false);
	const [running, setRunning] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	const [saveMessage, setSaveMessage] = useState("");
	const [runMessage, setRunMessage] = useState("");
	const [error, setError] = useState("");
	const [runs, setRuns] = useState<WorkflowRun[]>([]);
	const [loadingRuns, setLoadingRuns] = useState(false);
	const [runsTokenMap, setRunsTokenMap] = useState<Record<string, number>>({});

	const fetchWorkflow = useCallback(async (silent = false) => {
		if (!workflowId) return;
		if (!silent) setLoadingWorkflow(true);
		setError("");
		try {
			const { data: workflow } = await apiGet<Workflow>(`/api/v1/workflows/${workflowId}`);
			setWorkflow(workflow);
		} catch {
			setError("Workflow not found");
			setWorkflow(null);
		} finally {
			if (!silent) setLoadingWorkflow(false);
		}
	}, [workflowId]);

	useEffect(() => {
		fetchWorkflow();
	}, [fetchWorkflow]);

	const fetchRuns = useCallback(async () => {
		if (!workflowId) return;
		setLoadingRuns(true);
		try {
			const { data } = await apiGet<WorkflowRun[]>(`/api/v1/workflows/${workflowId}/runs`);
			setRuns(data);

			const runIds = (data ?? []).map((r) => r.id).filter(Boolean);
			if (runIds.length > 0) {
				const tokenPromises = runIds.map((rid) =>
					apiGet<{ id: string; metadata: Record<string, unknown> }[]>(
						`/api/v1/connect/tokens?workflow_run_id=${rid}`,
					).catch(() => ({ data: [] })),
				);
				const tokenResults = await Promise.all(tokenPromises);
				const map: Record<string, number> = {};
				tokenResults.forEach((res, i) => {
					if (res.data?.length) map[runIds[i]] = res.data.length;
				});
				setRunsTokenMap(map);
			}
		} catch {
			// ignore
		} finally {
			setLoadingRuns(false);
		}
	}, [workflowId]);

	useEffect(() => {
		void fetchRuns();
	}, [fetchRuns]);

	const runActive = workflow ? workflowRunIsActive(workflow) : false;

	useEffect(() => {
		if (!workflow || !runActive) return;

		const interval = window.setInterval(() => {
			void fetchWorkflow(true);
			void fetchRuns();
		}, RUN_POLL_MS);

		return () => window.clearInterval(interval);
	}, [workflowId, workflow?.status, workflow ? taskStatusKey(workflow) : "", runActive, fetchWorkflow, fetchRuns]);

	useEffect(() => {
		if (!workflow) return;
		if (runActive) {
			setRunMessage((current) =>
				current.startsWith("Failed") ? current : "Running...",
			);
			return;
		}
		const status = workflow.status.toLowerCase();
		if (status === "completed") {
			setRunMessage((current) =>
				current === "Running..." || current === "Run started" ? "Completed" : current,
			);
		} else if (status === "failed") {
			setRunMessage((current) =>
				current === "Running..." || current === "Run started" ? "Run failed" : current,
			);
		}
	}, [workflow, runActive]);

	const graph = useMemo(
		() => (workflow ? resolveWorkflowGraph(workflow) : null),
		[workflow],
	);

	const handleRunWorkflow = useCallback(async () => {
		if (!workflowId) return;
		setRunning(true);
		setRunMessage("");
		try {
			await apiPost(`/api/v1/workflows/${workflowId}/run`);
			setRunMessage("Run started");
			await fetchWorkflow(true);
			await fetchRuns();
		} catch (err) {
			setRunMessage(err instanceof ApiError ? err.message : "Failed to start run");
		} finally {
			setRunning(false);
		}
	}, [workflowId, fetchWorkflow, fetchRuns]);

	const handleCancelWorkflow = useCallback(async () => {
		if (!workflowId) return;
		setCancelling(true);
		try {
			await apiPost(`/api/v1/workflows/${workflowId}/cancel`);
			setRunMessage("Cancelled");
			await fetchWorkflow(true);
			await fetchRuns();
		} catch (err) {
			setRunMessage(err instanceof ApiError ? err.message : "Failed to cancel");
		} finally {
			setCancelling(false);
		}
	}, [workflowId, fetchWorkflow, fetchRuns]);

	const handleGraphSaved = useCallback(
		(savedGraph: WorkflowGraph) => {
			const stepCount = savedGraph.nodes.filter((n) => n.type === "http").length;
			setWorkflow((current) =>
				current
					? {
							...current,
							stepCount,
							graph: savedGraph,
							updatedAt: new Date().toISOString(),
						}
					: current,
			);
			void fetchWorkflow(true);
		},
		[fetchWorkflow],
	);

	if (loadingWorkflow) {
		return (
			<div className="grid gap-4">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-72" />
				<Skeleton className="h-[720px] w-full" />
			</div>
		);
	}

	if (error || !workflow || !graph) {
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

	const saveIsSaving = saveMessage === "Saving...";
	const saveIsError = saveMessage.length > 0 && saveMessage !== "Saved" && !saveIsSaving;

	const runStatusClass =
		runMessage === "Run started" || runMessage === "Running..." || runMessage === "Completed"
			? "text-sm text-emerald-400"
			: "text-sm text-red-400";

	return (
		<div className="grid gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">{workflowHeaderTitle(workflow)}</h1>
					<p className="text-sm text-muted-foreground mt-1">
						{workflowHeaderSubtitle(workflow)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					{runMessage && (
						<span className={runStatusClass}>{runMessage}</span>
					)}
					{saveMessage && (
						<span
							className={
								saveIsError
									? "text-sm text-red-400"
									: saveIsSaving
										? "text-sm text-muted-foreground"
										: "text-sm text-emerald-400"
							}
						>
							{saveMessage}
						</span>
					)}
					{runActive ? (
						<Button
							variant="outline"
							onClick={() => void handleCancelWorkflow()}
							disabled={cancelling}
							className="border-red-500/30 text-red-400 hover:bg-red-500/10"
						>
							{cancelling ? (
								<Loader2Icon className="size-4 me-1.5 animate-spin" />
							) : (
								<StopCircleIcon className="size-4 me-1.5" />
							)}
							Cancel
						</Button>
					) : null}
					<Button
						variant="outline"
						onClick={() => void handleRunWorkflow()}
						disabled={
							running ||
							runActive ||
							(workflow.stepCount ?? workflow.tasks.length) === 0
						}
					>
						{running || runActive ? (
							<Loader2Icon className="size-4 me-1.5 animate-spin" />
						) : (
							<PlayIcon className="size-4 me-1.5" />
						)}
						{runActive ? "Running" : "Run"}
					</Button>
					<Button variant="outline" onClick={() => canvasRef.current?.addStep()}>
						<PlusIcon className="size-4 me-1.5" />
						Add step
					</Button>
					<Button onClick={() => void canvasRef.current?.save()} disabled={saving}>
						{saving ? (
							<Loader2Icon className="size-4 me-1.5 animate-spin" />
						) : (
							<SaveIcon className="size-4 me-1.5" />
						)}
						Save
					</Button>
				</div>
			</div>

			<WorkflowGraphCanvas
				ref={canvasRef}
				key={workflow.id}
				workflowId={workflow.id}
				initialGraph={graph}
				tasks={workflow.tasks}
				workflowStatus={workflow.status}
				stepCount={workflow.stepCount ?? workflow.tasks.length}
				onSaved={handleGraphSaved}
				onSavingChange={setSaving}
				onSaveMessage={setSaveMessage}
			/>

			<div className="rounded-lg border border-border">
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<div className="flex items-center gap-2">
						<ListIcon className="size-4 text-muted-foreground" />
						<h2 className="text-sm font-semibold">Run history</h2>
					</div>
					{loadingRuns && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
				</div>
				{runs.length === 0 && !loadingRuns ? (
					<div className="px-4 py-8 text-center text-sm text-muted-foreground">
						No runs yet. Press Run to start one.
					</div>
				) : (
					<div className="divide-y divide-border">
						{runs.map((run) => (
							<div key={run.id} className="flex items-center justify-between px-4 py-3">
								<div className="flex items-center gap-3">
									<span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
										run.status === "Running" ? "bg-sky-500/10 text-sky-400 border-sky-500/20" :
										run.status === "Completed" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
										run.status === "Failed" ? "bg-red-500/10 text-red-400 border-red-500/20" :
										run.status === "Cancelled" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
										"bg-muted text-muted-foreground border-border"
									}`}>
										{run.status}
									</span>
									<span className="text-sm text-muted-foreground">
										{run.triggeredBy}
									</span>
								</div>
								<div className="flex items-center gap-4 text-sm text-muted-foreground">
									{runsTokenMap[run.id] ? (
										<span className="inline-flex items-center gap-1 text-muted-foreground" title="Connect tokens issued">
											<KeyRoundIcon className="size-3" />
											{runsTokenMap[run.id]}
										</span>
									) : null}
									{run.duration && <span>{run.duration}</span>}
									<span>{new Date(run.startedAt).toLocaleString()}</span>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
