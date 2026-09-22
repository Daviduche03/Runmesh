"""Workspace tenancy helpers.

Ownership model: rows carry a workspace_id; callers prove membership instead of
matching a user_id column. Rows without a workspace_id (pre-0024 data) fall
back to the legacy owner check so old behavior is preserved.
"""

import hashlib
import json
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, Request

from db.orm import Model
from utils.responses import success

ROLE_RANK = {"member": 1, "admin": 2, "owner": 3}

WORKSPACE_HEADER = "X-Workspace-ID"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def get_membership(db, user_id: str, workspace_id: str) -> Optional[dict]:
    if not workspace_id:
        return None
    return await Model(db).find_one(
        "workspace_members", "workspace_id = ? AND user_id = ?", workspace_id, user_id
    )


async def require_membership(db, user_id: str, workspace_id: Optional[str], min_role: str = "member") -> dict:
    """404 unless the workspace exists, is active, and the user is a member
    (at least min_role). 404 instead of 403 keeps workspace ids unguessable."""
    workspace = (
        await Model(db).find_one("workspaces", "id = ?", workspace_id) if workspace_id else None
    )
    if workspace is None or workspace.get("status") != "active":
        raise HTTPException(status_code=404, detail="Workspace not found")
    membership = await get_membership(db, user_id, workspace_id)
    if membership is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if ROLE_RANK.get(membership.get("role"), 0) < ROLE_RANK.get(min_role, 1):
        raise HTTPException(status_code=403, detail="Insufficient workspace role")
    return membership


async def ensure_personal_workspace(db, user_id: str) -> str:
    """Earliest membership wins; auto-provision a Personal workspace if none."""
    existing = await Model(db).find_one(
        "workspace_members", "user_id = ? ORDER BY created_at, workspace_id", user_id
    )
    if existing:
        return existing["workspace_id"]
    now = _now()
    model = Model(db)
    workspace_id = f"ws_{uuid.uuid4().hex}"
    await model.insert(
        "workspaces",
        {
            "id": workspace_id,
            "name": "Personal",
            "owner_user_id": user_id,
            "status": "active",
            "metadata": "{}",
            "created_at": now,
            "updated_at": now,
        },
    )
    await model.insert(
        "workspace_members",
        {
            "id": f"wsm_{uuid.uuid4().hex}",
            "workspace_id": workspace_id,
            "user_id": user_id,
            "role": "owner",
            "created_at": now,
            "updated_at": now,
        },
    )
    return workspace_id


async def default_workspace_id(db, user_id: str) -> str:
    return await ensure_personal_workspace(db, user_id)


async def resolve_workspace_id(db, user_id: str, requested_id: Optional[str] = None) -> str:
    requested = (requested_id or "").strip()
    if requested:
        await require_membership(db, user_id, requested)
        return requested
    return await ensure_personal_workspace(db, user_id)


async def resolve_request_workspace(request: Request, user: dict) -> str:
    """Workspace selector: explicit X-Workspace-ID header (or ?workspace_id=),
    else the API key's bound workspace, else the user's default.

    A key bound to a workspace cannot reach any other workspace.
    """
    env = request.scope["env"]
    user_id = user["id"]
    requested = (
        request.headers.get(WORKSPACE_HEADER) or request.query_params.get("workspace_id") or ""
    ).strip()
    bound = (user.get("api_key_workspace_id") or "").strip() or None
    if bound:
        if requested and requested != bound:
            raise HTTPException(status_code=404, detail="Workspace not found")
        await require_membership(env.DB, user_id, bound)
        return bound
    return await resolve_workspace_id(env.DB, user_id, requested or None)


async def require_row_access(
    db,
    user_id: str,
    row: Optional[dict],
    *,
    user_field: str = "user_id",
    not_found_detail: str = "Not found",
) -> None:
    """Row-level gate: membership on row.workspace_id when set, else the legacy
    owner check. Raises 404 either way so cross-tenant ids stay unguessable."""
    if not row:
        raise HTTPException(status_code=404, detail=not_found_detail)
    workspace_id = row.get("workspace_id")
    if workspace_id:
        await require_membership(db, user_id, workspace_id)
        return
    if row.get(user_field) != user_id:
        raise HTTPException(status_code=404, detail=not_found_detail)


