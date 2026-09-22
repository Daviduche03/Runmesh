import json
import time
from datetime import datetime, timedelta, timezone
from html import escape as html_escape

from fastapi import HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse

from db.connect_orm import (
    ConnectAppModel,
    ConnectAppUserModel,
    ConnectAuditEventModel,
    ConnectConnectionModel,
    ConnectGrantModel,
    ConnectIdentityModel,
    ConnectSessionModel,
    ConnectUserModel,
)
from services.google_connect import (
    build_google_authorize_url,
    exchange_google_code,
    fetch_google_provider_account,
)
from utils.connect_account import ConnectRedirect
from utils.connect_providers import (
    ConnectProvider,
    OAUTH_ENABLED_PROVIDERS,
    list_providers_catalog,
)
from utils.responses import success
from utils.types import (
    ConnectAuditActorType,
    ConnectAuditEventType,
    ConnectConnectionStatus,
    ConnectConsentRequest,
    ConnectIdentityProvider,
    ConnectResourceType,
    ConnectSessionMode,
    ConnectSessionRow,
    ConnectSessionStatus,
    ConnectSessionUpdate,
    ConnectTokenRequest,
)

from services.connect_common import (
    CONNECT_LATENCY,
    CONNECT_METRICS,
    GRANT_ACCESS_TTL_MINUTES,
    VALID_CONSENT_ACTIONS,
    _app_redirect_url,
    _attach_session_connect_user,
    _audit,
    _build_grant_access_token,
    _get_owned_app,
    _issue_connect_code,
    _load_pending_session,
    _parse_connect_code,
    _require_authenticated_app_user,
    _require_google_connect_config,
    _seconds_until,
    _session_provider,
)
from services.connect_grants import _ensure_grant
from services.connect_sessions import (
    _complete_session,
    _upsert_connection,
    attach_provider_identity,
)

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
        grant_workspace_id = session.workspace_id
        if not grant_workspace_id:
            raise HTTPException(status_code=400, detail="Connect session has no workspace")
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
            workspace_id=grant_workspace_id,
        )
        grant_id = await _ensure_grant(
            grant_model,
            connect_app_id=session.connect_app_id,
            connect_user_id=connect_user.id,
            connection_id=connection_id,
            scopes=session.scopes,
            workspace_id=grant_workspace_id,
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
            workspace_id=grant_workspace_id,
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
        session_workspace_id = session.workspace_id
        if not session_workspace_id:
            raise HTTPException(status_code=400, detail="Connect session has no workspace")
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
            workspace_id=session_workspace_id,
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
            workspace_id=session.workspace_id,
        )
        return ConnectRedirect(url=_app_redirect_url(session, error="access_denied"))

    provider = _session_provider(session)
    connection = await connection_model.find_by_user_provider(session.connect_user_id, provider.value)
    if connection is None:
        return ConnectRedirect(url=_app_redirect_url(session, error="connection_required"))

    grant_workspace_id = session.workspace_id
    if not grant_workspace_id:
        raise HTTPException(status_code=400, detail="Connect session has no workspace")
    grant_id = await _ensure_grant(
        grant_model,
        connect_app_id=session.connect_app_id,
        connect_user_id=session.connect_user_id,
        connection_id=connection.id,
        scopes=session.scopes or [provider.value],
        workspace_id=grant_workspace_id,
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
            workspace_id=grant_workspace_id,
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
    workspace_id: str,
) -> dict:
    from services.connect_apps import ensure_workspace_app
    app = await ensure_workspace_app(app_model, workspace_id, developer_user_id)

    if req.code:
        payload = _parse_connect_code(req.code, jwt_secret)
        if payload.get("app_id") != app.id:
            raise HTTPException(status_code=400, detail="Connect code does not belong to this app")

        session = await session_model.find_by_id(str(payload["session_id"]))
        if session is None:
            raise HTTPException(status_code=400, detail="Connect session not found")
        if payload.get("workspace_id") != workspace_id or session.workspace_id != workspace_id:
            raise HTTPException(status_code=400, detail="Connect code does not belong to this workspace")
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
        if grant.workspace_id != workspace_id:
            raise HTTPException(status_code=403, detail="Grant does not belong to this workspace")
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
        if grant.workspace_id != workspace_id:
            raise HTTPException(status_code=400, detail="Grant does not belong to this workspace")
        
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
        workspace_id=workspace_id,
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


