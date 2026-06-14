export type WorkflowGraphPosition = { x: number; y: number };

export type WorkflowGraphNodeData = {
	label?: string;
	triggerType?: string;
	url?: string;
	payload?: Record<string, unknown>;
	payload_template?: string;
	url_template?: string;
	execution_type?: string;
	task_id?: string;
	stepIndex?: number;
	status?: string;
	workflowStatus?: string;
	stepCount?: number;
	hasUrl?: boolean;
};

export type WorkflowGraphNode = {
	id: string;
	type: "trigger" | "http";
	position: WorkflowGraphPosition;
	data: WorkflowGraphNodeData;
};

export type WorkflowGraphEdge = {
	id: string;
	source: string;
	target: string;
};

export type WorkflowGraph = {
	nodes: WorkflowGraphNode[];
	edges: WorkflowGraphEdge[];
};

export const TRIGGER_NODE_ID = "trigger";

const LAYOUT_TRIGGER_X = 48;
const LAYOUT_STEP_X_START = 300;
const LAYOUT_STEP_X_GAP = 300;
const LAYOUT_Y = 100;

const TRIGGER_LABELS: Record<string, string> = {
	manual: "Manual",
	queue: "Webhook",
	webhook: "Webhook",
	schedule: "Schedule",
};

export function triggerLabel(type: string): string {
	return TRIGGER_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

export function parseWorkflowGraph(raw: unknown): WorkflowGraph | null {
	if (!raw) return null;
	if (typeof raw === "string") {
		try {
			return parseWorkflowGraph(JSON.parse(raw));
		} catch {
			return null;
		}
	}
	if (typeof raw === "object" && raw !== null && Array.isArray((raw as WorkflowGraph).nodes)) {
		return raw as WorkflowGraph;
	}
	return null;
}

export function tasksToWorkflowGraph(
	triggerType: string,
	tasks: Array<{ id: string; stepOrder?: number; url?: string }>,
): WorkflowGraph {
	const graph = emptyWorkflowGraph(triggerType);
	const ordered = [...tasks].sort((a, b) => (a.stepOrder ?? 0) - (b.stepOrder ?? 0));
	let prevId = TRIGGER_NODE_ID;

	for (const [index, task] of ordered.entries()) {
		const nodeId = `http-${task.id}`;
		graph.nodes.push({
			id: nodeId,
			type: "http",
			position: { x: LAYOUT_STEP_X_START + index * LAYOUT_STEP_X_GAP, y: LAYOUT_Y },
			data: {
				label: `Step ${index + 1}`,
				url: task.url ?? "",
				payload: {},
				execution_type: "queue",
				task_id: task.id,
			},
		});
		graph.edges.push({
			id: `edge-${prevId}-${nodeId}`,
			source: prevId,
			target: nodeId,
		});
		prevId = nodeId;
	}

	return layoutWorkflowGraph(graph);
}

export function layoutWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
	const httpIds = linearHttpNodeIds(graph);

	return {
		...graph,
		nodes: graph.nodes.map((node) => {
			if (node.id === TRIGGER_NODE_ID) {
				return { ...node, position: { x: LAYOUT_TRIGGER_X, y: LAYOUT_Y } };
			}
			const index = httpIds.indexOf(node.id);
			if (index >= 0) {
				return {
					...node,
					position: { x: LAYOUT_STEP_X_START + index * LAYOUT_STEP_X_GAP, y: LAYOUT_Y },
				};
			}
			return node;
		}),
	};
}

export function emptyWorkflowGraph(triggerType = "manual"): WorkflowGraph {
	return layoutWorkflowGraph({
		nodes: [
			{
				id: TRIGGER_NODE_ID,
				type: "trigger",
				position: { x: LAYOUT_TRIGGER_X, y: LAYOUT_Y },
				data: { label: "Trigger", triggerType },
			},
		],
		edges: [],
	});
}

