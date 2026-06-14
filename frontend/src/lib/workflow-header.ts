import type { Workflow } from "@/stores/workflows-store";
import { triggerLabel } from "@/lib/workflow-graph";

export function titleCase(value: string): string {
	return value
		.trim()
		.split(/\s+/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
}

export function sentenceCase(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";
	return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function isMeaningfulDescription(workflow: Workflow): boolean {
	const desc = workflow.description?.trim() ?? "";
	if (desc.length < 3) return false;
	return desc.toLowerCase() !== workflow.name.trim().toLowerCase();
}

export function workflowHeaderTitle(workflow: Workflow): string {
	return titleCase(workflow.name);
}

export function workflowHeaderSubtitle(workflow: Workflow): string {
	if (isMeaningfulDescription(workflow)) {
		return sentenceCase(workflow.description);
	}

	const steps = workflow.stepCount ?? workflow.tasks.length;
	const trigger = workflow.trigger || triggerLabel(workflow.triggerType);
	return `Design and save HTTP steps for this ${trigger} workflow (${steps} step${steps === 1 ? "" : "s"} configured).`;
}