WORKSPACE_TYPES = ("personal", "work")
WORKSPACE_PLANS = ("free", "pro", "enterprise")
INVITE_ROLES = ("member", "admin")
INVITE_TTL_DAYS = 7
MAX_INVITES_PER_REQUEST = 20

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$")


def _serialize_workspace(row: dict, role: Optional[str] = None) -> dict:
    out = {
        "id": row["id"],
        "name": row.get("name") or "",
        "slug": row.get("slug"),
        "type": row.get("type") or "personal",
        "plan": row.get("plan") or "free",
        "seats": row.get("seats", 1),
        "status": row.get("status") or "active",
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }
    if role is not None:
        out["role"] = role
    return out


async def _find_personal_workspace(db, user_id: str) -> Optional[dict]:
    return await Model(db).find_one(
        "workspaces", "owner_user_id = ? AND type = 'personal'", user_id
    )


async def onboard_workspace(db, user_id: str, req) -> dict:
    """Create (or return) a workspace for a freshly onboarded user.

    Personal is idempotent: one per user, returned as-is when it exists.
    Work always creates. Invites are work-only.
    """
    model = Model(db)
    name = (req.name or "").strip()
    if not name or len(name) > 64:
        raise HTTPException(status_code=400, detail="Workspace name is required (1-64 characters)")
    ws_type = (req.type or "personal").strip().lower()
    if ws_type not in WORKSPACE_TYPES:
        raise HTTPException(status_code=400, detail="Workspace type must be 'personal' or 'work'")
    plan = (req.plan or "free").strip().lower()
    if plan not in WORKSPACE_PLANS:
        raise HTTPException(status_code=400, detail="Workspace plan must be free, pro, or enterprise")
    try:
        seats = int(req.seats)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Seats must be a positive integer")
    if seats < 1:
        raise HTTPException(status_code=400, detail="Seats must be at least 1")
    if ws_type == "personal" and seats != 1:
        raise HTTPException(status_code=400, detail="Personal workspaces have exactly 1 seat")

    slug = (req.slug or "").strip().lower() or None
    if slug is not None:
        if not _SLUG_RE.match(slug):
            raise HTTPException(
                status_code=400,
                detail="Slug must be 2-48 lowercase letters, numbers, or hyphens",
            )
        if await model.find_one("workspaces", "slug = ?", slug):
            raise HTTPException(status_code=409, detail="Slug is already taken")

    avatar_url = (req.avatar_url or "").strip() or None
    if avatar_url is not None:
        if not (avatar_url.startswith("https://") or avatar_url.startswith("http://")):
            raise HTTPException(status_code=400, detail="Avatar must be an http(s) URL")
        if len(avatar_url) > 512:
            raise HTTPException(status_code=400, detail="Avatar URL is too long")

    metadata = req.metadata if isinstance(req.metadata, dict) else {}
    invites = list(req.invites or [])
    if invites and ws_type != "work":
        raise HTTPException(status_code=400, detail="Invites are only available for work workspaces")
    if len(invites) > MAX_INVITES_PER_REQUEST:
        raise HTTPException(
            status_code=400, detail=f"At most {MAX_INVITES_PER_REQUEST} invites per request"
        )

    if ws_type == "personal":
        existing = await _find_personal_workspace(db, user_id)
        if existing:
            return success(
                {**_serialize_workspace(existing, role="owner"), "created": False},
                message="Personal workspace already exists",
            )

    now = _now()
    workspace_id = f"ws_{uuid.uuid4().hex}"
    await model.insert(
        "workspaces",
        {
            "id": workspace_id,
            "name": name,
            "owner_user_id": user_id,
            "status": "active",
            "type": ws_type,
            "slug": slug,
            "avatar_url": avatar_url,
            "plan": plan,
            "seats": seats,
            "metadata": json.dumps(metadata),
            "created_at": now,
            "updated_at": now,
        },
    )
    await model.insert(
        "workspace_members",
        {
            "id": f"wsm_{uuid.uuid4().hex}",
            "workspace_id": workspace_id,
            "user_id": user_id,
            "role": "owner",
            "created_at": now,
            "updated_at": now,
        },
    )

    created_invites: list[dict] = []
    skipped_invites: list[dict] = []
    seen_emails: set[str] = set()
    for invite in invites:
        email = (invite.email or "").strip().lower()
        role = (invite.role or "member").strip().lower()
        if not email or not _EMAIL_RE.match(email):
            skipped_invites.append({"email": invite.email, "reason": "invalid email"})
            continue
        if email in seen_emails:
            skipped_invites.append({"email": email, "reason": "duplicate in request"})
            continue
        seen_emails.add(email)
        if role not in INVITE_ROLES:
            skipped_invites.append({"email": email, "reason": "role must be member or admin"})
            continue
        existing_user = await model.find_one("users", "lower(email) = ?", email)
        if existing_user and await get_membership(db, existing_user["id"], workspace_id):
            skipped_invites.append({"email": email, "reason": "already a member"})
            continue
        token = secrets.token_urlsafe(32)
        expires_at = (datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS)).isoformat()
        await model.insert(
            "workspace_invites",
            {
                "id": f"wsi_{uuid.uuid4().hex}",
                "workspace_id": workspace_id,
                "email": email,
                "role": role,
                "status": "pending",
                "token_hash": hashlib.sha256(token.encode()).hexdigest(),
                "invited_by_user_id": user_id,
                "expires_at": expires_at,
                "created_at": now,
                "updated_at": now,
            },
        )
        created_invites.append({"email": email, "role": role, "token": token, "expires_at": expires_at})

    workspace = await model.find_one("workspaces", "id = ?", workspace_id)
    return success(
        {
            **_serialize_workspace(workspace, role="owner"),
            "created": True,
            "invites": {"created": created_invites, "skipped": skipped_invites},
        },
        message="Workspace created",
    )


