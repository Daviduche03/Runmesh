import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

from fastapi import HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse

from db.connect_orm import (
    ConnectAppModel,
    ConnectAppUserModel,
    ConnectAuditEventModel,
    ConnectIdentityModel,
    ConnectSessionModel,
    ConnectUserModel,
)
from utils.connect_account import (
    ConnectRedirect,
    normalize_email,
)
from utils.connect_providers import (
    ConnectProvider,
    parse_connect_provider,
)
from utils.auth import (
    decode_token,
    encode_token,
)
from utils.types import (
    ConnectAppRow,
    ConnectAuditActorType,
    ConnectAuditEventCreate,
    ConnectAuditEventType,
    ConnectGrantRow,
    ConnectResourceType,
    ConnectSessionMode,
    ConnectSessionRow,
    ConnectSessionStatus,
    ConnectSessionUpdate,
    ConnectUserCreate,
    ConnectUserRow,
    ConnectUserStatus,
)
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SESSION_TTL_MINUTES = 15
CONNECT_CODE_TTL_MINUTES = 5
GRANT_ACCESS_TTL_MINUTES = 60
VALID_SESSION_MODES = {mode.value for mode in ConnectSessionMode}
VALID_CONSENT_ACTIONS = {"approve", "deny"}
GRANT_ACCESS_PREFIX = "rct_"
OTP_ISSUE_MAX_PER_HOUR = 5

# Observability — in-memory counters/histograms, no new table
CONNECT_METRICS = Counter()
CONNECT_LATENCY = []  # simple list for p50/p99, capped


def OTP_ISSUE_WINDOW_START() -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()


def _app_redirect_url(
    session: ConnectSessionRow,
    *,
    code: str | None = None,
    error: str | None = None,
) -> str:
    parsed = urlparse(session.redirect_uri)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["state"] = session.state
    if code:
        query["code"] = code
    if error:
        query["error"] = error
    return urlunparse(parsed._replace(query=urlencode(query)))


async def _attach_session_connect_user(
    session_model: ConnectSessionModel,
    app_user_model: ConnectAppUserModel,
    session: ConnectSessionRow,
    connect_user_id: str,
) -> ConnectSessionRow:
    if session.connect_user_id != connect_user_id:
        await session_model.update_session(
            session.id,
            ConnectSessionUpdate(connect_user_id=connect_user_id),
        )
    if session.external_user_id:
        await app_user_model.link_user(
            session.connect_app_id,
            session.external_user_id,
            connect_user_id,
        )
    refreshed = await session_model.find_by_id(session.id)
    if refreshed is None:
        raise HTTPException(status_code=500, detail="Connect session update failed")
    return refreshed


async def _audit(
    audit_model: ConnectAuditEventModel,
    *,
    event_type: ConnectAuditEventType,
    actor_type: ConnectAuditActorType,
    actor_id: str | None = None,
    connect_user_id: str | None = None,
    connect_app_id: str | None = None,
    resource_type: ConnectResourceType | None = None,
    resource_id: str | None = None,
    metadata: dict | None = None,
    agent_id: str | None = None,
    task_id: str | None = None,
    workflow_run_id: str | None = None,
    approval_required: bool = False,
    denial_reason: str | None = None,
    token_issued_at: str | None = None,
    token_expires_at: str | None = None,
    result: str = "success",
    error_code: str | None = None,
    error_message: str | None = None,
    request_id: str | None = None,
    workspace_id: str | None = None,
) -> None:
    await audit_model.create(
        ConnectAuditEventCreate(
            connect_user_id=connect_user_id,
            connect_app_id=connect_app_id,
            workspace_id=workspace_id,
            event_type=event_type.value,
            actor_type=actor_type,
            actor_id=actor_id,
            resource_type=resource_type.value if resource_type else None,
            resource_id=resource_id,
            metadata=metadata or {},
            agent_id=agent_id,
            task_id=task_id,
            workflow_run_id=workflow_run_id,
            approval_required=approval_required,
            denial_reason=denial_reason,
            token_issued_at=token_issued_at,
            token_expires_at=token_expires_at,
            result=result,
            error_code=error_code,
            error_message=error_message,
            request_id=request_id,
        )
    )


