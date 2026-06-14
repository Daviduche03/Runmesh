import json
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

from db.orm import TaskModel, WorkflowModel
from services.templating import apply_task_templates
from services.workflow_trigger_config import normalize_trigger_config, parse_trigger_config

NODE_TRIGGER = "trigger"
NODE_HTTP = "http"
TRIGGER_NODE_ID = "trigger"


def empty_graph(trigger_type: str = "manual") -> dict[str, Any]:
    return {
        "nodes": [
            {
                "id": TRIGGER_NODE_ID,
                "type": NODE_TRIGGER,
                "position": {"x": 40, "y": 160},
                "data": {"label": "Trigger", "triggerType": trigger_type},
            }
        ],
        "edges": [],
    }


def parse_graph_field(raw: Any) -> Optional[dict[str, Any]]:
    if not raw:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None
    return None


def tasks_to_graph(workflow: dict[str, Any], tasks: list[dict[str, Any]]) -> dict[str, Any]:
    graph = empty_graph(workflow.get("trigger_type", "manual"))
    nodes = graph["nodes"]
    edges = graph["edges"]
    ordered = sorted(tasks, key=lambda t: (t.get("step_order") or 0, t.get("created_at") or ""))
    prev_id = TRIGGER_NODE_ID
    x = 260

    for index, task in enumerate(ordered):
        node_id = f"http-{task['id']}"
        payload = task.get("payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                payload = {}

        node_data = {
            "label": f"Step {index + 1}",
            "url": task.get("url", ""),
            "payload": payload if isinstance(payload, dict) else {},
            "execution_type": task.get("execution_type", "queue"),
            "task_id": str(task["id"]),
        }
        if isinstance(task.get("payload_template"), str) and task.get("payload_template"):
            node_data["payload_template"] = task["payload_template"]
        if isinstance(task.get("url_template"), str) and task.get("url_template"):
            node_data["url_template"] = task["url_template"]

        nodes.append({
            "id": node_id,
            "type": NODE_HTTP,
            "position": {"x": x, "y": 160},
            "data": node_data,
        })
        edges.append({
            "id": f"edge-{prev_id}-{node_id}",
            "source": prev_id,
            "target": node_id,
        })
        prev_id = node_id
        x += 240

    return graph


def resolve_graph(workflow: dict[str, Any], tasks: list[dict[str, Any]]) -> dict[str, Any]:
    stored = parse_graph_field(workflow.get("graph"))
    if stored and stored.get("nodes"):
        return stored
    if tasks:
        return tasks_to_graph(workflow, tasks)
    return empty_graph(workflow.get("trigger_type", "manual"))


def _node_map(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {node["id"]: node for node in graph.get("nodes", []) if node.get("id")}


def _outgoing_edges(graph: dict[str, Any]) -> dict[str, list[str]]:
    outgoing: dict[str, list[str]] = {}
    for edge in graph.get("edges", []):
        source = edge.get("source")
        target = edge.get("target")
        if not source or not target:
            continue
        outgoing.setdefault(source, []).append(target)
    return outgoing


def linear_order_from_trigger(graph: dict[str, Any]) -> list[str]:
    nodes = _node_map(graph)
    outgoing = _outgoing_edges(graph)

    if TRIGGER_NODE_ID not in nodes:
        raise HTTPException(status_code=400, detail="Graph must include a trigger node")

    trigger = nodes[TRIGGER_NODE_ID]
    if trigger.get("type") != NODE_TRIGGER:
        raise HTTPException(status_code=400, detail="Trigger node has invalid type")

    order: list[str] = []
    current = TRIGGER_NODE_ID
    visited = {TRIGGER_NODE_ID}

    while True:
        next_targets = outgoing.get(current, [])
        if not next_targets:
            break
        if len(next_targets) > 1:
            raise HTTPException(status_code=400, detail="Phase A supports a single linear path only")
        nxt = next_targets[0]
        if nxt in visited:
            raise HTTPException(status_code=400, detail="Graph cannot contain cycles")
        node = nodes.get(nxt)
        if not node:
            raise HTTPException(status_code=400, detail=f"Unknown node '{nxt}'")
        if node.get("type") != NODE_HTTP:
            raise HTTPException(status_code=400, detail="Only HTTP steps can follow the trigger in phase A")
        order.append(nxt)
        visited.add(nxt)
        current = nxt
        if outgoing.get(current):
            if len(outgoing[current]) > 1:
                raise HTTPException(status_code=400, detail="Phase A supports a single linear path only")

    for node_id, node in nodes.items():
        if node_id == TRIGGER_NODE_ID:
            continue
        if node_id not in visited:
            raise HTTPException(status_code=400, detail="All nodes must be connected to the trigger")

    return order


def validate_graph(graph: dict[str, Any]) -> None:
    if not graph.get("nodes"):
        raise HTTPException(status_code=400, detail="Graph must include nodes")
    linear_order_from_trigger(graph)


async def sync_graph_to_tasks(
    db,
    queue,
    workflow_id: str,
    user_id: str,
    graph: dict[str, Any],
) -> dict[str, Any]:
    validate_graph(graph)
    nodes = _node_map(graph)
    http_order = linear_order_from_trigger(graph)
    task_model = TaskModel(db)
    existing_tasks = await task_model.list_by_workflow_id(workflow_id)
    existing_by_id = {str(t["id"]): t for t in existing_tasks}
    referenced_task_ids: set[str] = set()

    for step_order, node_id in enumerate(http_order):
        node = nodes[node_id]
        data = node.get("data") or {}
        url = (data.get("url") or "").strip()
        url_template = data.get("url_template")
        if not url and not url_template:
            raise HTTPException(status_code=400, detail=f"HTTP step '{node_id}' needs url or url_template")

        payload = data.get("payload") or {}
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail=f"HTTP step '{node_id}' payload must be an object")

        task_id = data.get("task_id")
        task_data = {
            "type": "task",
            "payload": json.dumps(payload),
            "url": url,
            "status": "pending",
            "retries": 0,
            "max_retries": 5,
            "scheduled_at": datetime.now(timezone.utc).isoformat(),
            "execution_type": data.get("execution_type") or "queue",
            "user_id": user_id,
            "workflow_id": workflow_id,
            "step_order": step_order,
        }
        apply_task_templates(task_data, data.get("payload_template"), data.get("url_template"))

        if task_id and str(task_id) in existing_by_id:
            tid = str(task_id)
            referenced_task_ids.add(tid)
            update_fields = {
                "url": task_data["url"],
                "payload": task_data["payload"],
                "execution_type": task_data["execution_type"],
                "step_order": step_order,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            if task_data.get("payload_template"):
                update_fields["payload_template"] = task_data["payload_template"]
            if task_data.get("url_template"):
                update_fields["url_template"] = task_data["url_template"]
            await task_model.update("tasks", "id = ?", update_fields, tid)
            node.setdefault("data", {})["task_id"] = tid
        else:
            tid = await task_model.create(task_data)
            referenced_task_ids.add(tid)
            node.setdefault("data", {})["task_id"] = tid

    for task in existing_tasks:
        tid = str(task["id"])
        if tid not in referenced_task_ids:
            await task_model.delete("tasks", "id = ?", tid)

    return graph


async def save_workflow_graph(
    env,
    user_id: str,
    workflow_id: str,
    graph: dict[str, Any],
) -> dict[str, Any]:
    workflow_model = WorkflowModel(env.DB)
    workflow = await workflow_model.find_by_id(workflow_id)
    if not workflow or workflow.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Workflow not found")

    synced = await sync_graph_to_tasks(env.DB, env.TASK_QUEUE, workflow_id, user_id, graph)
    now = datetime.now(timezone.utc).isoformat()

    trigger_node = _node_map(synced).get(TRIGGER_NODE_ID) or {}
    trigger_type = (trigger_node.get("data") or {}).get("triggerType") or workflow.get("trigger_type", "manual")
    trigger_config_raw = workflow.get("trigger_config") or "{}"
    if trigger_type == "schedule":
        node_cron = (trigger_node.get("data") or {}).get("cron")
        config = parse_trigger_config(workflow)
        if node_cron:
            config["cron"] = str(node_cron).strip()
        trigger_config_raw = normalize_trigger_config(trigger_type, json.dumps(config))

    await workflow_model.update(
        "workflows",
        "id = ?",
        {
            "graph": json.dumps(synced),
            "trigger_type": trigger_type,
            "trigger_config": trigger_config_raw if isinstance(trigger_config_raw, str) else json.dumps(trigger_config_raw),
            "updated_at": now,
        },
        workflow_id,
    )
    return synced
