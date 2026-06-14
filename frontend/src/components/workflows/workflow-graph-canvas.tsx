"use client";

import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	ReactFlow,
	ReactFlowProvider,
	Background,
	Panel,
	useNodesState,
	useEdgesState,
	addEdge,
	type Connection,
	type Node,
	type Edge,
	type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { apiPut } from "@/lib/api";
import {
	appendHttpStep,
	enrichFlowNodes,
	fromFlowGraph,
	graphForApi,
	normalizeWorkflowGraph,
	removeHttpNode,
	toFlowGraph,
	updateHttpNodeData,
	type WorkflowGraph,
	type WorkflowGraphNodeData,
	type WorkflowTaskMeta,
	TRIGGER_NODE_ID,
} from "@/lib/workflow-graph";
import { workflowNodeTypes } from "@/components/workflows/workflow-graph-nodes";
import { workflowEdgeTypes } from "@/components/workflows/workflow-graph-edges";
import { WorkflowGraphControls } from "@/components/workflows/workflow-graph-controls";
import { WorkflowStepEditor } from "@/components/workflows/workflow-step-editor";

export type WorkflowGraphCanvasHandle = {
	addStep: () => void;
	save: () => Promise<void>;
};

type Props = {
	workflowId: string;
	initialGraph: WorkflowGraph;
	tasks?: WorkflowTaskMeta[];
	workflowStatus?: string;
	stepCount?: number;
	onSaved?: (graph: WorkflowGraph) => void;
	onSavingChange?: (saving: boolean) => void;
	onSaveMessage?: (message: string) => void;
};

function flowNodesFromGraph(
	graph: WorkflowGraph,
	tasks: WorkflowTaskMeta[] = [],
	meta: { workflowStatus?: string; stepCount?: number } = {},
): Node[] {
	const flow = toFlowGraph(graph);
	const enriched = enrichFlowNodes(
		flow.nodes as Array<{ id: string; type?: string; position: { x: number; y: number }; data: WorkflowGraphNodeData }>,
		tasks,
		meta,
	);
	return enriched as Node[];
}

function flowEdgesFromGraph(graph: WorkflowGraph): Edge[] {
	return toFlowGraph(graph).edges as Edge[];
}

function graphFromFlow(nodes: Node[], edges: Edge[]): WorkflowGraph {
	return fromFlowGraph(
		nodes.map((n) => ({
			id: n.id,
			type: n.type,
			position: n.position,
			data: n.data as WorkflowGraphNodeData,
		})),
		edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
	);
}

function mergeSavedGraph(local: WorkflowGraph, server: WorkflowGraph): WorkflowGraph {
	const positions = new Map(local.nodes.map((node) => [node.id, node.position]));
	return normalizeWorkflowGraph({
		nodes: server.nodes.map((node) => ({
			...node,
			position: positions.get(node.id) ?? node.position,
		})),
		edges: server.edges,
	});
}

