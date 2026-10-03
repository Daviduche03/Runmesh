"""Agent-native triggers (phase 1: schedule + api).

A trigger is bound to an agent. When it fires, Runmesh opens an agent run
carrying ``trigger_id`` and delivers a **signed callback** to the agent's
endpoint — the caller's app runs the agent, because Runmesh does not. Delivery
reuses the shared signed-webhook path. A dispatch that cannot reach the agent is
recorded as a ``system_error`` on the run, never a silent pending.
"""

import json
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from db.orm import Model
from services.collection import serialize_run
from services.connect_common import _audit
from services.workflow_trigger_config import (
    cron_matches,
    validate_cron_expression,
)
from utils.connect_crypto import decrypt_connect_secret, encrypt_connect_secret
from utils.responses import success
from utils.types import (
    ConnectAuditActorType,
    ConnectAuditEventType,
    ConnectResourceType,
)

TRIGGER_TYPES = ("event", "schedule", "api")
JSON_MAX = 8192
RUN_INPUT_MAX = 32768


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_json_dict(value) -> dict:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, json.JSONDecodeError):
        return {}


def serialize_trigger(row: dict) -> dict:
    return {
        "id": row["id"],
        "workspace_id": row.get("workspace_id"),
        "agent_id": row["agent_id"],
        "type": row.get("type") or "api",
        "name": row.get("name") or "",
        "enabled": bool(row.get("enabled")),
        "config": _parse_json_dict(row.get("config")),
        "last_fired_at": row.get("last_fired_at"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


async def _get_workspace_trigger(model: Model, workspace_id: str, trigger_id: str) -> dict:
    row = await model.find_one(
        "triggers", "id = ? AND workspace_id = ?", trigger_id, workspace_id
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Trigger not found")
    return row


def _validate_config(trigger_type: str, config: dict) -> None:
    if trigger_type != "schedule":
        return
    cron = str(config.get("cron") or "").strip()
    at = str(config.get("at") or "").strip()
    if not cron and not at:
        raise HTTPException(status_code=400, detail="schedule triggers need config.cron or config.at")
    if cron and not validate_cron_expression(cron):
        raise HTTPException(status_code=400, detail="invalid cron expression")


async def create_trigger(db, user_id, workspace_id, *, agent_id, trigger_type, name,
                         config=None, endpoint=None, endpoint_secret=None, env=None) -> dict:
    trigger_type = (trigger_type or "api").strip().lower()
    if trigger_type not in TRIGGER_TYPES:
        raise HTTPException(status_code=400, detail=f"type must be one of: {', '.join(TRIGGER_TYPES)}")
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    model = Model(db)
    agent = await model.find_one("agents", "id = ? AND workspace_id = ?", agent_id, workspace_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    config = config or {}
    _validate_config(trigger_type, config)
    if endpoint:
        secret_enc = encrypt_connect_secret(endpoint_secret or "", _jwt_secret(env, model), ) if endpoint_secret else None
        await _apply_endpoint(model, agent_id, endpoint, secret_enc)
    now = _now()
    trigger_id = f"trg_{uuid.uuid4().hex[:12]}"
    await model.insert("triggers", {
        "id": trigger_id,
        "workspace_id": workspace_id,
        "agent_id": agent_id,
        "type": trigger_type,
        "name": name,
        "enabled": 1,
        "config": json.dumps(config, default=str),
        "last_fired_at": None,
        "created_at": now,
        "updated_at": now,
    })
    row = await _get_workspace_trigger(model, workspace_id, trigger_id)
    return success(serialize_trigger(row), message="Trigger created")


async def list_triggers(db, user_id, workspace_id, *, agent_id=None) -> dict:
    model = Model(db)
    if agent_id:
        rows = await model.find_many(
            "triggers", "workspace_id = ? AND agent_id = ? ORDER BY created_at DESC",
            workspace_id, agent_id,
        )
    else:
        rows = await model.find_many(
            "triggers", "workspace_id = ? ORDER BY created_at DESC", workspace_id
        )
    return success([serialize_trigger(row) for row in rows], meta={"total": len(rows)})


async def get_trigger(db, user_id, workspace_id, trigger_id) -> dict:
    model = Model(db)
    row = await _get_workspace_trigger(model, workspace_id, trigger_id)
    return success(serialize_trigger(row))


async def update_trigger(db, user_id, workspace_id, trigger_id, *, name=None, config=None,
                         enabled=None, endpoint=None, endpoint_secret=None, env=None) -> dict:
    model = Model(db)
    row = await _get_workspace_trigger(model, workspace_id, trigger_id)
    updates: dict = {"updated_at": _now()}
    if name is not None:
        updates["name"] = name.strip()
    if config is not None:
        _validate_config(row.get("type"), config)
        updates["config"] = json.dumps(config, default=str)
    if enabled is not None:
        updates["enabled"] = 1 if enabled else 0
    if endpoint is not None:
        secret_enc = encrypt_connect_secret(endpoint_secret, _jwt_secret(env, model)) if endpoint_secret else None
        await _apply_endpoint(model, row["agent_id"], endpoint, secret_enc)
    await model.update("triggers", "id = ?", updates, trigger_id)
    updated = await _get_workspace_trigger(model, workspace_id, trigger_id)
    return success(serialize_trigger(updated), message="Trigger updated")


async def delete_trigger(db, user_id, workspace_id, trigger_id) -> dict:
    model = Model(db)
    await _get_workspace_trigger(model, workspace_id, trigger_id)
    await model.delete("triggers", "id = ?", trigger_id)
    return success({"id": trigger_id}, message="Trigger deleted")


async def list_trigger_runs(db, user_id, workspace_id, trigger_id, limit=50) -> dict:
    model = Model(db)
    await _get_workspace_trigger(model, workspace_id, trigger_id)
    rows = await model.find_many(
        "agent_runs", "trigger_id = ? AND workspace_id = ? ORDER BY created_at DESC",
        trigger_id, workspace_id, limit=min(max(limit, 1), 100),
    )
    return success([serialize_run(row, 0) for row in rows], meta={"total": len(rows)})


async def fire_trigger(db, user_id, workspace_id, trigger_id, input_payload, *, fetch_fn=None, env=None) -> dict:
    model = Model(db)
    row = await _get_workspace_trigger(model, workspace_id, trigger_id)
    if not row.get("enabled"):
        raise HTTPException(status_code=400, detail="Trigger is not active")
    return await _dispatch(env, model, workspace_id, row, input_payload, origin=row.get("type"), fetch_fn=fetch_fn)


async def run_due_schedule_triggers(env) -> int:
    """Cron entry: fire every enabled schedule trigger whose cron matches now."""
    from db.orm import Model as _Model

    model = _Model(env.DB)
    now = datetime.now(timezone.utc)
    rows = await model.find_many(
        "triggers", "type = 'schedule' AND enabled = 1", limit=500
    )
    fired = 0
    for row in rows:
        cron = str(_parse_json_dict(row.get("config")).get("cron") or "").strip()
        if cron and cron_matches(cron, now):
            await _dispatch(env, model, row["workspace_id"], row, {}, origin="schedule")
            fired += 1
    return fired


async def _dispatch(env, model: Model, workspace_id, trigger, input_payload, *, origin, connect_user_id=None, fetch_fn=None) -> dict:
    agent = await model.find_one(
        "agents", "id = ? AND workspace_id = ?", trigger["agent_id"], workspace_id
    )
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    now = _now()
    run_id = f"run_{uuid.uuid4().hex[:12]}"
    thread_id = f"th_{uuid.uuid4().hex[:12]}"
    run_input = json.dumps(input_payload, default=str)[:RUN_INPUT_MAX] if input_payload is not None else None
    await model.insert("agent_runs", {
        "id": run_id,
        "workspace_id": workspace_id,
        "agent_id": agent["id"],
        "agent_version_id": agent.get("current_version_id"),
        "parent_run_id": None,
        "thread_id": thread_id,
        "connect_user_id": connect_user_id,
        "mode": "live",
        "trigger_id": trigger["id"],
        "status": "running",
        "input": run_input,
        "usage": "{}",
        "started_at": now,
        "finished_at": None,
        "created_at": now,
        "updated_at": now,
    })
    from db.connect_orm import ConnectAuditEventModel
    await _audit(
        ConnectAuditEventModel(model.db),
        event_type=ConnectAuditEventType.RUN_STARTED,
        actor_type=ConnectAuditActorType.SYSTEM,
        actor_id=f"trigger:{trigger['id']}",
        connect_user_id=connect_user_id,
        agent_id=agent["id"],
        resource_type=ConnectResourceType.AGENT_RUN,
        resource_id=run_id,
        result="success",
        workspace_id=workspace_id,
        metadata={"trigger_id": trigger["id"], "trigger_type": trigger["type"], "origin": origin},
    )
    await model.update("triggers", "id = ?", {"last_fired_at": now, "updated_at": now}, trigger["id"])

    endpoint = agent.get("endpoint_url")
    if not endpoint:
        await _fail(model, workspace_id, run_id, "No endpoint registered for this agent.")
    else:
        secret = decrypt_connect_secret(agent.get("endpoint_secret_enc"), _jwt_secret(env, model)) or ""
        if fetch_fn is None:
            from runtime.http_fetch import fetch as fetch_fn  # type: ignore
        from services.webhooks import signed_dispatch
        ok, status, detail = await signed_dispatch(
            fetch_fn,
            endpoint,
            secret,
            f"agent.run.{trigger['type']}",
            {
                "run_id": run_id,
                "trigger_id": trigger["id"],
                "trigger_type": trigger["type"],
                "agent_id": agent["id"],
                "input": input_payload,
                "connect_user_id": connect_user_id,
            },
            1,
        )
        if not ok:
            await _fail(model, workspace_id, run_id, f"Delivery failed: {status or ''} {detail or ''}".strip())

    row = await model.find_one("agent_runs", "id = ?", run_id)
    return success(serialize_run(row, 0), message="Trigger fired")


async def _fail(model: Model, workspace_id: str, run_id: str, message: str) -> None:
    existing = await model.find_many("agent_events", "run_id = ?", run_id)
    seq = max([r.get("seq") or 0 for r in existing], default=0) + 1
    await model.insert("agent_events", {
        "id": f"evt_{uuid.uuid4().hex[:12]}",
        "workspace_id": workspace_id,
        "run_id": run_id,
        "seq": seq,
        "kind": "error",
        "name": "system_error",
        "args": "{}",
        "result": json.dumps({"message": message}, default=str)[:JSON_MAX],
        "truncated": 0,
        "duration_ms": None,
        "created_at": _now(),
        "connect_user_id": None,
    })
    now = _now()
    await model.update("agent_runs", "id = ?", {"status": "failed", "finished_at": now, "updated_at": now}, run_id)


def _jwt_secret(env, model: Model) -> str:
    return str(getattr(env, "JWT_SECRET", "") or "")


async def _apply_endpoint(model: Model, agent_id: str, endpoint: str, secret_enc: str | None) -> None:
    values: dict = {"endpoint_url": (endpoint or "").strip() or None}
    if secret_enc is not None:
        values["endpoint_secret_enc"] = secret_enc
    await model.update("agents", "id = ?", values, agent_id)
