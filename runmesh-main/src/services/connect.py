import hmac
import json
import re
import secrets
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from html import escape as html_escape
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

from fastapi import HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse

from db.connect_orm import (
    ConnectAppModel,
    ConnectAppUserModel,
    ConnectAuditEventModel,
    ConnectConnectionModel,
    ConnectGrantModel,
    ConnectIdentityModel,
    ConnectOtpChallengeModel,
    ConnectSessionModel,
    ConnectUserModel,
)
from services.google_connect import (
    build_google_authorize_url,
    exchange_google_code,
    fetch_google_provider_account,
)
from utils.connect_account import (
    ConnectRedirect,
    generate_otp_code,
    hash_connect_secret,
    is_valid_email,
    normalize_email,
    otp_expires_at,
    send_connect_otp_email,
    OTP_MAX_ATTEMPTS,
)
from utils.api_auth import hash_api_key
from utils.connect_providers import (
    ConnectProvider,
    OAUTH_ENABLED_PROVIDERS,
    list_providers_catalog,
    normalize_requested_scopes,
    parse_connect_provider,
    validate_provider_allowed,
)
from utils.auth import decode_token, encode_token
from utils.connect_crypto import encrypt_connect_secret
from utils.rate_limit import enforce_rate_limit
from utils.responses import success
from utils.types import (
    ConnectAppCreate,
    ConnectAppCreateRequest,
    ConnectAppRow,
    ConnectAuditActorType,
    ConnectAuditEventCreate,
    ConnectAuditEventType,
    ConnectResourceType,
    ConnectConnectionCreate,
    ConnectConnectionRow,
    ConnectConnectionStatus,
    ConnectConnectionUpdate,
    ConnectConsentRequest,
    ConnectGrantCreate,
    ConnectGrantRow,
    ConnectIdentityCreate,
    ConnectIdentityProvider,
    ConnectIdentityRow,
    ConnectOtpChallengeCreate,
    ConnectOtpStatus,
    ConnectSessionCreate,
    ConnectSessionCreateRequest,
    ConnectSessionMode,
    ConnectOtpResendRequest,
    ConnectOtpVerifyRequest,
    ConnectSessionRow,
    ConnectSessionStatus,
    ConnectSessionUpdate,
    ConnectTokenRequest,
    ConnectUserCreate,
    ConnectUserRow,
    ConnectUserStatus,
    utc_now_iso,
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


def _normalize_slug(slug: str) -> str:
    value = slug.strip().lower()
    if not value or not SLUG_PATTERN.match(value):
        raise HTTPException(
            status_code=400,
            detail="slug must be lowercase letters, numbers, and hyphens",
        )
    return value


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


def _session_provider(session: ConnectSessionRow) -> ConnectProvider:
    return parse_connect_provider(session.provider)


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
) -> None:
    await audit_model.create(
        ConnectAuditEventCreate(
            connect_user_id=connect_user_id,
            connect_app_id=connect_app_id,
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
        "connect_user_id": connect_user_id,
        "external_user_id": session.external_user_id,
        "grant_id": grant_id,
        "connection_id": connection_id,
    }
    return encode_token(payload, jwt_secret, ttl_seconds=CONNECT_CODE_TTL_MINUTES * 60)


def _parse_connect_code(code: str, jwt_secret: str) -> dict:
    # decode_token enforces signature validity and the exp claim
    payload = decode_token(code, jwt_secret)
    if not payload or payload.get("type") != "connect_code":
        raise HTTPException(status_code=400, detail="Invalid connect code")
    return payload


async def _get_owned_app(
    app_model: ConnectAppModel,
    developer_user_id: str,
    app_id: str,
) -> ConnectAppRow:
    app = await app_model.find_by_id(app_id)
    if not app or app.developer_user_id != developer_user_id:
        raise HTTPException(status_code=404, detail="Connect app not found")
    return app


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


def _require_google_connect_config(env) -> None:
    client_id = getattr(env, "GOOGLE_CONNECT_CLIENT_ID", None)
    client_secret = getattr(env, "GOOGLE_CONNECT_CLIENT_SECRET", None)
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="Google Connect OAuth is not configured")


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


def finalize_connect_redirect(result: ConnectRedirect) -> RedirectResponse:
    return RedirectResponse(result.url)


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


async def attach_provider_identity(
    identity_model: ConnectIdentityModel,
    *,
    connect_user_id: str,
    identity_provider: ConnectIdentityProvider,
    provider_subject: str,
    email: str | None,
    email_verified: bool,
    display_name: str | None = None,
    avatar_url: str | None = None,
) -> ConnectIdentityRow:
    existing = await identity_model.find_by_provider_subject(
        identity_provider,
        provider_subject,
    )
    if existing is not None:
        if existing.connect_user_id != connect_user_id:
            raise HTTPException(status_code=400, detail="provider account is linked to another user")
        return existing
    return await identity_model.create(
        ConnectIdentityCreate(
            connect_user_id=connect_user_id,
            provider=identity_provider,
            provider_subject=provider_subject,
            email=email,
            email_verified=email_verified,
            display_name=display_name,
            avatar_url=avatar_url,
        )
    )


async def _issue_otp_challenge(
    env,
    user_model: ConnectUserModel,
    identity_model: ConnectIdentityModel,
    otp_model: ConnectOtpChallengeModel,
    *,
    connect_app_id: str,
    external_user_id: str,
    email: str,
    connect_session_id: str | None = None,
) -> dict:
    normalized_email = normalize_email(email)
    if not is_valid_email(normalized_email):
        raise HTTPException(status_code=400, detail="valid email is required")

    connect_user = await _find_connect_user_by_verified_email(
        user_model,
        identity_model,
        normalized_email,
    )
    connect_user_id = connect_user.id if connect_user else None

    # Throttle: no more than OTP_ISSUE_MAX_PER_HOUR codes per email per hour
    recent = await otp_model.count_recent_for_email(normalized_email, OTP_ISSUE_WINDOW_START())
    if recent >= OTP_ISSUE_MAX_PER_HOUR:
        raise HTTPException(status_code=429, detail="Too many verification codes requested. Try again later.")

    code = generate_otp_code()
    challenge = await otp_model.create(
        ConnectOtpChallengeCreate(
            connect_app_id=connect_app_id,
            external_user_id=external_user_id,
            connect_session_id=connect_session_id,
            email=normalized_email,
            code_hash=hash_connect_secret(code, env.JWT_SECRET),
            connect_user_id=connect_user_id,
            expires_at=otp_expires_at(),
        )
    )
    await send_connect_otp_email(env, normalized_email, code)
    return {
        "challenge_id": challenge.id,
        "expires_at": challenge.expires_at,
    }