async def list_user_workspaces(db, user_id: str) -> dict:
    model = Model(db)
    memberships = await model.find_many(
        "workspace_members", "user_id = ? ORDER BY created_at", user_id
    )
    items = []
    for membership in memberships:
        workspace = await model.find_one("workspaces", "id = ?", membership["workspace_id"])
        if workspace is None:
            continue
        items.append(_serialize_workspace(workspace, role=membership.get("role")))
    return success(items, meta={"total": len(items)})


async def accept_workspace_invite(db, user_id: str, token: str) -> dict:
    model = Model(db)
    user = await model.find_one("users", "id = ?", user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    user_email = (user.get("email") or "").strip().lower()
    if not user_email:
        raise HTTPException(status_code=403, detail="Account has no verified email")

    token_hash = hashlib.sha256((token or "").encode()).hexdigest()
    invite = await model.find_one("workspace_invites", "token_hash = ?", token_hash)
    if invite is None or invite.get("status") != "pending":
        raise HTTPException(status_code=404, detail="Invite not found or already used")
    try:
        expires_at = datetime.fromisoformat((invite.get("expires_at") or "").replace("Z", "+00:00"))
    except ValueError:
        expires_at = None
    now = datetime.now(timezone.utc)
    if expires_at is None or expires_at <= now:
        await model.update(
            "workspace_invites", "id = ?", {"status": "expired", "updated_at": now.isoformat()}, invite["id"]
        )
        raise HTTPException(status_code=410, detail="Invite has expired")
    if (invite.get("email") or "").strip().lower() != user_email:
        raise HTTPException(status_code=403, detail="Invite was sent to a different email")

    workspace = await model.find_one("workspaces", "id = ?", invite["workspace_id"])
    if workspace is None or workspace.get("status") != "active":
        raise HTTPException(status_code=404, detail="Workspace not found")

    existing = await get_membership(db, user_id, workspace["id"])
    if existing is None:
        await model.insert(
            "workspace_members",
            {
                "id": f"wsm_{uuid.uuid4().hex}",
                "workspace_id": workspace["id"],
                "user_id": user_id,
                "role": invite.get("role") or "member",
                "created_at": now.isoformat(),
                "updated_at": now.isoformat(),
            },
        )
    await model.update(
        "workspace_invites", "id = ?", {"status": "accepted", "updated_at": now.isoformat()}, invite["id"]
    )
    return success(
        _serialize_workspace(workspace, role=(existing or {}).get("role") or invite.get("role")),
        message="Invite accepted",
    )