function WorkflowGraphCanvasInner({
	workflowId,
	initialGraph,
	tasks = [],
	workflowStatus,
	stepCount,
	onSaved,
	onSavingChange,
	onSaveMessage,
	canvasRef,
}: Props & { canvasRef: React.Ref<WorkflowGraphCanvasHandle> }) {
	const bootGraph = useMemo(
		() => normalizeWorkflowGraph(initialGraph),
		[initialGraph],
	);

	const nodeMeta = useMemo(
		() => ({
			workflowStatus,
			stepCount: stepCount ?? bootGraph.nodes.filter((n) => n.type === "http").length,
		}),
		[workflowStatus, stepCount, bootGraph],
	);

	const [nodes, setNodes, onNodesChange] = useNodesState(
		flowNodesFromGraph(bootGraph, tasks, nodeMeta),
	);
	const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdgesFromGraph(bootGraph));
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [saveError, setSaveError] = useState("");
	const [url, setUrl] = useState("");
	const [payload, setPayload] = useState("{}");
	const [payloadTemplate, setPayloadTemplate] = useState("");
	const [label, setLabel] = useState("");

	const nodesRef = useRef(nodes);
	const edgesRef = useRef(edges);
	const selectedNodeIdRef = useRef(selectedNodeId);
	const labelRef = useRef(label);
	const urlRef = useRef(url);
	const payloadRef = useRef(payload);
	const payloadTemplateRef = useRef(payloadTemplate);
	const persistInFlightRef = useRef(false);
	const pendingAutoSaveRef = useRef(false);

	nodesRef.current = nodes;
	edgesRef.current = edges;
	selectedNodeIdRef.current = selectedNodeId;
	labelRef.current = label;
	urlRef.current = url;
	payloadRef.current = payload;
	payloadTemplateRef.current = payloadTemplate;

	const graph = useMemo(() => graphFromFlow(nodes, edges), [nodes, edges]);
	const selectedNode = graph.nodes.find((n) => n.id === selectedNodeId) ?? null;
	const httpStepCount = graph.nodes.filter((n) => n.type === "http").length;

	useEffect(() => {
		if (!selectedNode || selectedNode.type !== "http") {
			setUrl("");
			setPayload("{}");
			setPayloadTemplate("");
			setLabel("");
			return;
		}
		setUrl(selectedNode.data.url ?? "");
		setLabel(selectedNode.data.label ?? "");
		setPayload(JSON.stringify(selectedNode.data.payload ?? {}, null, 2));
		setPayloadTemplate(selectedNode.data.payload_template ?? "");
	}, [selectedNode]);

	const applyGraph = useCallback(
		(nextGraph: WorkflowGraph) => {
			const flow = toFlowGraph(nextGraph);
			setNodes(flowNodesFromGraph(nextGraph, tasks, nodeMeta));
			setEdges(flow.edges as Edge[]);
		},
		[setNodes, setEdges, tasks, nodeMeta],
	);

	useEffect(() => {
		setNodes((current) =>
			enrichFlowNodes(
				current.map((node) => ({
					id: node.id,
					type: node.type,
					position: node.position,
					data: node.data as WorkflowGraphNodeData,
				})),
				tasks,
				nodeMeta,
			) as Node[],
		);
	}, [tasks, nodeMeta, setNodes]);

	const buildPayloadGraph = useCallback((): WorkflowGraph | null => {
		let payloadGraph = graphFromFlow(nodesRef.current, edgesRef.current);
		const currentSelectedId = selectedNodeIdRef.current;

		if (currentSelectedId) {
			const currentSelected = payloadGraph.nodes.find((n) => n.id === currentSelectedId);
			if (currentSelected?.type === "http") {
				try {
					const parsed = JSON.parse(payloadRef.current) as Record<string, unknown>;
					payloadGraph = updateHttpNodeData(payloadGraph, currentSelectedId, {
						label: labelRef.current.trim() || currentSelected.data.label,
						url: urlRef.current.trim(),
						payload: parsed,
						payload_template: payloadTemplateRef.current.trim() || undefined,
					});
				} catch {
					return null;
				}
			}
		}

		return graphForApi(payloadGraph);
	}, []);

	const persistGraph = useCallback(
		async (options?: { silent?: boolean; successMessage?: string; graph?: WorkflowGraph }) => {
			const payloadGraph = options?.graph
				? graphForApi(options.graph)
				: buildPayloadGraph();
			if (!payloadGraph) {
				const message = "Payload must be valid JSON";
				setSaveError(message);
				onSaveMessage?.(message);
				return false;
			}

			if (persistInFlightRef.current) {
				pendingAutoSaveRef.current = true;
				return false;
			}

			persistInFlightRef.current = true;
			if (!options?.silent) onSavingChange?.(true);
			setSaveError("");
			onSaveMessage?.(options?.silent ? "Saving..." : "");

			try {
				const { data: saved } = await apiPut<WorkflowGraph>(
					`/api/v1/workflows/${workflowId}/graph`,
					payloadGraph,
				);
				const merged = mergeSavedGraph(payloadGraph, saved);
				applyGraph(merged);
				const message = options?.successMessage ?? "Saved";
				onSaveMessage?.(message);
				onSaved?.(merged);
				return true;
			} catch (err) {
				const message = err instanceof Error ? err.message : "Failed to save graph";
				setSaveError(message);
				onSaveMessage?.(message);
				return false;
			} finally {
				persistInFlightRef.current = false;
				if (!options?.silent) onSavingChange?.(false);
				if (pendingAutoSaveRef.current) {
					pendingAutoSaveRef.current = false;
					void persistGraph({ silent: true, successMessage: "Saved" });
				}
			}
		},
		[applyGraph, buildPayloadGraph, onSaved, onSaveMessage, onSavingChange, workflowId],
	);

	const saveNow = useCallback(
		(graph?: WorkflowGraph) => {
			void persistGraph({ silent: true, successMessage: "Saved", graph });
		},
		[persistGraph],
	);

	const onInit = useCallback((instance: ReactFlowInstance) => {
		window.requestAnimationFrame(() => {
			instance.fitView({ padding: 0.25, minZoom: 0.5, maxZoom: 1 });
		});
	}, []);

	const onConnect = useCallback(
		(connection: Connection) => {
			if (!connection.source || !connection.target) return;
			if (connection.source === connection.target) return;
			setEdges((current) => {
				const nextEdges = addEdge(
					{
						...connection,
						id: `edge-${connection.source}-${connection.target}`,
						type: "workflow",
					},
					current,
				);
				const nextGraph = graphFromFlow(nodesRef.current, nextEdges);
				saveNow(nextGraph);
				return nextEdges;
			});
		},
		[saveNow, setEdges],
	);

	const handleAddStep = useCallback(() => {
		const nextGraph = appendHttpStep(graphFromFlow(nodesRef.current, edgesRef.current));
		applyGraph(nextGraph);
		saveNow(nextGraph);
	}, [applyGraph, saveNow]);

	const handleRemoveStep = useCallback(() => {
		const currentSelectedId = selectedNodeIdRef.current;
		if (!currentSelectedId || currentSelectedId === TRIGGER_NODE_ID) return;
		const nextGraph = removeHttpNode(
			graphFromFlow(nodesRef.current, edgesRef.current),
			currentSelectedId,
		);
		applyGraph(nextGraph);
		setSelectedNodeId(null);
		saveNow(nextGraph);
	}, [applyGraph, saveNow]);

	const applySelectedEdits = useCallback(() => {
		const currentSelectedId = selectedNodeIdRef.current;
		if (!currentSelectedId) return;

		const currentGraph = graphFromFlow(nodesRef.current, edgesRef.current);
		const currentSelected = currentGraph.nodes.find((n) => n.id === currentSelectedId);
		if (currentSelected?.type !== "http") return;

		let parsed: Record<string, unknown> = {};
		try {
			parsed = JSON.parse(payloadRef.current);
		} catch {
			setSaveError("Payload must be valid JSON");
			return;
		}

		setSaveError("");
		const nextGraph = updateHttpNodeData(currentGraph, currentSelectedId, {
			label: labelRef.current.trim() || currentSelected.data.label,
			url: urlRef.current.trim(),
			payload: parsed,
			payload_template: payloadTemplateRef.current.trim() || undefined,
		});
		applyGraph(nextGraph);
		saveNow(nextGraph);
	}, [applyGraph, saveNow]);

	const handleSave = useCallback(async () => {
		await persistGraph({ successMessage: "Saved" });
	}, [persistGraph]);

	const onNodeDragStop = useCallback(
		(_event: MouseEvent | TouchEvent, draggedNode: Node) => {
			const mergedNodes = nodesRef.current.map((node) =>
				node.id === draggedNode.id ? draggedNode : node,
			);
			saveNow(graphFromFlow(mergedNodes, edgesRef.current));
		},
		[saveNow],
	);

	useImperativeHandle(
		canvasRef,
		() => ({
			addStep: handleAddStep,
			save: handleSave,
		}),
		[handleAddStep, handleSave],
	);

	return (
		<div className="grid gap-4">
			<div
				className={
					selectedNode?.type === "http"
						? "grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"
						: "grid gap-4"
				}
			>
				<div
					className="workflow-graph-shell relative w-full overflow-hidden rounded-none border border-border bg-background"
					style={{ height: 720 }}
				>
					<ReactFlow
						nodes={nodes}
						edges={edges}
						onNodesChange={onNodesChange}
						onEdgesChange={onEdgesChange}
						onConnect={onConnect}
						onInit={onInit}
						onNodeClick={(_, node) => setSelectedNodeId(node.id)}
						onNodeDragStop={onNodeDragStop}
						onPaneClick={() => setSelectedNodeId(null)}
						nodeTypes={workflowNodeTypes}
						edgeTypes={workflowEdgeTypes}
						defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
						minZoom={0.35}
						maxZoom={1.25}
						proOptions={{ hideAttribution: true }}
						nodesDraggable
						nodesConnectable
						elementsSelectable
						deleteKeyCode={null}
						style={{ width: "100%", height: "100%" }}
					>
						<Background gap={24} size={1} color="var(--border)" />
						<Panel position="top-left" className="m-3">
							<div className="rounded-none border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
								{httpStepCount} step{httpStepCount === 1 ? "" : "s"} · saves on edit or drag
							</div>
						</Panel>
						<WorkflowGraphControls />
					</ReactFlow>
				</div>

				{selectedNode?.type === "http" && (
					<div className="w-full lg:sticky lg:top-4">
						<WorkflowStepEditor
							step={selectedNode}
							label={label}
							url={url}
							payload={payload}
							payloadTemplate={payloadTemplate}
							onLabelChange={setLabel}
							onUrlChange={setUrl}
							onPayloadChange={setPayload}
							onPayloadTemplateChange={setPayloadTemplate}
							onBlur={applySelectedEdits}
							onRemove={handleRemoveStep}
						/>
					</div>
				)}
			</div>

			{saveError && <p className="text-sm text-red-400">{saveError}</p>}
		</div>
	);
}

export const WorkflowGraphCanvas = forwardRef<WorkflowGraphCanvasHandle, Props>(
	function WorkflowGraphCanvas(props, ref) {
		const innerRef = useRef<WorkflowGraphCanvasHandle>(null);

		useImperativeHandle(
			ref,
			() => ({
				addStep: () => innerRef.current?.addStep(),
				save: async () => {
					await innerRef.current?.save();
				},
			}),
			[],
		);

		return (
			<ReactFlowProvider>
				<WorkflowGraphCanvasInner {...props} canvasRef={innerRef} />
			</ReactFlowProvider>
		);
	},
);