async def resend_connect_otp(
    env,
    app_model: ConnectAppModel,
    otp_model: ConnectOtpChallengeModel,
    req: ConnectOtpResendRequest,
    developer_user_id: str,
) -> dict:
    challenge = await otp_model.find_by_id(req.challenge_id.strip())
    if challenge is None:
        raise HTTPException(status_code=404, detail="Verification challenge not found")

    await _get_owned_app(app_model, developer_user_id, challenge.connect_app_id)

    if challenge.status not in {
        ConnectOtpStatus.PENDING,
        ConnectOtpStatus.EXPIRED,
        ConnectOtpStatus.FAILED,
    }:
        raise HTTPException(status_code=400, detail="Verification challenge cannot be resent")

    # Cooldown: at most one resend per challenge per minute
    await enforce_rate_limit(
        otp_model.db,
        f"connect-otp-resend:{challenge.id}",
        limit=1,
        window_seconds=60,
        detail="Verification code was just sent. Please wait before resending.",
    )

    code = generate_otp_code()
    expires_at = otp_expires_at()
    await otp_model.update_challenge(
        challenge.id,
        {
            "code_hash": hash_connect_secret(code, env.JWT_SECRET),
            "attempts": 0,
            "expires_at": expires_at,
            "status": ConnectOtpStatus.PENDING.value,
        },
    )
    await send_connect_otp_email(env, challenge.email, code)
    return success(
        {
            "challenge_id": challenge.id,
            "expires_at": expires_at,
        },
        message="Verification code resent",
    )


async def verify_connect_otp(
    env,
    app_model: ConnectAppModel,
    user_model: ConnectUserModel,
    identity_model: ConnectIdentityModel,
    app_user_model: ConnectAppUserModel,
    otp_model: ConnectOtpChallengeModel,
    session_model: ConnectSessionModel,
    req: ConnectOtpVerifyRequest,
    developer_user_id: str,
) -> dict:
    challenge = await otp_model.find_by_id(req.challenge_id.strip())
    if challenge is None:
        raise HTTPException(status_code=404, detail="Verification challenge not found")
    if challenge.status != ConnectOtpStatus.PENDING:
        raise HTTPException(status_code=400, detail="Verification challenge is not active")

    await _get_owned_app(app_model, developer_user_id, challenge.connect_app_id)

    expires_at = datetime.fromisoformat(challenge.expires_at.replace("Z", "+00:00"))
    if expires_at <= datetime.now(timezone.utc):
        await otp_model.update_challenge(
            challenge.id,
            {"status": ConnectOtpStatus.EXPIRED.value},
        )
        raise HTTPException(status_code=400, detail="Verification code expired")

    if challenge.attempts >= OTP_MAX_ATTEMPTS:
        await otp_model.update_challenge(
            challenge.id,
            {"status": ConnectOtpStatus.FAILED.value},
        )
        raise HTTPException(status_code=400, detail="Too many verification attempts")

    if not hmac.compare_digest(hash_connect_secret(req.code.strip(), env.JWT_SECRET), challenge.code_hash):
        await otp_model.update_challenge(
            challenge.id,
            {"attempts": challenge.attempts + 1},
        )
        raise HTTPException(status_code=400, detail="Invalid verification code")

    connect_user_id = challenge.connect_user_id
    if not connect_user_id:
        connect_user = await _find_or_create_connect_user_by_email(
            user_model,
            identity_model,
            challenge.email,
        )
        connect_user_id = connect_user.id

    await otp_model.update_challenge(
        challenge.id,
        {
            "status": ConnectOtpStatus.VERIFIED.value,
            "verified_at": utc_now_iso(),
            "connect_user_id": connect_user_id,
        },
    )
    await app_user_model.link_user(
        challenge.connect_app_id,
        challenge.external_user_id,
        connect_user_id,
    )

    result = {
        "connect_user_id": connect_user_id,
        "external_user_id": challenge.external_user_id,
        "email": challenge.email,
    }

    if challenge.connect_session_id:
        session = await session_model.find_by_id(challenge.connect_session_id)
        if (
            session is not None
            and session.status == ConnectSessionStatus.PENDING
            and session.mode == ConnectSessionMode.AUTHENTICATE
        ):
            session = await _attach_session_connect_user(
                session_model,
                app_user_model,
                session,
                connect_user_id,
            )
            await _complete_session(session_model, session, connect_user_id)
            result["session_id"] = session.id
            result["code"] = _issue_connect_code(
                env.JWT_SECRET,
                session,
                connect_user_id,
            )

    return success(result, message="User verified")


async def _upsert_connection(
    connection_model: ConnectConnectionModel,
    *,
    connect_user_id: str,
    provider: str,
    scopes: list[str],
    access_token: str,
    refresh_token: str | None,
    expires_in: int | None,
    identity_id: str,
    account_label: str | None,
    vault_secret: str,
) -> str:
    token_expires_at = None
    if expires_in:
        token_expires_at = (datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))).isoformat()

    access_token_enc = encrypt_connect_secret(access_token, vault_secret)
    refresh_token_enc = (
        encrypt_connect_secret(refresh_token, vault_secret) if refresh_token else None
    )

    existing = await connection_model.find_by_user_provider(connect_user_id, provider)
    if existing is not None:
        await connection_model.update_connection(
            existing.id,
            ConnectConnectionUpdate(
                status=ConnectConnectionStatus.ACTIVE,
                scopes=scopes,
                access_token_enc=access_token_enc,
                refresh_token_enc=refresh_token_enc,
                token_expires_at=token_expires_at,
                provider_account_label=account_label,
                identity_id=identity_id,
                revoked_at=None,
            ),
        )
        return existing.id

    connection = await connection_model.create(
        ConnectConnectionCreate(
            connect_user_id=connect_user_id,
            provider=provider,
            scopes=scopes,
            access_token_enc=access_token_enc,
            refresh_token_enc=refresh_token_enc,
            token_expires_at=token_expires_at,
            provider_account_label=account_label,
            identity_id=identity_id,
        )
    )
    return connection.id


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


def _parse_grant_access_token(token: str, jwt_secret: str) -> dict:
    if not token.startswith(GRANT_ACCESS_PREFIX):
        raise HTTPException(status_code=401, detail="Invalid grant access token")
    # decode_token enforces signature validity and the exp claim
    payload = decode_token(token[len(GRANT_ACCESS_PREFIX):], jwt_secret)
    if not payload or payload.get("type") != "connect_grant_access":
        raise HTTPException(status_code=401, detail="Invalid grant access token")
    return payload


async def _ensure_grant(
    grant_model: ConnectGrantModel,
    *,
    connect_app_id: str,
    connect_user_id: str,
    connection_id: str,
    scopes: list[str],
) -> str:
    existing = await grant_model.find_active(connect_app_id, connect_user_id, connection_id)
    if existing is not None:
        return existing.id
    grant = await grant_model.create(
        ConnectGrantCreate(
            connect_app_id=connect_app_id,
            connect_user_id=connect_user_id,
            connection_id=connection_id,
            scopes=scopes,
        )
    )
    return grant.id


async def _complete_session(
    session_model: ConnectSessionModel,
    session: ConnectSessionRow,
    connect_user_id: str,
) -> None:
    await session_model.complete(session.id, connect_user_id)


