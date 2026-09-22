import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertCircleIcon, GlobeIcon, WebhookIcon, ZapIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { triggerLabel, type WorkflowGraphNodeData } from "@/lib/workflow-graph";

const handleClass =
	"!size-2 !border-2 !border-background !bg-muted-foreground transition-colors group-hover:!bg-primary";

type GraphNodeData = WorkflowGraphNodeData & { stepIndex?: number };

function statusBadgeClass(status: string): string {
	switch (status.toLowerCase()) {
		case "completed":
			return "border-emerald-500/20 bg-emerald-500/10 text-emerald-400";
		case "running":
			return "border-sky-500/20 bg-sky-500/10 text-sky-400";
		case "failed":
			return "border-red-500/20 bg-red-500/10 text-red-400";
		case "queued":
		case "pending":
			return "border-amber-500/20 bg-amber-500/10 text-amber-400";
		case "active":
			return "border-emerald-500/20 bg-emerald-500/10 text-emerald-400";
		case "paused":
			return "border-amber-500/20 bg-amber-500/10 text-amber-400";
		case "draft":
		case "unsaved":
			return "border-border bg-muted text-muted-foreground";
		default:
			return "border-border bg-muted text-muted-foreground";
	}
}

function StatusBadge({ status }: { status: string }) {
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
				statusBadgeClass(status),
			)}
		>
			{status}
		</span>
	);
}

function MetaRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
	return (
		<div className="flex items-center justify-between gap-2 text-[11px]">
			<span className="text-muted-foreground">{label}</span>
			<span className={cn("truncate text-foreground", mono && "font-mono")}>{value}</span>
		</div>
	);
}

export const TriggerGraphNode = memo(function TriggerGraphNode({ data, selected }: NodeProps) {
	const nodeData = data as GraphNodeData;
	const label = nodeData.label ?? "Trigger";
	const triggerType = triggerLabel(nodeData.triggerType ?? "manual");
	const isWebhook = nodeData.triggerType === "queue" || nodeData.triggerType === "webhook";
	const workflowStatus = nodeData.workflowStatus ?? "Draft";
	const stepCount = nodeData.stepCount ?? 0;

	return (
		<div
			className={cn(
				"group w-64 rounded-none border bg-card transition-colors",
				selected ? "border-primary" : "border-border hover:border-muted-foreground/40",
			)}
		>
			<div
				className={cn(
					"h-0.5 rounded-none",
					isWebhook ? "bg-sky-500/80" : "bg-primary/80",
				)}
			/>
			<div className="px-3.5 py-3">
				<Handle type="source" position={Position.Right} className={handleClass} />
				<div className="mb-2.5 flex items-center justify-between gap-2">
					<span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						Trigger
					</span>
					<StatusBadge status={workflowStatus} />
				</div>
				<div className="flex items-start gap-3">
					<div
						className={cn(
							"flex size-9 shrink-0 items-center justify-center rounded-none border",
							isWebhook
								? "border-sky-500/20 bg-sky-500/10 text-sky-400"
								: "border-primary/20 bg-primary/10 text-primary",
						)}
					>
						{isWebhook ? (
							<WebhookIcon className="size-4" />
						) : (
							<ZapIcon className="size-4" />
						)}
					</div>
					<div className="min-w-0 flex-1 space-y-1">
						<p className="truncate text-sm font-medium">{label}</p>
						<p className="truncate text-xs text-muted-foreground">{triggerType}</p>
					</div>
				</div>
				<div className="mt-3 space-y-1 border-t border-border pt-2.5">
					<MetaRow label="Steps" value={String(stepCount)} />
					<MetaRow label="Mode" value={isWebhook ? "Inbound webhook" : "Manual run"} />
				</div>
			</div>
		</div>
	);
});

function stepUrl(data: WorkflowGraphNodeData): string {
	if (data.url?.trim()) return data.url.trim();
	if (typeof data.url_template === "string" && data.url_template.trim()) {
		return data.url_template.trim();
	}
	return "";
}

function displayHost(url: string): string {
	if (!url) return "No URL configured";
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

function executionLabel(type?: string): string {
	if (!type) return "Queue";
	return type.charAt(0).toUpperCase() + type.slice(1);
}

export const HttpGraphNode = memo(function HttpGraphNode({ data, selected }: NodeProps) {
	const nodeData = data as GraphNodeData;
	const label = nodeData.label ?? "HTTP step";
	const url = stepUrl(nodeData);
	const host = displayHost(url);
	const stepIndex = nodeData.stepIndex ?? 0;
	const status = nodeData.status ?? (nodeData.hasUrl ? "Pending" : "Draft");
	const hasUrl = nodeData.hasUrl ?? Boolean(url);
	const executionType = executionLabel(nodeData.execution_type);

	return (
		<div
			className={cn(
				"group w-72 rounded-none border bg-card transition-colors",
				selected ? "border-primary" : "border-border hover:border-muted-foreground/40",
			)}
		>
			<div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2">
				<div className="flex items-center gap-2">
					<span className="flex size-5 items-center justify-center border border-border bg-muted text-[10px] font-semibold text-muted-foreground">
						{stepIndex || "·"}
					</span>
					<span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						HTTP
					</span>
				</div>
				<StatusBadge status={status} />
			</div>
			<div className="px-3.5 py-3">
				<Handle type="target" position={Position.Left} className={handleClass} />
				<Handle type="source" position={Position.Right} className={handleClass} />
				<div className="flex items-start gap-3">
					<div className="flex size-9 shrink-0 items-center justify-center rounded-none border border-border bg-muted text-muted-foreground">
						<GlobeIcon className="size-4" />
					</div>
					<div className="min-w-0 flex-1 space-y-1">
						<p className="truncate text-sm font-medium">{label}</p>
						<p className={cn("truncate font-mono text-xs", hasUrl ? "text-muted-foreground" : "text-amber-400")}>
							{host}
						</p>
					</div>
				</div>
				<div className="mt-3 space-y-1 border-t border-border pt-2.5">
					<MetaRow label="Method" value="POST" mono />
					<MetaRow label="Dispatch" value={executionType} />
					{nodeData.task_id && <MetaRow label="Task" value={nodeData.task_id.slice(0, 8)} mono />}
				</div>
				{!hasUrl && (
					<div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-amber-400">
						<AlertCircleIcon className="size-3 shrink-0" />
						<span>URL required before run</span>
					</div>
				)}
			</div>
		</div>
	);
});

export const workflowNodeTypes = {
	trigger: TriggerGraphNode,
	http: HttpGraphNode,
};
