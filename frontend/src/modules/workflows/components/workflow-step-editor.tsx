import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2Icon } from "lucide-react";
import type { WorkflowGraphNode } from "@/lib/workflow-graph";

type Props = {
	step: WorkflowGraphNode;
	label: string;
	url: string;
	payload: string;
	payloadTemplate: string;
	onLabelChange: (value: string) => void;
	onUrlChange: (value: string) => void;
	onPayloadChange: (value: string) => void;
	onPayloadTemplateChange: (value: string) => void;
	onBlur: () => void;
	onRemove: () => void;
};

export function WorkflowStepEditor({
	step,
	label,
	url,
	payload,
	payloadTemplate,
	onLabelChange,
	onUrlChange,
	onPayloadChange,
	onPayloadTemplateChange,
	onBlur,
	onRemove,
}: Props) {
	const stepIndex = step.data.label?.match(/Step (\d+)/)?.[1];

	return (
		<div className="flex flex-col rounded-none border border-border bg-card">
			<div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
				<div>
					<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						Step {stepIndex ?? "editor"}
					</p>
					<h3 className="text-sm font-semibold">Configure HTTP request</h3>
				</div>
				<Button variant="outline" size="sm" onClick={onRemove}>
					<Trash2Icon className="size-3.5" />
					Remove
				</Button>
			</div>
			<div className="grid gap-4 p-4">
				<div className="grid gap-1.5">
					<label className="text-sm font-medium">Label</label>
					<Input value={label} onChange={(e) => onLabelChange(e.target.value)} onBlur={onBlur} />
				</div>
				<div className="grid gap-1.5">
					<label className="text-sm font-medium">URL</label>
					<Input
						value={url}
						onChange={(e) => onUrlChange(e.target.value)}
						onBlur={onBlur}
						placeholder="https://api.example.com/hook"
						className="font-mono text-sm"
					/>
				</div>
				<div className="grid gap-1.5">
					<label className="text-sm font-medium">Payload (JSON)</label>
					<textarea
						className="h-36 resize-none rounded-none border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						value={payload}
						onChange={(e) => onPayloadChange(e.target.value)}
						onBlur={onBlur}
					/>
				</div>
				<div className="grid gap-1.5">
					<label className="text-sm font-medium">Payload template (Jinja)</label>
					<textarea
						className="h-28 resize-none rounded-none border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						value={payloadTemplate}
						onChange={(e) => onPayloadTemplateChange(e.target.value)}
						onBlur={onBlur}
						placeholder='{"postId": {{ prev.body.id }}}'
					/>
					<p className="text-xs text-muted-foreground">
						Use prev.body and steps for prior step responses.
					</p>
				</div>
			</div>
		</div>
	);
}