async def create_connect_app(
    app_model: ConnectAppModel,
    audit_model: ConnectAuditEventModel,
    req: ConnectAppCreateRequest,
    developer_user_id: str,
) -> dict:
    slug = _normalize_slug(req.slug)
    redirect_uris = _validate_redirect_uris(req.redirect_uris)
    allowed_providers = [provider.strip().lower() for provider in req.allowed_providers if provider.strip()]

    existing = await app_model.find_by_slug(developer_user_id, slug)
    if existing is not None:
        raise HTTPException(status_code=409, detail="Connect app slug already exists")

    app = await app_model.create(
        ConnectAppCreate(
            developer_user_id=developer_user_id,
            name=req.name.strip(),
            slug=slug,
            client_secret_hash=hash_api_key(secrets.token_urlsafe(32)),
            redirect_uris=redirect_uris,
            allowed_providers=allowed_providers,
        )
    )

    await _audit(
        audit_model,
        event_type=ConnectAuditEventType.APP_CREATED,
        actor_type=ConnectAuditActorType.DEVELOPER,
        actor_id=developer_user_id,
        connect_app_id=app.id,
        resource_type=ConnectResourceType.CONNECT_APP,
        resource_id=app.id,
    )

    return success(_serialize_app(app), message="Connect app created")


async def list_connect_apps(
    app_model: ConnectAppModel,
    developer_user_id: str,
) -> dict:
    apps = await app_model.list_by_developer_user_id(developer_user_id)
    items = [_serialize_app(app) for app in apps]
    return success(items, meta={"total": len(items)})


async def get_connect_app(
    app_model: ConnectAppModel,
    developer_user_id: str,
    app_id: str,
) -> dict:
    app = await _get_owned_app(app_model, developer_user_id, app_id)
    return success(_serialize_app(app))


async def delete_connect_app(
    app_model: ConnectAppModel,
    developer_user_id: str,
    app_id: str,
) -> dict:
    app = await _get_owned_app(app_model, developer_user_id, app_id)
    deleted = await app_model.delete_app(app.id)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Connect app not found")
    return success({"id": app.id}, message="Connect app deleted")


async def _grant_authorize_redirect(
    env,
    session_model: ConnectSessionModel,
    connection_model: ConnectConnectionModel,
    grant_model: ConnectGrantModel,
    session: ConnectSessionRow,
    public_base_url: str,
) -> str:
    provider = _session_provider(session)

    if not session.connect_user_id:
        return _app_redirect_url(session, error="authentication_required")

    connection = await connection_model.find_by_user_provider(session.connect_user_id, provider.value)
    if connection is None or connection.status != ConnectConnectionStatus.ACTIVE:
        if provider == ConnectProvider.GOOGLE:
            _require_google_connect_config(env)
            return build_google_authorize_url(
                env,
                public_base_url,
                session.state,
                ConnectSessionMode.CONNECT,
                session.scopes,
            )
        raise HTTPException(status_code=501, detail=f"OAuth authorize not implemented for {provider.value}")

    existing_grant = await grant_model.find_active(
        session.connect_app_id,
        session.connect_user_id,
        connection.id,
    )
    if existing_grant is not None:
        await _complete_session(session_model, session, session.connect_user_id)
        connect_code = _issue_connect_code(
            env.JWT_SECRET,
            session,
            session.connect_user_id,
            grant_id=existing_grant.id,
            connection_id=connection.id,
        )
        return _app_redirect_url(session, code=connect_code)

    return f"{public_base_url.rstrip('/')}/connect/consent?state={session.state}"


async def create_connect_session(
    env,
    app_model: ConnectAppModel,
    session_model: ConnectSessionModel,
    audit_model: ConnectAuditEventModel,
    user_model: ConnectUserModel,
    identity_model: ConnectIdentityModel,
    app_user_model: ConnectAppUserModel,
    otp_model: ConnectOtpChallengeModel,
    req: ConnectSessionCreateRequest,
    developer_user_id: str,
    public_base_url: str,
) -> dict:
    mode_value = req.mode.strip().lower()
    if mode_value not in VALID_SESSION_MODES:
        raise HTTPException(status_code=400, detail="invalid connect session mode")
    mode = ConnectSessionMode(mode_value)

    app = await _get_owned_app(app_model, developer_user_id, req.app_id)
    if app.status.value != "active":
        raise HTTPException(status_code=403, detail="Connect app is disabled")

    redirect_uri = req.redirect_uri.strip()
    if redirect_uri not in app.redirect_uris:
        raise HTTPException(status_code=400, detail="redirect_uri is not allowed for this app")

    external_user_id = req.external_user_id.strip()
    if not external_user_id:
        raise HTTPException(status_code=400, detail="external_user_id is required")

    connect_user_id = (req.connect_user_id or "").strip() or None
    provider_value: str | None = None
    scopes: list[str] = []
    challenge_payload: dict | None = None

    if mode == ConnectSessionMode.AUTHENTICATE:
        if connect_user_id:
            raise HTTPException(status_code=400, detail="connect_user_id is not used for authenticate mode")
        if not req.email or not req.email.strip():
            raise HTTPException(status_code=400, detail="email is required for authenticate mode")
    elif mode in {ConnectSessionMode.CONNECT, ConnectSessionMode.GRANT}:
        if not connect_user_id:
            raise HTTPException(status_code=400, detail="connect_user_id is required")
        await _require_authenticated_app_user(
            user_model,
            app_user_model,
            connect_app_id=app.id,
            external_user_id=external_user_id,
            connect_user_id=connect_user_id,
        )
        if not req.provider or not req.provider.strip():
            raise HTTPException(status_code=400, detail="provider is required for this session mode")
        provider = parse_connect_provider(req.provider)
        validate_provider_allowed(provider, app.allowed_providers)
        if provider not in OAUTH_ENABLED_PROVIDERS:
            raise HTTPException(status_code=501, detail=f"OAuth not enabled for provider {provider.value}")
        provider_value = provider.value
        scopes = normalize_requested_scopes(provider, req.scopes)
        if mode == ConnectSessionMode.CONNECT and not scopes:
            raise HTTPException(status_code=400, detail="at least one scope is required for connect mode")

    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=SESSION_TTL_MINUTES)).isoformat()
    state = secrets.token_urlsafe(32)
    session = await session_model.create(
        ConnectSessionCreate(
            connect_app_id=app.id,
            external_user_id=external_user_id,
            mode=mode,
            provider=provider_value,
            scopes=scopes,
            redirect_uri=redirect_uri,
            state=state,
            connect_user_id=connect_user_id,
            expires_at=expires_at,
        )
    )

    authorize_url: str | None = None
    if mode == ConnectSessionMode.AUTHENTICATE:
        challenge_payload = await _issue_otp_challenge(
            env,
            user_model,
            identity_model,
            otp_model,
            connect_app_id=app.id,
            external_user_id=external_user_id,
            email=req.email or "",
            connect_session_id=session.id,
        )
    else:
        authorize_url = f"{public_base_url.rstrip('/')}/connect/authorize?state={state}"

    await _audit(
        audit_model,
        event_type=ConnectAuditEventType.SESSION_CREATED,
        actor_type=ConnectAuditActorType.APP,
        actor_id=app.id,
        connect_app_id=app.id,
        resource_type=ConnectResourceType.CONNECT_SESSION,
        resource_id=session.id,
        metadata={
            "mode": mode.value,
            "provider": provider_value,
            "external_user_id": session.external_user_id,
            "connect_user_id": connect_user_id,
        },
    )

    return success(
        _serialize_session(
            session,
            authorize_url=authorize_url,
            challenge_id=challenge_payload["challenge_id"] if challenge_payload else None,
            challenge_expires_at=challenge_payload["expires_at"] if challenge_payload else None,
        ),
        message="Connect session created",
    )


