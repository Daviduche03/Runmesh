import { memo } from "react";
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

export const WorkflowEdge = memo(function WorkflowEdge({
	id,
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	selected,
}: EdgeProps) {
	const [path] = getSmoothStepPath({
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		borderRadius: 12,
	});

	return (
		<BaseEdge
			id={id}
			path={path}
			style={{
				stroke: selected ? "var(--primary)" : "var(--border)",
				strokeWidth: selected ? 2 : 1.5,
			}}
		/>
	);
});

export const workflowEdgeTypes = {
	workflow: WorkflowEdge,
};