export function linearHttpNodeIds(graph: WorkflowGraph): string[] {
	const outgoing = new Map<string, string[]>();
	for (const edge of graph.edges) {
		const list = outgoing.get(edge.source) ?? [];
		list.push(edge.target);
		outgoing.set(edge.source, list);
	}

	const order: string[] = [];
	let current = TRIGGER_NODE_ID;
	const visited = new Set<string>([TRIGGER_NODE_ID]);

	while (true) {
		const next = outgoing.get(current) ?? [];
		if (next.length === 0) break;
		const target = next[0];
		if (visited.has(target)) break;
		order.push(target);
		visited.add(target);
		current = target;
	}

	return order;
}

export function appendHttpStep(graph: WorkflowGraph): WorkflowGraph {
	const httpIds = linearHttpNodeIds(graph);
	const lastId = httpIds.length > 0 ? httpIds[httpIds.length - 1] : TRIGGER_NODE_ID;
	const index = httpIds.length + 1;
	const nodeId = `http-${crypto.randomUUID()}`;
	const node: WorkflowGraphNode = {
		id: nodeId,
		type: "http",
		position: { x: LAYOUT_STEP_X_START + httpIds.length * LAYOUT_STEP_X_GAP, y: LAYOUT_Y },
		data: {
			label: `Step ${index}`,
			url: "",
			payload: {},
			execution_type: "queue",
		},
	};

	return {
		nodes: [...graph.nodes, node],
		edges: [
			...graph.edges,
			{ id: `edge-${lastId}-${nodeId}`, source: lastId, target: nodeId },
		],
	};
}

export function removeHttpNode(graph: WorkflowGraph, nodeId: string): WorkflowGraph {
	if (nodeId === TRIGGER_NODE_ID) return graph;

	const incoming = graph.edges.find((e) => e.target === nodeId);
	const outgoing = graph.edges.find((e) => e.source === nodeId);
	const nodes = graph.nodes.filter((n) => n.id !== nodeId);
	let edges = graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);

	if (incoming && outgoing) {
		edges = [
			...edges,
			{
				id: `edge-${incoming.source}-${outgoing.target}`,
				source: incoming.source,
				target: outgoing.target,
			},
		];
	}

	return { nodes, edges };
}

export function updateHttpNodeData(
	graph: WorkflowGraph,
	nodeId: string,
	patch: Partial<WorkflowGraphNodeData>,
): WorkflowGraph {
	return {
		...graph,
		nodes: graph.nodes.map((node) =>
			node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node,
		),
	};
}

function normalizeNodeData(data: WorkflowGraphNodeData): WorkflowGraphNodeData {
	const payloadTemplate =
		typeof data.payload_template === "string" ? data.payload_template : undefined;
	const urlTemplate = typeof data.url_template === "string" ? data.url_template : undefined;

	return {
		...data,
		payload_template: payloadTemplate,
		url_template: urlTemplate,
	};
}

export function normalizeWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
	return {
		nodes: graph.nodes.map((node) => ({
			...node,
			data: normalizeNodeData(node.data),
		})),
		edges: graph.edges,
	};
}

export function toFlowGraph(graph: WorkflowGraph) {
	const normalized = normalizeWorkflowGraph(graph);
	const httpOrder = linearHttpNodeIds(normalized);
	const stepIndexById = new Map(httpOrder.map((id, index) => [id, index + 1]));

	return {
		nodes: normalized.nodes.map((node) => ({
			id: node.id,
			type: node.type,
			position: node.position,
			data: {
				...node.data,
				stepIndex: stepIndexById.get(node.id),
			},
			draggable: node.type === "http",
		})),
		edges: normalized.edges.map((edge) => ({
			id: edge.id,
			source: edge.source,
			target: edge.target,
			type: "workflow",
		})),
	};
}