async def connect_oauth_error_redirect(
    session_model: ConnectSessionModel,
    state: str,
    error: str | None = None,
) -> str:
    session = await session_model.find_by_state(state.strip())
    if session is None:
        raise HTTPException(status_code=404, detail="Connect session not found")
    return _app_redirect_url(session, error=error or "oauth_failed")


async def begin_connect_authorize(
    env,
    session_model: ConnectSessionModel,
    user_model: ConnectUserModel,
    app_user_model: ConnectAppUserModel,
    connection_model: ConnectConnectionModel,
    grant_model: ConnectGrantModel,
    state: str,
    public_base_url: str,
) -> ConnectRedirect:
    session = await _load_pending_session(session_model, state)

    connect_user_id = session.connect_user_id
    if not connect_user_id:
        return ConnectRedirect(url=_app_redirect_url(session, error="authentication_required"))

    if session.mode in {ConnectSessionMode.CONNECT, ConnectSessionMode.GRANT}:
        if not session.external_user_id:
            return ConnectRedirect(url=_app_redirect_url(session, error="authentication_required"))
        try:
            await _require_authenticated_app_user(
                user_model,
                app_user_model,
                connect_app_id=session.connect_app_id,
                external_user_id=session.external_user_id,
                connect_user_id=connect_user_id,
            )
        except HTTPException:
            return ConnectRedirect(url=_app_redirect_url(session, error="authentication_required"))

    session = await _attach_session_connect_user(
        session_model,
        app_user_model,
        session,
        connect_user_id,
    )

    if session.mode == ConnectSessionMode.AUTHENTICATE:
        return ConnectRedirect(url=_app_redirect_url(session, error="use_otp_verify"))

    if session.mode == ConnectSessionMode.GRANT:
        return ConnectRedirect(
            url=await _grant_authorize_redirect(
                env,
                session_model,
                connection_model,
                grant_model,
                session,
                public_base_url,
            ),
            connect_user_id=connect_user_id,
        )

    provider = _session_provider(session)
    if provider not in OAUTH_ENABLED_PROVIDERS:
        raise HTTPException(status_code=501, detail=f"OAuth not enabled for provider {provider.value}")

    if provider == ConnectProvider.GOOGLE:
        _require_google_connect_config(env)
        return ConnectRedirect(
            url=build_google_authorize_url(
                env,
                public_base_url,
                session.state,
                session.mode,
                session.scopes,
            ),
            connect_user_id=connect_user_id,
        )
    raise HTTPException(status_code=501, detail=f"OAuth authorize not implemented for {provider.value}")


async def handle_connect_callback(
    env,
    app_model: ConnectAppModel,
    session_model: ConnectSessionModel,
    user_model: ConnectUserModel,
    identity_model: ConnectIdentityModel,
    app_user_model: ConnectAppUserModel,
    connection_model: ConnectConnectionModel,
    grant_model: ConnectGrantModel,
    audit_model: ConnectAuditEventModel,
    *,
    code: str,
    state: str,
    public_base_url: str,
) -> ConnectRedirect:
    session = await _load_pending_session(session_model, state)
    provider = _session_provider(session)
    if provider not in OAUTH_ENABLED_PROVIDERS:
        return ConnectRedirect(url=_app_redirect_url(session, error="provider_unavailable"))

    if not session.connect_user_id:
        return ConnectRedirect(url=_app_redirect_url(session, error="authentication_required"))

    connect_user = await user_model.find_by_id(session.connect_user_id)
    if connect_user is None:
        return ConnectRedirect(url=_app_redirect_url(session, error="authentication_required"))

    try:
        if provider == ConnectProvider.GOOGLE:
            _require_google_connect_config(env)
            token_data = await exchange_google_code(env, code, public_base_url)
            oauth_user = await fetch_google_provider_account(token_data["access_token"])
        else:
            return ConnectRedirect(url=_app_redirect_url(session, error="provider_unavailable"))
    except ValueError:
        return ConnectRedirect(url=_app_redirect_url(session, error="oauth_failed"))

    provider_subject = str(oauth_user.get("sub", "")).strip()
    if not provider_subject:
        return ConnectRedirect(url=_app_redirect_url(session, error="provider_missing"))

    if provider != ConnectProvider.GOOGLE:
        return ConnectRedirect(url=_app_redirect_url(session, error="provider_unavailable"))

    identity = await attach_provider_identity(
        identity_model,
        connect_user_id=connect_user.id,
        identity_provider=ConnectIdentityProvider.GOOGLE,
        provider_subject=provider_subject,
        email=oauth_user.get("email"),
        email_verified=bool(oauth_user.get("email_verified")),
    )

    app = await app_model.find_by_id(session.connect_app_id)
    if app is None:
        raise HTTPException(status_code=404, detail="Connect app not found")

    if session.mode == ConnectSessionMode.CONNECT:
        connection_id = await _upsert_connection(
            connection_model,
            connect_user_id=connect_user.id,
            provider=provider.value,
            scopes=session.scopes,
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token"),
            expires_in=token_data.get("expires_in"),
            identity_id=identity.id,
            account_label=connect_user.primary_email or oauth_user.get("email"),
            vault_secret=env.JWT_SECRET,
        )
        grant_id = await _ensure_grant(
            grant_model,
            connect_app_id=session.connect_app_id,
            connect_user_id=connect_user.id,
            connection_id=connection_id,
            scopes=session.scopes,
        )
        await _complete_session(session_model, session, connect_user.id)
        await _audit(
            audit_model,
            event_type=ConnectAuditEventType.CONNECTION_CREATED,
            actor_type=ConnectAuditActorType.CONNECT_USER,
            actor_id=connect_user.id,
            connect_user_id=connect_user.id,
            connect_app_id=app.id,
            resource_type=ConnectResourceType.CONNECT_CONNECTION,
            resource_id=connection_id,
            metadata={"provider": provider.value, "grant_id": grant_id},
        )
        connect_code = _issue_connect_code(
            env.JWT_SECRET,
            session,
            connect_user.id,
            grant_id=grant_id,
            connection_id=connection_id,
        )
        return ConnectRedirect(
            url=_app_redirect_url(session, code=connect_code),
            connect_user_id=connect_user.id,
        )

    connection = await connection_model.find_by_user_provider(connect_user.id, provider.value)
    if connection is None or connection.status != ConnectConnectionStatus.ACTIVE:
        if not session.scopes:
            return ConnectRedirect(url=_app_redirect_url(session, error="connection_required"))
        connection_id = await _upsert_connection(
            connection_model,
            connect_user_id=connect_user.id,
            provider=provider.value,
            scopes=session.scopes,
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token"),
            expires_in=token_data.get("expires_in"),
            identity_id=identity.id,
            account_label=oauth_user.get("email"),
            vault_secret=env.JWT_SECRET,
        )
        connection = await connection_model.find_by_id(connection_id)
        if connection is None:
            return ConnectRedirect(url=_app_redirect_url(session, error="connection_required"))

    if connection.status != ConnectConnectionStatus.ACTIVE:
        return ConnectRedirect(url=_app_redirect_url(session, error="connection_required"))

    existing_grant = await grant_model.find_active(
        session.connect_app_id,
        connect_user.id,
        connection.id,
    )
    if existing_grant is not None:
        await _complete_session(session_model, session, connect_user.id)
        connect_code = _issue_connect_code(
            env.JWT_SECRET,
            session,
            connect_user.id,
            grant_id=existing_grant.id,
            connection_id=connection.id,
        )
        return ConnectRedirect(
            url=_app_redirect_url(session, code=connect_code),
            connect_user_id=connect_user.id,
        )

    return ConnectRedirect(
        url=f"{public_base_url.rstrip('/')}/connect/consent?state={session.state}",
        connect_user_id=connect_user.id,
    )