def _build_grant_access_token(
    jwt_secret: str,
    *,
    grant: ConnectGrantRow,
    task_id: str | None = None,
    workflow_run_id: str | None = None,
    workspace_project_id: str | None = None,
) -> str:
    payload = {
        "type": "connect_grant_access",
        "grant_id": grant.id,
        "app_id": grant.connect_app_id,
        "connect_user_id": grant.connect_user_id,
        "connection_id": grant.connection_id,
        "scopes": grant.scopes,
    }
    if task_id:
        payload["task_id"] = task_id
    if workflow_run_id:
        payload["workflow_run_id"] = workflow_run_id
    if workspace_project_id:
        payload["workspace_project_id"] = workspace_project_id
    return f"{GRANT_ACCESS_PREFIX}{encode_token(payload, jwt_secret, ttl_seconds=GRANT_ACCESS_TTL_MINUTES * 60)}"


async def _find_connect_user_by_verified_email(
    user_model: ConnectUserModel,
    identity_model: ConnectIdentityModel,
    email: str,
) -> ConnectUserRow | None:
    normalized = normalize_email(email)
    user = await user_model.find_by_primary_email(normalized)
    if user is not None:
        return user
    identities = await identity_model.list_verified_by_email(normalized)
    if not identities:
        return None
    return await user_model.find_by_id(identities[0].connect_user_id)


async def _find_or_create_connect_user_by_email(
    user_model: ConnectUserModel,
    identity_model: ConnectIdentityModel,
    email: str,
) -> ConnectUserRow:
    existing = await _find_connect_user_by_verified_email(user_model, identity_model, email)
    if existing is not None:
        return existing
    return await user_model.create(
        ConnectUserCreate(
            primary_email=normalize_email(email),
            primary_email_verified=True,
        )
    )


async def _get_owned_app(
    app_model: ConnectAppModel,
    developer_user_id: str,
    app_id: str,
) -> ConnectAppRow:
    app = await app_model.find_by_id(app_id)
    if not app or app.developer_user_id != developer_user_id:
        raise HTTPException(status_code=404, detail="Connect app not found")
    return app


def _issue_connect_code(
    jwt_secret: str,
    session: ConnectSessionRow,
    connect_user_id: str,
    *,
    grant_id: str | None = None,
    connection_id: str | None = None,
) -> str:
    payload = {
        "type": "connect_code",
        "session_id": session.id,
        "app_id": session.connect_app_id,
        "workspace_id": session.workspace_id,
        "connect_user_id": connect_user_id,
        "external_user_id": session.external_user_id,
        "grant_id": grant_id,
        "connection_id": connection_id,
    }
    return encode_token(payload, jwt_secret, ttl_seconds=CONNECT_CODE_TTL_MINUTES * 60)


async def _load_pending_session(session_model: ConnectSessionModel, state: str) -> ConnectSessionRow:
    session = await session_model.find_by_state(state.strip())
    if not session:
        raise HTTPException(status_code=404, detail="Connect session not found")
    if session.status != ConnectSessionStatus.PENDING:
        raise HTTPException(status_code=409, detail="Connect session is no longer active")
    expires_at = datetime.fromisoformat(session.expires_at.replace("Z", "+00:00"))
    if expires_at <= datetime.now(timezone.utc):
        await session_model.update_session(
            session.id,
            ConnectSessionUpdate(status=ConnectSessionStatus.EXPIRED),
        )
        raise HTTPException(status_code=410, detail="Connect session expired")
    return session


def _normalize_slug(slug: str) -> str:
    value = slug.strip().lower()
    if not value or not SLUG_PATTERN.match(value):
        raise HTTPException(
            status_code=400,
            detail="slug must be lowercase letters, numbers, and hyphens",
        )
    return value


