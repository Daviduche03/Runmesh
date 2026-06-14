"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeftIcon, GitBranchIcon, Loader2Icon, PlayIcon, PlusIcon, SaveIcon } from "lucide-react";
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
	const [saveMessage, setSaveMessage] = useState("");
	const [runMessage, setRunMessage] = useState("");
	const [error, setError] = useState("");

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

	const runActive = workflow ? workflowRunIsActive(workflow) : false;

	useEffect(() => {
		if (!workflow || !runActive) return;

		const interval = window.setInterval(() => {
			void fetchWorkflow(true);
		}, RUN_POLL_MS);

		return () => window.clearInterval(interval);
	}, [workflowId, workflow?.status, workflow ? taskStatusKey(workflow) : "", runActive, fetchWorkflow]);

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
		} catch (err) {
			setRunMessage(err instanceof ApiError ? err.message : "Failed to start run");
		} finally {
			setRunning(false);
		}
	}, [workflowId, fetchWorkflow]);

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
	const runIsSuccess = runMessage === "Run started" || runMessage === "Running..." || runMessage === "Completed";
	const runIsError = runMessage.length > 0 && !runIsSuccess;

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
						<span
							className={
								runIsError ? "text-sm text-red-400" : "text-sm text-emerald-400"
							}
						>
							{runMessage}
						</span>
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
		</div>
	);
}
