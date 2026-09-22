"""First-class agents: identity + lifecycle.

An agent row is a principal, never an authority. Scopes, caps, approvals,
and expiries live in grants/policy/audit; this module only creates the
identity, lists it, and resolves it for other services.
"""

import hashlib
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from db.orm import Model
from utils.responses import success
from services.workspaces import resolve_workspace_id

AGENT_ENVIRONMENTS = ("dev", "staging", "prod")
AGENT_NAME_MAX = 64
AGENT_DESCRIPTION_MAX = 500
AGENT_PUBLIC_KEY_MAX = 4096


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def serialize_agent(row: dict) -> dict:
    """Public shape: identity + lifecycle. The public key itself is never
    returned — only its fingerprint, which is safe to log and display."""
    return {
        "id": row["id"],
        "workspace_id": row.get("workspace_id"),
        "name": row.get("name") or "",
        "description": row.get("description") or "",
        "status": row.get("status") or "active",
        "parent_agent_id": row.get("parent_agent_id"),
        "project_id": row.get("project_id"),
        "environment": row.get("environment"),
        "key_fingerprint": row.get("key_fingerprint"),
        "framework": row.get("framework"),
        "model": row.get("model"),
        "version": row.get("version") or 1,
        "last_seen_at": row.get("last_seen_at"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


async def create_agent(db, user_id: str, workspace_id: str, req) -> dict:
    name = (req.name or "").strip()
    if not name or len(name) > AGENT_NAME_MAX:
        raise HTTPException(status_code=400, detail="Agent name is required (1-64 characters)")

    description = (req.description or "").strip()
    if len(description) > AGENT_DESCRIPTION_MAX:
        raise HTTPException(status_code=400, detail="Description must be under 500 characters")

    # The DB CHECK would 500 on anything else — validate here for a 400.
    environment = (req.environment or "").strip().lower() or None
    if environment is not None and environment not in AGENT_ENVIRONMENTS:
        raise HTTPException(status_code=400, detail="Environment must be dev, staging, or prod")

    project_id = (req.project_id or "").strip() or None
    parent_id = (req.parent_agent_id or "").strip() or None

    model = Model(db)
    workspace_id = await resolve_workspace_id(model.db, user_id, workspace_id)

    if parent_id:
        parent = await model.find_one(
            "agents", "id = ? AND workspace_id = ?", parent_id, workspace_id
        )
        if parent is None:
            # 404 either way: never confirm whether an id exists elsewhere.
            raise HTTPException(status_code=404, detail="Parent agent not found")

    public_key = (req.public_key or "").strip() or None
    key_fingerprint = None
    if public_key is not None:
        if len(public_key) > AGENT_PUBLIC_KEY_MAX:
            raise HTTPException(status_code=400, detail="Public key is too long")
        # Local SHA-256 identifier (not an RFC 7638 JWK thumbprint — upgrade
        # when keys are parsed as JWK). Displayed as "key …abcd".
        key_fingerprint = hashlib.sha256(public_key.encode()).hexdigest()

    now = _now()
    agent_id = f"ag_{uuid.uuid4().hex[:12]}"
    await model.insert(
        "agents",
        {
            "id": agent_id,
            "workspace_id": workspace_id,
            "user_id": user_id,
            "name": name,
            "description": description,
            "status": "active",
            "parent_agent_id": parent_id,
            "project_id": project_id,
            "environment": environment,
            "public_key": public_key,
            "key_fingerprint": key_fingerprint,
            "created_at": now,
            "updated_at": now,
        },
    )
    row = await model.find_one("agents", "id = ?", agent_id)
    return success(serialize_agent(row), message="Agent created")


async def list_agents(db, user_id: str, workspace_id: str) -> dict:
    model = Model(db)
    workspace_id = await resolve_workspace_id(model.db, user_id, workspace_id)
    rows = await model.find_many(
        "agents", "workspace_id = ? ORDER BY created_at DESC", workspace_id
    )
    agents = [serialize_agent(row) for row in rows]
    return success(agents, meta={"total": len(agents)})
