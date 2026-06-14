import { memo } from "react";
import { useReactFlow } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Maximize2Icon, MinusIcon, PlusIcon } from "lucide-react";

export const WorkflowGraphControls = memo(function WorkflowGraphControls() {
	const { zoomIn, zoomOut, fitView } = useReactFlow();

	return (
		<div className="absolute bottom-3 left-3 z-10 flex items-center gap-0.5 rounded-none border border-border bg-background p-0.5">
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="size-7"
				onClick={() => zoomOut({ duration: 120 })}
			>
				<MinusIcon className="size-3.5" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="size-7"
				onClick={() => zoomIn({ duration: 120 })}
			>
				<PlusIcon className="size-3.5" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="size-7"
				onClick={() => fitView({ padding: 0.2, duration: 200 })}
			>
				<Maximize2Icon className="size-3.5" />
			</Button>
		</div>
	);
});
