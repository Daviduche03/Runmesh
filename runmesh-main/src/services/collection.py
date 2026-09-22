"""Agent telemetry collection (phase 1): resolve, runs, ingest.

Agents are registered by observation: the wrapper reports a definition
(external key and/or fingerprint plus framework, model, prompt, tools) and
this module resolves it to a canonical agent, opening a new version when the
fingerprint changes. Runs and events record executions. Nothing here
enforces; enforcement lands with the execution layer.

Safety is load-bearing from day one: payloads are size-capped, secret-shaped
values are redacted before storage, and batches are bounded.
"""

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from db.orm import Model
from utils.responses import success
from services.workspaces import resolve_workspace_id
from services.connect_common import _audit
from utils.types import (
    ConnectAuditActorType,
    ConnectAuditEventType,
    ConnectResourceType,
)

EXTERNAL_KEY_MAX = 128
FINGERPRINT_MAX = 128
FRAMEWORK_MAX = 64
MODEL_MAX = 128
SYSTEM_PROMPT_MAX = 65536
TOOLS_MAX = 200
RUN_INPUT_MAX = 32768
INGEST_BATCH_MAX = 200
JSON_FIELD_MAX = 8192
THREAD_ID_MAX = 64
CONNECT_USER_ID_MAX = 128

EVENT_KINDS = (
    "tool.call",
    "tool.result",
    "model.request",
    "model.response",
    "policy.decision",
    "error",
    "log",
)
RUN_STATUSES = ("running", "completed", "failed")