def _parse_connect_code(code: str, jwt_secret: str) -> dict:
    # decode_token enforces signature validity and the exp claim
    payload = decode_token(code, jwt_secret)
    if not payload or payload.get("type") != "connect_code":
        raise HTTPException(status_code=400, detail="Invalid connect code")
    return payload


def _parse_grant_access_token(token: str, jwt_secret: str) -> dict:
    if not token.startswith(GRANT_ACCESS_PREFIX):
        raise HTTPException(status_code=401, detail="Invalid grant access token")
    # decode_token enforces signature validity and the exp claim
    payload = decode_token(token[len(GRANT_ACCESS_PREFIX):], jwt_secret)
    if not payload or payload.get("type") != "connect_grant_access":
        raise HTTPException(status_code=401, detail="Invalid grant access token")
    return payload


async def _require_authenticated_app_user(
    user_model: ConnectUserModel,
    app_user_model: ConnectAppUserModel,
    *,
    connect_app_id: str,
    external_user_id: str,
    connect_user_id: str,
) -> ConnectUserRow:
    connect_user = await user_model.find_by_id(connect_user_id)
    if connect_user is None:
        raise HTTPException(status_code=404, detail="Connect user not found")
    if connect_user.status != ConnectUserStatus.ACTIVE:
        raise HTTPException(status_code=403, detail="Connect user is not active")
    if not connect_user.primary_email_verified or not connect_user.primary_email:
        raise HTTPException(status_code=403, detail="User must authenticate before connect or grant")

    app_user = await app_user_model.find_by_external_user(connect_app_id, external_user_id)
    if app_user is None or app_user.connect_user_id != connect_user_id:
        raise HTTPException(
            status_code=403,
            detail="User must authenticate for this app before connect or grant",
        )
    return connect_user


def _require_google_connect_config(env) -> None:
    client_id = getattr(env, "GOOGLE_CONNECT_CLIENT_ID", None)
    client_secret = getattr(env, "GOOGLE_CONNECT_CLIENT_SECRET", None)
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="Google Connect OAuth is not configured")


def _seconds_until(timestamp: str | None) -> int | None:
    """Calculate seconds until a timestamp."""
    if not timestamp:
        return None
    try:
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        expiry = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        delta = expiry - now
        return max(0, int(delta.total_seconds()))
    except Exception:
        return None


def _serialize_app(app: ConnectAppRow) -> dict:
    return {
        "id": app.id,
        "name": app.name,
        "slug": app.slug,
        "redirect_uris": app.redirect_uris,
        "allowed_providers": app.allowed_providers,
        "status": app.status.value,
        "created_at": app.created_at,
        "updated_at": app.updated_at,
    }


def _serialize_session(
    session: ConnectSessionRow,
    *,
    authorize_url: str | None = None,
    challenge_id: str | None = None,
    challenge_expires_at: str | None = None,
) -> dict:
    payload = {
        "id": session.id,
        "app_id": session.connect_app_id,
        "external_user_id": session.external_user_id,
        "mode": session.mode.value,
        "provider": session.provider,
        "scopes": session.scopes,
        "redirect_uri": session.redirect_uri,
        "state": session.state,
        "status": session.status.value,
        "expires_at": session.expires_at,
    }
    if authorize_url is not None:
        payload["authorize_url"] = authorize_url
    if challenge_id is not None:
        payload["challenge_id"] = challenge_id
    if challenge_expires_at is not None:
        payload["challenge_expires_at"] = challenge_expires_at
    return payload


def _session_provider(session: ConnectSessionRow) -> ConnectProvider:
    return parse_connect_provider(session.provider)


def _validate_redirect_uris(redirect_uris: list[str]) -> list[str]:
    cleaned: list[str] = []
    for uri in redirect_uris:
        value = uri.strip()
        if not value:
            continue
        if not value.startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="redirect_uris must use http or https")
        cleaned.append(value)
    if not cleaned:
        raise HTTPException(status_code=400, detail="at least one redirect_uri is required")
    return cleaned


def finalize_connect_redirect(result: ConnectRedirect) -> RedirectResponse:
    return RedirectResponse(result.url)