async def get_connect_consent_page(
    app_model: ConnectAppModel,
    session_model: ConnectSessionModel,
    connection_model: ConnectConnectionModel,
    state: str,
) -> HTMLResponse:
    session = await _load_pending_session(session_model, state)
    if session.mode != ConnectSessionMode.GRANT:
        raise HTTPException(status_code=400, detail="Consent is only available for grant sessions")
    if not session.connect_user_id:
        raise HTTPException(status_code=400, detail="Connect session is missing identity")

    app = await app_model.find_by_id(session.connect_app_id)
    if app is None:
        raise HTTPException(status_code=404, detail="Connect app not found")

    provider = _session_provider(session)
    connection = await connection_model.find_by_user_provider(session.connect_user_id, provider.value)
    if connection is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    scopes = ", ".join(session.scopes) if session.scopes else provider.value
    account = connection.provider_account_label or provider.value
    # All interpolated values are HTML-escaped: app names / account labels are
    # user-controlled and would otherwise be a stored-XSS vector.
    safe_app_name = html_escape(app.name, quote=True)
    safe_account = html_escape(account, quote=True)
    safe_scopes = html_escape(scopes, quote=True)
    safe_state = html_escape(session.state, quote=True)
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Runmesh Connect</title>
  <style>
    body {{ font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }}
    main {{ max-width: 480px; margin: 48px auto; padding: 24px; background: #fff; border: 1px solid #e2e8f0; }}
    h1 {{ font-size: 20px; margin: 0 0 8px; }}
    p {{ margin: 0 0 16px; line-height: 1.5; color: #475569; }}
    .meta {{ font-size: 14px; margin-bottom: 24px; }}
    form {{ display: flex; gap: 12px; }}
    button {{ flex: 1; height: 40px; border: 1px solid #0f172a; background: #0f172a; color: #fff; cursor: pointer; }}
    button[name="action"][value="deny"] {{ background: #fff; color: #0f172a; }}
  </style>
</head>
<body>
  <main>
    <h1>Approve access</h1>
    <p><strong>{safe_app_name}</strong> wants to use your connected account.</p>
    <div class="meta">
      <div>Account: {safe_account}</div>
      <div>Scopes: {safe_scopes}</div>
    </div>
    <form method="post" action="/connect/consent">
      <input type="hidden" name="state" value="{safe_state}" />
      <button type="submit" name="action" value="approve">Approve</button>
      <button type="submit" name="action" value="deny">Deny</button>
    </form>
  </main>
</body>
</html>"""
    return HTMLResponse(content=html)


async def submit_connect_consent(
    env,
    session_model: ConnectSessionModel,
    connection_model: ConnectConnectionModel,
    grant_model: ConnectGrantModel,
    audit_model: ConnectAuditEventModel,
    req: ConnectConsentRequest,
) -> ConnectRedirect:
    action = req.action.strip().lower()
    if action not in VALID_CONSENT_ACTIONS:
        raise HTTPException(status_code=400, detail="Invalid consent action")

    session = await _load_pending_session(session_model, req.state)
    if session.mode != ConnectSessionMode.GRANT:
        raise HTTPException(status_code=400, detail="Consent is only available for grant sessions")
    if not session.connect_user_id:
        raise HTTPException(status_code=400, detail="Connect session is missing identity")

    if action == "deny":
        await session_model.update_session(
            session.id,
            ConnectSessionUpdate(status=ConnectSessionStatus.CANCELLED),
        )
        await _audit(
            audit_model,
            event_type=ConnectAuditEventType.GRANT_DENIED,
            actor_type=ConnectAuditActorType.CONNECT_USER,
            actor_id=session.connect_user_id,
            connect_user_id=session.connect_user_id,
            connect_app_id=session.connect_app_id,
            resource_type=ConnectResourceType.CONNECT_SESSION,
            resource_id=session.id,
        )
        return ConnectRedirect(url=_app_redirect_url(session, error="access_denied"))

    provider = _session_provider(session)
    connection = await connection_model.find_by_user_provider(session.connect_user_id, provider.value)
    if connection is None:
        return ConnectRedirect(url=_app_redirect_url(session, error="connection_required"))

    grant_id = await _ensure_grant(
        grant_model,
        connect_app_id=session.connect_app_id,
        connect_user_id=session.connect_user_id,
        connection_id=connection.id,
        scopes=session.scopes or [provider.value],
    )
    await _complete_session(session_model, session, session.connect_user_id)
    await _audit(
        audit_model,
        event_type=ConnectAuditEventType.GRANT_APPROVED,
        actor_type=ConnectAuditActorType.CONNECT_USER,
        actor_id=session.connect_user_id,
        connect_user_id=session.connect_user_id,
        connect_app_id=session.connect_app_id,
        resource_type=ConnectResourceType.CONNECT_GRANT,
        resource_id=grant_id,
    )
    connect_code = _issue_connect_code(
        env.JWT_SECRET,
        session,
        session.connect_user_id,
        grant_id=grant_id,
        connection_id=connection.id,
    )
    return ConnectRedirect(
        url=_app_redirect_url(session, code=connect_code),
        connect_user_id=session.connect_user_id,
    )


async def exchange_connect_token(
    app_model: ConnectAppModel,
    session_model: ConnectSessionModel,
    grant_model: ConnectGrantModel,
    audit_model: ConnectAuditEventModel,
    req: ConnectTokenRequest,
    developer_user_id: str,
    jwt_secret: str,
) -> dict:
    app = await _get_owned_app(app_model, developer_user_id, req.app_id)

    if req.code:
        payload = _parse_connect_code(req.code, jwt_secret)
        if payload.get("app_id") != app.id:
            raise HTTPException(status_code=400, detail="Connect code does not belong to this app")

        session = await session_model.find_by_id(str(payload["session_id"]))
        if session is None:
            raise HTTPException(status_code=400, detail="Connect session not found")
        if session.status != ConnectSessionStatus.COMPLETED:
            raise HTTPException(status_code=400, detail="Connect session is not completed")
        if session.connect_user_id != payload.get("connect_user_id"):
            raise HTTPException(status_code=400, detail="Connect code does not match session")

        result = {
            "connect_user_id": payload.get("connect_user_id"),
            "external_user_id": payload.get("external_user_id"),
            "session_id": payload.get("session_id"),
            "grant_id": payload.get("grant_id"),
            "connection_id": payload.get("connection_id"),
            "mode": session.mode.value,
            "grant_access_token": None,
            "grant_access_expires_in": None,
        }
        grant_id = payload.get("grant_id")
    else:
        grant = await grant_model.find_by_id(str(req.grant_id))
        if grant is None or grant.status.value != "active":
            raise HTTPException(status_code=404, detail="Grant not found")
        if grant.connect_app_id != app.id:
            raise HTTPException(status_code=403, detail="Grant does not belong to this app")
        result = {
            "connect_user_id": grant.connect_user_id,
            "external_user_id": None,
            "session_id": None,
            "grant_id": grant.id,
            "connection_id": grant.connection_id,
            "mode": None,
            "grant_access_token": None,
            "grant_access_expires_in": None,
        }
        grant_id = grant.id

    if grant_id:
        grant = await grant_model.find_by_id(str(grant_id))
        if grant is None or grant.status.value != "active":
            raise HTTPException(status_code=400, detail="Grant is not active")
        if grant.connect_app_id != app.id:
            raise HTTPException(status_code=400, detail="Grant does not belong to this app")
        
        if grant.approval_status == "denied":
            CONNECT_METRICS["token_blocked_denied"] += 1
            raise HTTPException(status_code=403, detail=json.dumps({
                "error": "grant_denied",
                "message": "Grant has been denied and cannot be used",
                "grant_id": grant.id,
            }))
        if grant.approval_status != "approved":
            CONNECT_METRICS["token_blocked_pending"] += 1
            raise HTTPException(status_code=403, detail=json.dumps({
                "error": "grant_pending_approval",
                "message": "Grant is awaiting approval",
                "grant_id": grant.id,
            }))
        
        # ========== NEW: Time-bounded validity checks (P1) ==========
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        
        if grant.valid_from:
            valid_from = datetime.fromisoformat(grant.valid_from.replace('Z', '+00:00'))
            if now < valid_from:
                CONNECT_METRICS["token_blocked_not_yet_valid"] += 1
                raise HTTPException(status_code=403, detail=json.dumps({
                    "error": "grant_not_yet_valid",
                    "message": "Grant is not yet valid",
                    "valid_from": grant.valid_from,
                }))
        
        if grant.valid_until:
            valid_until = datetime.fromisoformat(grant.valid_until.replace('Z', '+00:00'))
            if now > valid_until:
                CONNECT_METRICS["token_blocked_expired"] += 1
                raise HTTPException(status_code=403, detail=json.dumps({
                    "error": "grant_expired",
                    "message": "Grant validity window has passed",
                    "grant_id": grant.id,
                    "valid_until": grant.valid_until,
                }))
        if grant.max_uses is not None and grant.use_count >= grant.max_uses:
            CONNECT_METRICS["token_blocked_exhausted"] += 1
            raise HTTPException(status_code=403, detail=json.dumps({
                "error": "grant_exhausted",
                "message": "Grant has reached max uses",
                "grant_id": grant.id,
            }))
        # P2 enforcement: resource_filters is stored JSON, validate shape
        if grant.resource_filters is not None:
            rf = grant.resource_filters
            if not isinstance(rf, dict):
                CONNECT_METRICS["token_blocked_bad_filter"] += 1
                raise HTTPException(status_code=400, detail=json.dumps({"error": "invalid_resource_filters", "grant_id": grant.id}))
            # minimal shape check — github repos must be list of strings if present
            gh = rf.get("github")
            if gh is not None:
                if not isinstance(gh, dict) or not isinstance(gh.get("repos", []), list):
                    CONNECT_METRICS["token_blocked_bad_filter"] += 1
                    raise HTTPException(status_code=400, detail=json.dumps({"error": "invalid_resource_filters", "grant_id": grant.id}))
        
        t0 = time.monotonic()
        result["grant_access_token"] = _build_grant_access_token(
            jwt_secret,
            grant=grant,
            task_id=req.task_id,
            workflow_run_id=req.workflow_run_id,
            workspace_project_id=req.workspace_project_id,
        )
        result["grant_access_expires_in"] = GRANT_ACCESS_TTL_MINUTES * 60
        if grant.max_uses is not None:
            await grant_model.update_grant(grant.id, {"use_count": grant.use_count + 1})
        CONNECT_METRICS["token_issued"] += 1
        CONNECT_LATENCY.append(time.monotonic() - t0)
        if len(CONNECT_LATENCY) > 1000:
            CONNECT_LATENCY[:] = CONNECT_LATENCY[-1000:]
        # NEW: Echo agentic context and approval info in response (P0/P1)
        result["task_id"] = req.task_id
        result["workflow_run_id"] = req.workflow_run_id
        result["agent_id"] = req.agent_id
        result["approval_status"] = grant.approval_status
        result["valid_from"] = grant.valid_from
        result["valid_until"] = grant.valid_until
        result["seconds_until_expiration"] = _seconds_until(grant.valid_until)
        if req.grant_id:
            result["scopes"] = grant.scopes

    await _audit(
        audit_model,
        event_type=ConnectAuditEventType.TOKEN_EXCHANGED,
        actor_type=ConnectAuditActorType.DEVELOPER,
        actor_id=developer_user_id,
        connect_app_id=app.id,
        resource_type=ConnectResourceType.CONNECT_TOKEN,
        resource_id=result.get("grant_id"),
        metadata={
            "task_id": req.task_id,
            "workflow_run_id": req.workflow_run_id,
            "workspace_project_id": req.workspace_project_id,
            "agent_id": req.agent_id,
            "grant_id": result.get("grant_id"),
            "connection_id": result.get("connection_id"),
            "connect_user_id": result.get("connect_user_id"),
        },
    )
    
    return success(result, message="Connect token exchanged")


async def list_connect_providers() -> dict:
    return success(list_providers_catalog())


async def get_grant_context(
    grant_model: ConnectGrantModel,
    connection_model: ConnectConnectionModel,
    grant_access_token: str,
    jwt_secret: str,
) -> tuple[ConnectGrantRow, ConnectConnectionRow]:
    payload = _parse_grant_access_token(grant_access_token.strip(), jwt_secret)
    grant = await grant_model.find_by_id(str(payload["grant_id"]))
    if grant is None or grant.status.value != "active":
        raise HTTPException(status_code=401, detail="Grant is not active")
    if grant.connect_app_id != payload.get("app_id"):
        raise HTTPException(status_code=401, detail="Grant access token mismatch")
    if grant.connect_user_id != payload.get("connect_user_id"):
        raise HTTPException(status_code=401, detail="Grant access token mismatch")
    if grant.connection_id != payload.get("connection_id"):
        raise HTTPException(status_code=401, detail="Grant access token mismatch")

    connection = await connection_model.find_by_id(grant.connection_id)
    if connection is None or connection.status.value != "active":
        raise HTTPException(status_code=404, detail="Connection not found")

    return grant, connection


async def get_current_grant(
    grant_model: ConnectGrantModel,
    connection_model: ConnectConnectionModel,
    grant_access_token: str,
    jwt_secret: str,
) -> dict:
    grant, connection = await get_grant_context(
        grant_model,
        connection_model,
        grant_access_token,
        jwt_secret,
    )
    return success(
        {
            "grant_id": grant.id,
            "connect_user_id": grant.connect_user_id,
            "connection_id": connection.id,
            "provider": connection.provider,
            "scopes": grant.scopes,
            "account_label": connection.provider_account_label,
            "status": grant.status.value,
        }
    )


async def list_connect_app_grants(
    app_model: ConnectAppModel,
    grant_model: ConnectGrantModel,
    developer_user_id: str,
    app_id: str,
) -> dict:
    app = await _get_owned_app(app_model, developer_user_id, app_id)
    grants = await grant_model.list_by_connect_app_id(app.id)
    items = [
        {
            "id": grant.id,
            "connect_user_id": grant.connect_user_id,
            "connection_id": grant.connection_id,
            "scopes": grant.scopes,
            "status": grant.status.value,
            "granted_at": grant.granted_at,
        }
        for grant in grants
    ]
    return success(items, meta={"total": len(items), "app_id": app.id})


async def list_audit_events(
    audit_model: ConnectAuditEventModel,
    app_model: ConnectAppModel,
    developer_user_id: str,
    event_type: str | None = None,
    app_id: str | None = None,
    connect_user_id: str | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    # Scope strictly to apps owned by this developer (prevents cross-tenant reads)
    owned_apps = await app_model.list_by_developer_user_id(developer_user_id)
    owned_ids = [app.id for app in owned_apps]
    if app_id is not None:
        if app_id not in owned_ids:
            raise HTTPException(status_code=404, detail="Connect app not found")
        owned_ids = [app_id]
    rows, total = await audit_model.list_all(
        app_ids=owned_ids,
        event_type=event_type,
        app_id=app_id,
        connect_user_id=connect_user_id,
        search=search,
        limit=limit,
        offset=offset,
    )
    items = [
        {
            "id": r.id,
            "event_type": r.event_type,
            "actor_type": r.actor_type.value if hasattr(r.actor_type, 'value') else str(r.actor_type),
            "actor_id": r.actor_id,
            "connect_app_id": r.connect_app_id,
            "connect_user_id": r.connect_user_id,
            "resource_type": r.resource_type,
            "resource_id": r.resource_id,
            "metadata": r.metadata,
            "created_at": r.created_at,
        }
        for r in rows
    ]
    return success(items, meta={"total": total, "limit": limit, "offset": offset})


# ============================================================================
# Agentic Connect Layer (P0/P1): Task-aware grants with approval gating
# ============================================================================


async def list_grants_by_agent_id(
    grant_model: ConnectGrantModel,
    connect_user_id: str,
    agent_id: str,
    page: int = 1,
    limit: int = 50,
) -> dict:
    """Query grants by agent_id with pagination."""
    offset = (page - 1) * limit
    grants = await grant_model.find_by_agent_id(
        connect_user_id, agent_id, limit=limit, offset=offset
    )
    total = await grant_model.count_by_agent_id(connect_user_id, agent_id)
    
    items = [
        {
            "id": g.id,
            "provider": g.connection.provider if hasattr(g, 'connection') else None,
            "scopes": g.scopes,
            "approval_status": g.approval_status,
            "agent_id": g.agent_id,
            "created_by_task_id": g.created_by_task_id,
            "created_by_workflow_run_id": g.created_by_workflow_run_id,
            "created_at": g.created_at,
            "expires_at": None,  # From connection
            "valid_from": g.valid_from,
            "valid_until": g.valid_until,
            "seconds_until_expiration": _seconds_until(g.valid_until),
            "status": g.status.value if hasattr(g.status, 'value') else str(g.status),
        }
        for g in grants
    ]
    return success(items, meta={
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit,
    })


async def list_grants_by_task_id(
    grant_model: ConnectGrantModel,
    connect_user_id: str,
    task_id: str,
    page: int = 1,
    limit: int = 50,
) -> dict:
    """Query grants by task_id with pagination."""
    offset = (page - 1) * limit
    grants = await grant_model.find_by_task_id(
        connect_user_id, task_id, limit=limit, offset=offset
    )
    total = await grant_model.count_by_task_id(connect_user_id, task_id)
    
    items = [
        {
            "id": g.id,
            "provider": g.connection.provider if hasattr(g, 'connection') else None,
            "scopes": g.scopes,
            "approval_status": g.approval_status,
            "agent_id": g.agent_id,
            "created_by_task_id": g.created_by_task_id,
            "created_by_workflow_run_id": g.created_by_workflow_run_id,
            "created_at": g.created_at,
            "expires_at": None,  # From connection
            "valid_from": g.valid_from,
            "valid_until": g.valid_until,
            "seconds_until_expiration": _seconds_until(g.valid_until),
            "status": g.status.value if hasattr(g.status, 'value') else str(g.status),
        }
        for g in grants
    ]
    return success(items, meta={
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit,
    })


async def list_grants_by_workflow_run_id(
    grant_model: ConnectGrantModel,
    connect_user_id: str,
    workflow_run_id: str,
    page: int = 1,
    limit: int = 50,
) -> dict:
    """Query grants by workflow_run_id with pagination."""
    offset = (page - 1) * limit
    grants = await grant_model.find_by_workflow_run_id(
        connect_user_id, workflow_run_id, limit=limit, offset=offset
    )
    total = await grant_model.count_by_workflow_run_id(connect_user_id, workflow_run_id)
    
    items = [
        {
            "id": g.id,
            "provider": g.connection.provider if hasattr(g, 'connection') else None,
            "scopes": g.scopes,
            "approval_status": g.approval_status,
            "agent_id": g.agent_id,
            "created_by_task_id": g.created_by_task_id,
            "created_by_workflow_run_id": g.created_by_workflow_run_id,
            "created_at": g.created_at,
            "expires_at": None,  # From connection
            "valid_from": g.valid_from,
            "valid_until": g.valid_until,
            "seconds_until_expiration": _seconds_until(g.valid_until),
            "status": g.status.value if hasattr(g.status, 'value') else str(g.status),
        }
        for g in grants
    ]
    return success(items, meta={
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit,
    })


async def approve_grant(
    grant_model: ConnectGrantModel,
    audit_model: ConnectAuditEventModel,
    grant_id: str,
    approved_by_user_id: str,
    approval_reason: str | None = None,
    env = None,
) -> dict:
    """Approve a pending grant."""
    grant = await grant_model.find_by_id(grant_id)
    if grant is None:
        raise HTTPException(status_code=404, detail=json.dumps({
            "error": "grant_not_found",
            "message": f"No grant found with id: {grant_id}",
            "grant_id": grant_id,
        }))
    if env is not None:
        from db.connect_orm import ConnectAppModel
        app = await ConnectAppModel(env.DB).find_by_id(grant.connect_app_id)
        if not app or app.developer_user_id != approved_by_user_id:
            raise HTTPException(status_code=403, detail=json.dumps({
                "error": "unauthorized",
                "message": "Only the app owner can approve this grant",
                "grant_id": grant_id,
            }))
    
    # Can only approve pending grants
    if grant.approval_status != "pending_approval":
        raise HTTPException(status_code=409, detail=json.dumps({
            "error": "grant_invalid_state",
            "message": f"Grant state is {grant.approval_status}, not pending_approval",
            "grant_id": grant_id,
        }))
    
    # Update grant to approved (SIMPLIFIED: only update approval_status)
    now = utc_now_iso()
    await grant_model.update_grant(
        grant_id,
        {
            "approval_status": "approved",
        }
    )
    
    # Audit the approval with full agentic context
    await _audit(
        audit_model,
        event_type=ConnectAuditEventType.GRANT_APPROVED,
        actor_type=ConnectAuditActorType.CONNECT_USER,
        actor_id=approved_by_user_id,
        connect_app_id=grant.connect_app_id,
        resource_type=ConnectResourceType.CONNECT_GRANT,
        resource_id=grant_id,
        agent_id=grant.agent_id,
        task_id=grant.created_by_task_id,
        workflow_run_id=grant.created_by_workflow_run_id,
        result="success",
        metadata={
            "approval_reason": approval_reason or "Grant approved",
            "approved_at": now,
        },
    )
    if env and hasattr(env, "TASK_QUEUE"):
        from db.orm import TaskModel
        task_model = TaskModel(env.DB)
        waiting = await task_model.find_many("tasks", "connect_grant_id = ? AND status = ?", grant_id, "waiting_for_grant")
        for t in waiting:
            await task_model.update("tasks", "id = ?", {"status": "queued", "updated_at": now}, t["id"])
            await env.TASK_QUEUE.send({"task_id": t["id"]})
    
    # Return updated grant
    updated_grant = await grant_model.find_by_id(grant_id)
    return success({
        "id": updated_grant.id,
        "approval_status": updated_grant.approval_status,
        "message": "Grant approved successfully",
    })


async def deny_grant(
    grant_model: ConnectGrantModel,
    audit_model: ConnectAuditEventModel,
    grant_id: str,
    denied_by_user_id: str,
    denial_reason: str,
    env = None,
) -> dict:
    """Deny a grant request."""
    grant = await grant_model.find_by_id(grant_id)
    if grant is None:
        raise HTTPException(status_code=404, detail=json.dumps({
            "error": "grant_not_found",
            "message": f"No grant found with id: {grant_id}",
            "grant_id": grant_id,
        }))
    
    if env is not None:
        from db.connect_orm import ConnectAppModel
        app = await ConnectAppModel(env.DB).find_by_id(grant.connect_app_id)
        if not app or app.developer_user_id != denied_by_user_id:
            raise HTTPException(status_code=403, detail=json.dumps({
                "error": "unauthorized",
                "message": "Only the app owner can deny this grant",
                "grant_id": grant_id,
            }))
    if grant.approval_status != "pending_approval":
        raise HTTPException(status_code=409, detail=json.dumps({
            "error": "grant_invalid_state",
            "message": f"Cannot deny grant in state {grant.approval_status}",
            "grant_id": grant_id,
        }))
    
    # Update grant to denied (SIMPLIFIED: only update approval_status)
    now = utc_now_iso()
    await grant_model.update_grant(
        grant_id,
        {
            "approval_status": "denied",
        }
    )
    
    # Audit the denial with full agentic context (decision metadata stored here)
    await _audit(
        audit_model,
        event_type=ConnectAuditEventType.GRANT_DENIED,
        actor_type=ConnectAuditActorType.CONNECT_USER,
        actor_id=denied_by_user_id,
        connect_app_id=grant.connect_app_id,
        resource_type=ConnectResourceType.CONNECT_GRANT,
        resource_id=grant_id,
        agent_id=grant.agent_id,
        task_id=grant.created_by_task_id,
        workflow_run_id=grant.created_by_workflow_run_id,
        denial_reason=denial_reason,
        result="success",
        metadata={
            "reason": denial_reason,
            "denied_at": now,
        },
    )
    if env and hasattr(env, "TASK_QUEUE"):
        from db.orm import TaskModel
        task_model = TaskModel(env.DB)
        waiting = await task_model.find_many("tasks", "connect_grant_id = ? AND status = ?", grant_id, "waiting_for_grant")
        for t in waiting:
            await task_model.update("tasks", "id = ?", {"status": "failed", "updated_at": now}, t["id"])
    
    # Return updated grant
    updated_grant = await grant_model.find_by_id(grant_id)
    return success({
        "id": updated_grant.id,
        "approval_status": updated_grant.approval_status,
        "message": "Grant denied successfully",
    })


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


async def get_connect_metrics(env, workspace_user_id: str):
    """Get Connect metrics: pending approvals and recent token requests."""
    from db.client import get_db_client
    from utils.responses import success
    
    db = get_db_client(env)
    grant_model = ConnectGrantModel(db)
    audit_model = ConnectAuditEventModel(db)
    
    # Count pending approvals
    pending_grants = await grant_model.find_by_approval_status("pending_approval")
    pending_count = len(pending_grants)
    
    # Count token exchange events in last 24 hours
    twenty_four_hours_ago = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    
    # Query all token exchange events (no app filtering - get all)
    token_events, _ = await audit_model.list_all(
        event_type=ConnectAuditEventType.TOKEN_EXCHANGED,
        app_ids=None,  # no filtering by app
        limit=1000,
    )
    
    # Filter events from last 24 hours
    recent_tokens = [
        e for e in token_events 
        if e.created_at and e.created_at >= twenty_four_hours_ago
    ]
    
    p50 = sorted(CONNECT_LATENCY)[len(CONNECT_LATENCY)//2] if CONNECT_LATENCY else 0
    p99 = sorted(CONNECT_LATENCY)[int(len(CONNECT_LATENCY)*0.99)] if CONNECT_LATENCY else 0
    return success({
        "pending_approvals": pending_count,
        "token_requests_24h": len(recent_tokens),
        "metrics": dict(CONNECT_METRICS),
        "latency_p50_ms": round(p50*1000, 2),
        "latency_p99_ms": round(p99*1000, 2),
    })