SECRET_KEY_PATTERN = re.compile(
    r"(api[_-]?key|secret|token|password|passwd|authorization|bearer|private[_-]?key|client[_-]?secret)",
    re.IGNORECASE,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_json_dict(value, field: str) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _parse_json_list(value) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return []
    return parsed if isinstance(parsed, list) else []


def _redact(value, depth: int = 0):
    """Replace secret-shaped string values before storage. Depth-capped;
    anything deeper is dropped rather than stored raw."""
    if depth > 5:
        return "[TRUNCATED]"
    if isinstance(value, dict):
        return {
            key: "[REDACTED]"
            if isinstance(val, str) and SECRET_KEY_PATTERN.search(str(key))
            else _redact(val, depth + 1)
            for key, val in value.items()
        }
    if isinstance(value, list):
        return [_redact(item, depth + 1) for item in value]
    return value


def _capped_json(value, field: str) -> tuple[str, bool]:
    raw = json.dumps(value or {}, default=str)
    if len(raw) > JSON_FIELD_MAX:
        return raw[:JSON_FIELD_MAX], True
    return raw, False


def serialize_collected_agent(row: dict) -> dict:
    return {
        "id": row["id"],
        "workspace_id": row.get("workspace_id"),
        "name": row.get("name") or "",
        "framework": row.get("framework"),
        "external_key": row.get("external_key"),
        "fingerprint": row.get("fingerprint"),
        "model": row.get("model"),
        "version": row.get("version") or 1,
        "status": row.get("status") or "active",
        "parent_agent_id": row.get("parent_agent_id"),
        "last_seen_at": row.get("last_seen_at"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


TOOL_KINDS = ("local", "managed")
TOOL_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE")
TOOL_AUTH_SCHEMES = ("none", "bearer", "api_key", "basic")
TOOL_NAME_MAX = 64
TOOL_URL_MAX = 2048


def _tool_ref(workspace_id: str, name: str) -> str:
    digest = hashlib.sha256(f"{workspace_id}:{name}".encode()).hexdigest()
    return f"tool_{digest[:12]}"


def _safe_base_url(value: str | None) -> str | None:
    """Only https, or http on localhost. The base host is what the forward
    path is resolved against, so it must not be attacker-influenced."""
    raw = (value or "").strip().rstrip("/")
    if not raw:
        return None
    from urllib.parse import urlparse

    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    host = (parsed.hostname or "").lower()
    if parsed.scheme == "http" and host not in ("localhost", "127.0.0.1", "::1"):
        return None
    return raw


def _normalize_tool(entry: dict) -> tuple[dict | None, dict | None]:
    """Classify a declared tool, returning ``(tool, warning)``.

    A managed declaration that is missing its provider or its endpoint is
    demoted to local — but never silently: the warning travels back to the
    wrapper so the failure names the tool and the missing field.
    """
    if not isinstance(entry, dict):
        return None, {"tool": "", "code": "invalid_entry", "message": "Tool entry is not an object."}
    name = str(entry.get("name") or "").strip()
    if not name or len(name) > TOOL_NAME_MAX:
        return None, {
            "tool": name,
            "code": "invalid_name",
            "message": f"Tool name must be 1-{TOOL_NAME_MAX} characters.",
        }
    declared_kind = str(entry.get("kind") or "local").strip().lower()
    if declared_kind not in TOOL_KINDS:
        declared_kind = "local"
    kind = declared_kind
    provider = str(entry.get("provider") or "").strip().lower() or None
    url = str(entry.get("url") or "").strip()[:TOOL_URL_MAX] or None
    base_url = _safe_base_url(entry.get("baseUrl") or entry.get("base_url"))
    if base_url is None and url:
        from urllib.parse import urlparse

        parsed = urlparse(url)
        if parsed.scheme and parsed.netloc:
            base_url = _safe_base_url(f"{parsed.scheme}://{parsed.netloc}")
    warning = None
    if declared_kind == "managed" and (provider is None or (url is None and base_url is None)):
        missing = []
        if provider is None:
            missing.append("provider")
        if url is None and base_url is None:
            missing.append("url or baseUrl")
        kind = "local"
        warning = {
            "tool": name,
            "code": "managed_missing_config",
            "message": f"Declared managed but missing {' and '.join(missing)}; treated as local.",
        }
    method = str(entry.get("method") or "POST").strip().upper()
    if method not in TOOL_METHODS:
        method = "POST"
    auth_scheme = str(
        entry.get("authScheme") or entry.get("auth_scheme") or ("bearer" if provider else "none")
    ).strip().lower()
    if auth_scheme not in TOOL_AUTH_SCHEMES:
        auth_scheme = "none"
    return {
        "name": name,
        "kind": kind,
        "provider": provider,
        "action": str(entry.get("action") or "").strip() or (f"{provider}.{name}" if provider else name),
        "method": method,
        "url": url,
        "base_url": base_url,
        "auth_scheme": auth_scheme,
        "auth_header": str(entry.get("authHeader") or entry.get("auth_header") or "Authorization")[:128],
        "auth_format": str(entry.get("authFormat") or entry.get("auth_format") or "Bearer {token}")[:256],
        "resource_param": str(entry.get("resourceParam") or entry.get("resource_param") or "").strip() or None,
        "schema_hash": str(entry.get("schemaHash") or entry.get("schema_hash") or "").strip()[:128],
    }, warning


async def _register_tools(model: Model, workspace_id: str, agent_id: str, tools: list) -> tuple[list, list]:
    """Upsert the tool registry. Returns ``(registered, warnings)``."""
    now = _now()
    registered = []
    warnings = []
    for entry in tools:
        tool, warning = _normalize_tool(entry)
        if warning is not None:
            warnings.append(warning)
        if tool is None:
            continue
        ref = _tool_ref(workspace_id, tool["name"])
        existing = await model.find_one("tools", "id = ? AND workspace_id = ?", ref, workspace_id)
        values = {
            "workspace_id": workspace_id,
            "agent_id": agent_id,
            "name": tool["name"],
            "kind": tool["kind"],
            "provider": tool["provider"],
            "action": tool["action"],
            "method": tool["method"],
            "url": tool["url"],
            "base_url": tool["base_url"],
            "auth_scheme": tool["auth_scheme"],
            "auth_header": tool["auth_header"],
            "auth_format": tool["auth_format"],
            "resource_param": tool["resource_param"],
            "schema_hash": tool["schema_hash"],
            "updated_at": now,
        }
        if existing is None:
            await model.insert("tools", {"id": ref, "created_at": now, **values})
        else:
            await model.update("tools", "id = ?", values, ref)
        registered.append({
            "name": tool["name"],
            "ref": ref,
            "kind": tool["kind"],
            "provider": tool["provider"],
            "action": tool["action"],
            "base_url": tool["base_url"],
        })
    return registered, warnings


async def resolve_agent(db, user_id: str, workspace_id: str, req) -> dict:
    external_key = (req.external_key or "").strip() or None
    if external_key is not None and len(external_key) > EXTERNAL_KEY_MAX:
        raise HTTPException(status_code=400, detail="external_key is too long (max 128 characters)")
    fingerprint = (req.fingerprint or "").strip() or None
    if fingerprint is not None and len(fingerprint) > FINGERPRINT_MAX:
        raise HTTPException(status_code=400, detail="fingerprint is too long (max 128 characters)")
    if external_key is None and fingerprint is None:
        raise HTTPException(status_code=400, detail="external_key or fingerprint is required")

    framework = (req.framework or "").strip() or None
    if framework is not None and len(framework) > FRAMEWORK_MAX:
        raise HTTPException(status_code=400, detail="framework is too long (max 64 characters)")
    model_name = (req.model or "").strip() or None
    if model_name is not None and len(model_name) > MODEL_MAX:
        raise HTTPException(status_code=400, detail="model is too long (max 128 characters)")
    system_prompt = req.system_prompt or None
    if system_prompt is not None and len(system_prompt) > SYSTEM_PROMPT_MAX:
        raise HTTPException(status_code=400, detail="system_prompt is too long (max 65536 characters)")
    tools = req.tools if isinstance(req.tools, list) else []
    if len(tools) > TOOLS_MAX:
        raise HTTPException(status_code=400, detail="tools is too long (max 200 entries)")
    name = (req.name or "").strip() or "Untitled agent"
    if len(name) > 64:
        raise HTTPException(status_code=400, detail="name is too long (max 64 characters)")

    model = Model(db)
    workspace_id = await resolve_workspace_id(model.db, user_id, workspace_id)

    row = None
    if external_key is not None:
        row = await model.find_one(
            "agents", "external_key = ? AND workspace_id = ?", external_key, workspace_id
        )
    if row is None and fingerprint is not None:
        row = await model.find_one(
            "agents", "fingerprint = ? AND workspace_id = ?", fingerprint, workspace_id
        )

    now = _now()
    if row is None:
        agent_id = f"ag_{uuid.uuid4().hex[:12]}"
        await model.insert(
            "agents",
            {
                "id": agent_id,
                "workspace_id": workspace_id,
                "user_id": user_id,
                "name": name,
                "status": "active",
                "framework": framework,
                "external_key": external_key,
                "fingerprint": fingerprint,
                "model": model_name,
                "system_prompt": system_prompt,
                "tools": json.dumps(tools),
                "version": 1,
                "last_seen_at": now,
                "created_at": now,
                "updated_at": now,
            },
        )
        created = await model.find_one("agents", "id = ?", agent_id)
        data = serialize_collected_agent(created)
        data["is_new"] = True
        data["is_new_version"] = False
        data["tools"], warnings = await _register_tools(model, workspace_id, agent_id, tools)
        data["tool_warnings"] = warnings
        return success(data, message="Agent registered")

    is_new_version = fingerprint is not None and row.get("fingerprint") != fingerprint
    updates: dict = {"last_seen_at": now, "updated_at": now}
    if is_new_version:
        updates["version"] = (row.get("version") or 1) + 1
        updates["fingerprint"] = fingerprint
        updates["framework"] = framework
        updates["model"] = model_name
        updates["system_prompt"] = system_prompt
        updates["tools"] = json.dumps(tools)
    await model.update("agents", "id = ?", updates, row["id"])
    updated = await model.find_one("agents", "id = ?", row["id"])
    data = serialize_collected_agent(updated)
    data["is_new"] = False
    data["is_new_version"] = is_new_version
    data["tools"], warnings = await _register_tools(model, workspace_id, row["id"], tools)
    data["tool_warnings"] = warnings
    return success(data, message="Agent resolved")


def serialize_run(row: dict, event_count: int = 0) -> dict:
    return {
        "id": row["id"],
        "agent_id": row["agent_id"],
        "parent_run_id": row.get("parent_run_id"),
        "thread_id": row.get("thread_id"),
        "connect_user_id": row.get("connect_user_id"),
        "status": row.get("status") or "running",
        "event_count": event_count,
        "started_at": row.get("started_at"),
        "finished_at": row.get("finished_at"),
        "created_at": row.get("created_at"),
    }


def serialize_event(row: dict) -> dict:
    return {
        "id": row["id"],
        "kind": row.get("kind") or "log",
        "name": row.get("name") or "",
        "args": _parse_json_dict(row.get("args"), "args"),
        "result": _parse_json_dict(row.get("result"), "result"),
        "truncated": bool(row.get("truncated")),
        "duration_ms": row.get("duration_ms"),
        "seq": row.get("seq") or 0,
        "created_at": row.get("created_at"),
    }


async def list_agent_runs(db, user_id: str, workspace_id: str, agent_id: str, limit: int = 50) -> dict:
    model = Model(db)
    workspace_id = await resolve_workspace_id(model.db, user_id, workspace_id)
    agent = await model.find_one(
        "agents", "id = ? AND workspace_id = ?", agent_id, workspace_id
    )
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    rows = await model.find_many(
        "agent_runs", "agent_id = ? AND workspace_id = ? ORDER BY created_at DESC",
        agent_id, workspace_id, limit=min(max(limit, 1), 100),
    )
    counts = {}
    if rows:
        placeholders = ", ".join("?" for _ in rows)
        count_rows = await model.find_many(
            "agent_events",
            f"run_id IN ({placeholders})",
            *[r["id"] for r in rows],
        )
        for event in count_rows:
            counts[event["run_id"]] = counts.get(event["run_id"], 0) + 1
    runs = [serialize_run(row, counts.get(row["id"], 0)) for row in rows]
    return success(runs, meta={"total": len(runs)})


async def get_run(db, user_id: str, workspace_id: str, run_id: str) -> dict:
    model = Model(db)
    workspace_id = await resolve_workspace_id(model.db, user_id, workspace_id)
    row = await _get_workspace_run(model, workspace_id, run_id)
    events = await model.find_many(
        "agent_events", "run_id = ? ORDER BY seq ASC", run_id
    )
    data = serialize_run(row, len(events))
    data["usage"] = _parse_json_dict(row.get("usage"), "usage")
    data["input"] = row.get("input")
    data["events"] = [serialize_event(event) for event in events]
    child_rows = await model.find_many(
        "agent_runs", "parent_run_id = ? AND workspace_id = ? ORDER BY created_at ASC",
        run_id, workspace_id,
    )
    children = []
    for child in child_rows:
        agent_name = None
        agent_row = await model.find_one("agents", "id = ?", child["agent_id"])
        if agent_row is not None:
            agent_name = agent_row.get("name") or child["agent_id"]
        children.append({
            "id": child["id"],
            "agent_id": child["agent_id"],
            "agent_name": agent_name,
            "status": child.get("status") or "running",
            "started_at": child.get("started_at"),
        })
    data["child_runs"] = children
    return success(data)


async def _get_workspace_run(model: Model, workspace_id: str, run_id: str) -> dict:
    row = await model.find_one(
        "agent_runs", "id = ? AND workspace_id = ?", run_id, workspace_id
    )
    if row is None:
        # 404 either way: never confirm whether an id exists elsewhere.
        raise HTTPException(status_code=404, detail="Run not found")
    return row


async def start_run(db, user_id: str, workspace_id: str, req) -> dict:
    agent_id = (req.agent_id or "").strip()
    if not agent_id:
        raise HTTPException(status_code=400, detail="agent_id is required")
    model = Model(db)
    workspace_id = await resolve_workspace_id(model.db, user_id, workspace_id)
    agent = await model.find_one(
        "agents", "id = ? AND workspace_id = ?", agent_id, workspace_id
    )
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    parent_run_id = (req.parent_run_id or "").strip() or None
    parent = None
    if parent_run_id is not None:
        parent = await _get_workspace_run(model, workspace_id, parent_run_id)

    thread_id = (getattr(req, "thread_id", None) or "").strip() or None
    if thread_id is not None and len(thread_id) > THREAD_ID_MAX:
        raise HTTPException(status_code=400, detail="thread_id is too long (max 64 characters)")
    if thread_id is None and parent is not None:
        thread_id = parent.get("thread_id")
    if thread_id is None:
        thread_id = f"th_{uuid.uuid4().hex[:12]}"

    run_connect_user_id = (getattr(req, "connect_user_id", None) or "").strip() or None
    if run_connect_user_id is not None and len(run_connect_user_id) > CONNECT_USER_ID_MAX:
        raise HTTPException(status_code=400, detail="connect_user_id is too long (max 128 characters)")
    if run_connect_user_id is not None:
        principal = await model.find_one("connect_users", "id = ?", run_connect_user_id)
        if principal is None:
            raise HTTPException(status_code=404, detail="Connect user not found")

    run_input = req.input or None
    if run_input is not None and len(run_input) > RUN_INPUT_MAX:
        raise HTTPException(status_code=400, detail="input is too long (max 32768 characters)")

    now = _now()
    run_id = f"run_{uuid.uuid4().hex[:12]}"
    await model.insert(
        "agent_runs",
        {
            "id": run_id,
            "workspace_id": workspace_id,
            "agent_id": agent_id,
            "parent_run_id": parent_run_id,
            "thread_id": thread_id,
            "connect_user_id": run_connect_user_id,
            "status": "running",
            "input": run_input,
            "usage": "{}",
            "started_at": now,
            "finished_at": None,
            "created_at": now,
            "updated_at": now,
        },
    )
    row = await model.find_one("agent_runs", "id = ?", run_id)
    await model.update(
        "agents", "id = ?", {"last_seen_at": now, "updated_at": now}, agent_id
    )
    from db.connect_orm import ConnectAuditEventModel
    await _audit(
        ConnectAuditEventModel(model.db),
        event_type=ConnectAuditEventType.RUN_STARTED,
        actor_type=ConnectAuditActorType.CONNECT_USER,
        actor_id=user_id,
        connect_user_id=run_connect_user_id,
        agent_id=agent_id,
        resource_type=ConnectResourceType.AGENT_RUN,
        resource_id=run_id,
        result="success",
        workspace_id=workspace_id,
        metadata={"input_present": run_input is not None},
    )
    return success({
        "id": row["id"],
        "agent_id": row["agent_id"],
        "parent_run_id": row.get("parent_run_id"),
        "thread_id": row.get("thread_id"),
        "connect_user_id": row.get("connect_user_id"),
        "status": row["status"],
        "started_at": row["started_at"],
    }, message="Run started")


async def finish_run(db, user_id: str, workspace_id: str, run_id: str, req) -> dict:
    status = (req.status or "completed").strip()
    if status not in ("completed", "failed"):
        raise HTTPException(status_code=400, detail="status must be completed or failed")
    model = Model(db)
    workspace_id = await resolve_workspace_id(model.db, user_id, workspace_id)
    row = await _get_workspace_run(model, workspace_id, run_id)
    if row.get("finished_at") is not None and row.get("status") != status:
        raise HTTPException(status_code=409, detail="Run already finished with a different status")
    now = _now()
    await model.update(
        "agent_runs",
        "id = ?",
        {
            "status": status,
            "usage": json.dumps(req.usage or {}),
            "finished_at": row.get("finished_at") or now,
            "updated_at": now,
        },
        run_id,
    )
    updated = await model.find_one("agent_runs", "id = ?", run_id)
    from db.connect_orm import ConnectAuditEventModel
    await _audit(
        ConnectAuditEventModel(model.db),
        event_type=ConnectAuditEventType.RUN_FINISHED,
        actor_type=ConnectAuditActorType.CONNECT_USER,
        actor_id=user_id,
        connect_user_id=updated.get("connect_user_id"),
        agent_id=updated.get("agent_id"),
        resource_type=ConnectResourceType.AGENT_RUN,
        resource_id=run_id,
        result="success" if status == "completed" else "failed",
        workspace_id=workspace_id,
        metadata={"status": status},
    )
    return success({
        "id": updated["id"],
        "status": updated["status"],
        "finished_at": updated.get("finished_at"),
    }, message="Run finished")


async def ingest_events(db, user_id: str, workspace_id: str, req) -> dict:
    events = req.events or []
    if not events:
        raise HTTPException(status_code=400, detail="events must not be empty")
    if len(events) > INGEST_BATCH_MAX:
        raise HTTPException(status_code=400, detail="events batch is too long (max 200)")
    model = Model(db)
    workspace_id = await resolve_workspace_id(model.db, user_id, workspace_id)

    run_ids = {str(e.run_id or "").strip() for e in events}
    if any(not rid for rid in run_ids):
        raise HTTPException(status_code=400, detail="every event needs a run_id")
    for event in events:
        if event.kind not in EVENT_KINDS:
            raise HTTPException(
                status_code=400,
                detail=f"kind must be one of: {', '.join(EVENT_KINDS)}",
            )
        if event.duration_ms is not None and event.duration_ms < 0:
            raise HTTPException(status_code=400, detail="duration_ms must not be negative")

    runs: dict = {}
    for run_id in run_ids:
        runs[run_id] = await _get_workspace_run(model, workspace_id, run_id)

    now = _now()
    stored = 0
    for event in events:
        run_id = str(event.run_id).strip()
        prior = await model.find_many(
            "agent_events", "run_id = ? ORDER BY seq DESC", run_id, limit=1
        )
        seq = (prior[0]["seq"] + 1) if prior else 0
        args_raw, args_cut = _capped_json(_redact(event.args or {}), "args")
        result_raw, result_cut = _capped_json(_redact(event.result or {}), "result")
        await model.insert(
            "agent_events",
            {
                "id": f"evt_{uuid.uuid4().hex[:12]}",
                "workspace_id": workspace_id,
                "run_id": run_id,
                "seq": seq,
                "kind": event.kind,
                "name": (event.name or "")[:256],
                "args": args_raw,
                "result": result_raw,
                "truncated": 1 if (args_cut or result_cut) else 0,
                "duration_ms": event.duration_ms,
                "created_at": now,
            },
        )
        stored += 1
    for agent_id in {runs[run_id]["agent_id"] for run_id in run_ids}:
        await model.update(
            "agents", "id = ?",
            {"last_seen_at": now, "updated_at": now},
            agent_id,
        )
    return success({"ingested": stored}, message=f"Ingested {stored} events")
