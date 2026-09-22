import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from db.connect_orm import (
    ConnectAppModel,
    ConnectAppUserModel,
    ConnectAuditEventModel,
    ConnectConnectionModel,
    ConnectIdentityModel,
    ConnectOtpChallengeModel,
    ConnectSessionModel,
    ConnectUserModel,
)
from utils.connect_account import (
    OTP_MAX_ATTEMPTS,
    generate_otp_code,
    hash_connect_secret,
    is_valid_email,
    normalize_email,
    otp_expires_at,
    send_connect_otp_email,
)
from utils.connect_providers import (
    OAUTH_ENABLED_PROVIDERS,
    normalize_requested_scopes,
    parse_connect_provider,
    validate_provider_allowed,
)
from utils.connect_crypto import encrypt_connect_secret
from utils.rate_limit import enforce_rate_limit
from utils.responses import success
from utils.types import (
    ConnectAuditActorType,
    ConnectAuditEventType,
    ConnectConnectionCreate,
    ConnectConnectionStatus,
    ConnectConnectionUpdate,
    ConnectIdentityCreate,
    ConnectIdentityProvider,
    ConnectIdentityRow,
    ConnectOtpChallengeCreate,
    ConnectOtpResendRequest,
    ConnectOtpStatus,
    ConnectOtpVerifyRequest,
    ConnectResourceType,
    ConnectSessionCreate,
    ConnectSessionCreateRequest,
    ConnectSessionMode,
    ConnectSessionRow,
    ConnectSessionStatus,
    utc_now_iso,
)

from services.connect_common import (
    OTP_ISSUE_MAX_PER_HOUR,
    OTP_ISSUE_WINDOW_START,
    SESSION_TTL_MINUTES,
    VALID_SESSION_MODES,
    _attach_session_connect_user,
    _audit,
    _find_connect_user_by_verified_email,
    _find_or_create_connect_user_by_email,
    _get_owned_app,
    _issue_connect_code,
    _require_authenticated_app_user,
    _serialize_session,
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
    workspace_id: str | None = None,
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
                workspace_id=workspace_id or existing.workspace_id,
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
            workspace_id=workspace_id,
        )
    )
    return connection.id


async def list_workspace_connections(
    connection_model: ConnectConnectionModel,
    user_model: ConnectUserModel,
    workspace_id: str,
    *,
    provider: str | None = None,
    status: str | None = None,
    page: int = 1,
    limit: int = 50,
) -> dict:
    """Workspace-wide connection list. Who authorized which account."""
    offset = (page - 1) * limit
    connections = await connection_model.list_by_workspace(
        workspace_id, provider=provider or None, status=status or None, limit=limit, offset=offset
    )
    total = await connection_model.count_by_workspace(
        workspace_id, provider=provider or None, status=status or None
    )
    user_ids = list({c.connect_user_id for c in connections})
    user_labels: dict[str, str] = {}
    for user_id in user_ids:
        user = await user_model.find_by_id(user_id)
        if user is not None and user.primary_email:
            user_labels[user_id] = user.primary_email
    items = [
        {
            "id": c.id,
            "connect_user_id": c.connect_user_id,
            "user": user_labels.get(c.connect_user_id)
            or c.provider_account_label
            or c.connect_user_id[:8],
            "provider": c.provider,
            "account": c.provider_account_label,
            "scopes": c.scopes,
            "status": c.status.value if hasattr(c.status, "value") else str(c.status),
            "created_at": c.created_at,
        }
        for c in connections
    ]
    return success(items, meta={
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if limit else 0,
    })


async def _complete_session(
    session_model: ConnectSessionModel,
    session: ConnectSessionRow,
    connect_user_id: str,
) -> None:
    await session_model.complete(session.id, connect_user_id)


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
    workspace_id: str,
) -> dict:
    mode_value = req.mode.strip().lower()
    if mode_value not in VALID_SESSION_MODES:
        raise HTTPException(status_code=400, detail="invalid connect session mode")
    mode = ConnectSessionMode(mode_value)

    from services.connect_apps import ensure_workspace_app
    app = await ensure_workspace_app(app_model, workspace_id, developer_user_id)
    if app.status.value != "active":
        raise HTTPException(status_code=403, detail="Connect is disabled for this workspace")

    # No per-app allowlist anymore (the app is auto-provisioned config).
    # Require https (or localhost for dev) so codes can't leak to plain http.
    redirect_uri = req.redirect_uri.strip()
    lowered = redirect_uri.lower()
    if not (
        lowered.startswith("https://")
        or lowered.startswith("http://localhost")
        or lowered.startswith("http://127.0.0.1")
    ):
        raise HTTPException(status_code=400, detail="redirect_uri must be https (or localhost)")

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
            workspace_id=workspace_id,
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
        workspace_id=workspace_id,
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