export function repairWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
	const triggerType =
		graph.nodes.find((n) => n.id === TRIGGER_NODE_ID)?.data.triggerType ?? "manual";

	let nodes = graph.nodes.map((node) =>
		node.id === TRIGGER_NODE_ID ? { ...node, type: "trigger" as const } : node,
	);

	if (!nodes.some((n) => n.id === TRIGGER_NODE_ID)) {
		nodes = [
			{
				id: TRIGGER_NODE_ID,
				type: "trigger",
				position: { x: LAYOUT_TRIGGER_X, y: LAYOUT_Y },
				data: { label: "Trigger", triggerType },
			},
			...nodes,
		];
	}

	const httpNodes = nodes.filter((n) => n.type === "http");
	let edges = [...graph.edges];

	if (httpNodes.length > 0 && !edges.some((e) => e.source === TRIGGER_NODE_ID)) {
		edges = [
			{
				id: `edge-${TRIGGER_NODE_ID}-${httpNodes[0].id}`,
				source: TRIGGER_NODE_ID,
				target: httpNodes[0].id,
			},
			...edges,
		];
	}

	return { nodes, edges };
}

export function graphForApi(graph: WorkflowGraph): WorkflowGraph {
	const repaired = repairWorkflowGraph(graph);

	return {
		nodes: repaired.nodes.map((node) => {
			const normalized = normalizeNodeData(node.data);
			const { stepIndex: _stepIndex, ...data } = normalized as WorkflowGraphNodeData & {
				stepIndex?: number;
			};
			return {
				id: node.id,
				type: node.type,
				position: node.position,
				data,
			};
		}),
		edges: repaired.edges.map((edge) => ({
			id: edge.id,
			source: edge.source,
			target: edge.target,
		})),
	};
}

export type WorkflowTaskMeta = {
	id: string;
	url: string;
	status: string;
	stepOrder: number;
};

export function taskForNode(
	tasks: WorkflowTaskMeta[],
	nodeData: WorkflowGraphNodeData,
): WorkflowTaskMeta | undefined {
	if (nodeData.task_id) {
		const byId = tasks.find((task) => task.id === nodeData.task_id);
		if (byId) return byId;
	}
	const stepOrder = (nodeData.stepIndex ?? 1) - 1;
	return tasks.find((task) => task.stepOrder === stepOrder);
}

export function httpNodeHasUrl(data: WorkflowGraphNodeData): boolean {
	if (data.url?.trim()) return true;
	if (typeof data.url_template === "string" && data.url_template.trim()) return true;
	return false;
}

export function enrichFlowNodes(
	nodes: Array<{ id: string; type?: string; position: WorkflowGraphPosition; data: WorkflowGraphNodeData }>,
	tasks: WorkflowTaskMeta[],
	meta: { workflowStatus?: string; stepCount?: number },
) {
	return nodes.map((node) => {
		if (node.type === "trigger") {
			return {
				...node,
				data: {
					...node.data,
					workflowStatus: meta.workflowStatus,
					stepCount: meta.stepCount,
				},
			};
		}

		if (node.type !== "http") return node;

		const task = taskForNode(tasks, node.data);
		const hasUrl = httpNodeHasUrl(node.data);

		return {
			...node,
			data: {
				...node.data,
				status: task?.status ?? (hasUrl ? "Pending" : "Draft"),
				hasUrl,
			},
		};
	});
}

export function fromFlowGraph(
	nodes: Array<{ id: string; type?: string; position: WorkflowGraphPosition; data: WorkflowGraphNodeData }>,
	edges: Array<{ id: string; source: string; target: string }>,
): WorkflowGraph {
	return {
		nodes: nodes.map((node) => ({
			id: node.id,
			type: (node.type === "http" ? "http" : "trigger") as "trigger" | "http",
			position: node.position,
			data: node.data,
		})),
		edges: edges.map((edge) => ({
			id: edge.id,
			source: edge.source,
			target: edge.target,
		})),
	};
}
