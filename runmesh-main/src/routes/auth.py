import secrets

import string

import uuid

from datetime import (
    datetime,
    timedelta,
    timezone,
)

from db.orm import UserModel

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
)

from services.github import (
    exchange_code_for_token,
    fetch_github_user,
    fetch_primary_email,
    find_or_create_user,
    github_callback_redirect_uri,
)

from starlette.responses import (
    HTMLResponse,
    RedirectResponse,
)

from typing import Optional

from utils.auth import (
    AUTH_CODE_TTL_SECONDS,
    CLI_TOKEN_TTL_SECONDS,
    SESSION_TOKEN_TTL_SECONDS,
    build_oauth_state,
    decode_token,
    encode_token,
    parse_oauth_state,
)

from utils.dual_auth import get_jwt_user

from utils.rate_limit import (
    enforce_rate_limit,
    get_client_ip,
)

from utils.responses import success

router = APIRouter()


@router.post("/auth/cli/start")
async def cli_auth_start(request: Request):
    env = request.scope["env"]
    await enforce_rate_limit(
        env.DB, f"cli-start:{get_client_ip(request)}",
        limit=10, window_seconds=600, detail="Too many login attempts. Try again later.",
    )
    device_code = secrets.token_urlsafe(32)
    user_code = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))
    user_code = f"{user_code[:4]}-{user_code[4:]}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    code_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    await env.DB.prepare("""
        INSERT INTO cli_auth_codes (id, device_code, user_code, status, expires_at, created_at)
        VALUES (?, ?, ?, 'pending', ?, ?)
    """).bind(code_id, device_code, user_code, expires_at.isoformat(), now).run()
    frontend_url = getattr(env, "FRONTEND_URL", str(request.base_url).rstrip("/"))
    return success({
        "device_code": device_code,
        "user_code": user_code,
        "verification_uri": f"{frontend_url}/cli/verify?code={user_code}",
        "expires_in": 600,
    })


def _to_dict(row):
    if hasattr(row, 'as_py'):
        return row.as_py()
    if hasattr(row, 'to_py'):
        return row.to_py()
    if isinstance(row, dict):
        return row
    return dict(row)


@router.post("/auth/cli/confirm")
async def cli_auth_confirm(request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    body = await request.json()
    user_code = body.get("user_code", "").strip()
    row = await env.DB.prepare("""
        SELECT * FROM cli_auth_codes WHERE user_code = ? AND status = 'pending'
    """).bind(user_code).first()
    if not row:
        raise HTTPException(status_code=404, detail="Invalid or expired code")
    r = _to_dict(row)
    expires_at = datetime.fromisoformat(r["expires_at"].replace("Z", "+00:00"))
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Code expired")
    now = datetime.now(timezone.utc).isoformat()
    await env.DB.prepare("""
        UPDATE cli_auth_codes SET status = 'confirmed', user_id = ?, confirmed_at = ?
        WHERE user_code = ?
    """).bind(current_user["id"], now, user_code).run()
    return success({"status": "confirmed"})


@router.post("/auth/cli/poll")
async def cli_auth_poll(request: Request):
    env = request.scope["env"]
    body = await request.json()
    device_code = body.get("device_code", "").strip()
    await enforce_rate_limit(
        env.DB, f"cli-poll:{device_code}",
        limit=240, window_seconds=600, detail="Polling too frequently. Slow down.",
    )
    row = await env.DB.prepare("""
        SELECT * FROM cli_auth_codes WHERE device_code = ?
    """).bind(device_code).first()
    if not row:
        raise HTTPException(status_code=404, detail="Invalid device code")
    r = _to_dict(row)
    if r["status"] == "pending":
        expires_at = datetime.fromisoformat(r["expires_at"].replace("Z", "+00:00"))
        if expires_at <= datetime.now(timezone.utc):
            return success({"status": "expired"})
        return success({"status": "pending"})
    if r["status"] == "confirmed":
        user_model = UserModel(env.DB)
        user = await user_model.find_by_id(r["user_id"])
        token = encode_token(
            {"id": user["id"], "email": user["email"], "name": user["name"]},
            env.JWT_SECRET,
            ttl_seconds=CLI_TOKEN_TTL_SECONDS,
        )
        await env.DB.prepare("DELETE FROM cli_auth_codes WHERE device_code = ?").bind(device_code).run()
        return success({
            "status": "confirmed",
            "token": token,
            "user": {"id": user["id"], "email": user["email"], "name": user["name"]},
        })
    raise HTTPException(status_code=400, detail="Invalid state")


@router.get("/cli/verify")
async def cli_verify_page(code: str, request: Request):
    env = request.scope["env"]
    row = await env.DB.prepare("""
        SELECT * FROM cli_auth_codes WHERE user_code = ? AND status = 'pending'
    """).bind(code).first()
    if not row:
        return HTMLResponse(content="""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Invalid Code — Runmesh</title><style>body{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;background:#08090a;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh}main{max-width:440px;padding:40px;text-align:center}h1{font-size:24px}p{color:#969799}</style>
</head><body><main><h1>Code invalid or expired</h1><p>This verification code was not found or has expired. Please run <code>runmesh login</code> again.</p></main></body></html>""")
    r = _to_dict(row)
    base_url = str(request.base_url).rstrip("/")
    # Escape every interpolated value (defense-in-depth against HTML/JS injection)
    from html import escape as _esc
    from urllib.parse import quote as _quote
    safe_base_url = _esc(base_url, quote=True)
    safe_user_code = _esc(str(r["user_code"]), quote=True)
    safe_code_html = _esc(code, quote=True)
    safe_code_url = _quote(code, safe="")
    html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Confirm CLI Login — Runmesh</title>
<style>
  body{{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;background:#08090a;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh}}
  main{{max-width:480px;padding:40px;text-align:center}}
  .code{{font-family:ui-monospace,monospace;font-size:36px;letter-spacing:0.15em;background:#1c1c1c;padding:20px 28px;border-radius:12px;display:inline-block;margin:24px 0;border:1px solid #23252a}}
  .btn{{display:inline-block;height:44px;line-height:44px;padding:0 32px;border:none;border-radius:8px;background:#f2f2f2;color:#08090a;font-size:15px;font-weight:500;cursor:pointer;text-decoration:none}}
  .btn:hover{{background:#fff}}
  .btn:disabled{{opacity:0.5;cursor:default}}
  p{{color:#969799;line-height:1.5;margin:8px 0}}
  h1{{font-size:24px;font-weight:600;margin:0 0 8px}}
  .status{{margin-top:16px;font-size:14px}}
</style>
</head>
<body>
  <main>
    <h1>Confirm CLI Login</h1>
    <p>A CLI session is requesting access to your Runmesh account.</p>
    <div class="code">{safe_user_code}</div>
    <p style="font-size:13px;color:#595a5c">If this code matches your terminal, click Confirm.</p>
    <div id="auth-section">
      <a href="{safe_base_url}/auth/github/login?redirect_to=/cli/verify%3Fcode%3D{safe_code_url}" class="btn" id="login-btn">Sign in with GitHub</a>
    </div>
    <div id="confirm-section" style="display:none">
      <button class="btn" id="confirm-btn" onclick="confirmLogin()">Confirm</button>
    </div>
    <p class="status" id="status"></p>
  </main>
  <script>
    var token = localStorage.getItem('runmesh-token');
    if (token) {{
      document.getElementById('auth-section').style.display = 'none';
      document.getElementById('confirm-section').style.display = 'block';
    }}
    function confirmLogin() {{
      var token = localStorage.getItem('runmesh-token');
      if (!token) {{ document.getElementById('status').textContent = 'Please sign in first'; return; }}
      document.getElementById('confirm-btn').disabled = true;
      fetch('{safe_base_url}/auth/cli/confirm', {{
        method: 'POST',
        headers: {{'Content-Type':'application/json','Authorization':'Bearer '+token}},
        body: JSON.stringify({{user_code:'{safe_code_html}'}})
      }}).then(function(r){{return r.json()}}).then(function(d){{
        if(d.ok){{document.getElementById('status').textContent = 'Confirmed! You can close this tab.';}}
        else{{document.getElementById('status').textContent = 'Error: '+(d.error?.message||'failed');document.getElementById('confirm-btn').disabled=false;}}
      }})
    }}
  </script>
</body></html>"""
    return HTMLResponse(content=html)


# GitHub OAuth
@router.get("/auth/github/login")
async def github_login(request: Request, redirect_to: Optional[str] = None):
    env = request.scope["env"]
    await enforce_rate_limit(
        env.DB, f"github-login:{get_client_ip(request)}",
        limit=30, window_seconds=600, detail="Too many login attempts. Try again later.",
    )
    redirect_uri = github_callback_redirect_uri(env, str(request.base_url))
    from urllib.parse import quote
    encoded_redirect = quote(redirect_uri, safe="")
    # Signed, short-lived state nonce — the frontend stores it and compares it
    # after the callback, which blocks OAuth login CSRF.
    state = build_oauth_state(env.JWT_SECRET, redirect_to or "")
    return success({
        "url": f"https://github.com/login/oauth/authorize?client_id={env.GITHUB_CLIENT_ID}&redirect_uri={encoded_redirect}&scope=user:email&state={quote(state, safe='')}",
        "state": state,
    })


@router.get("/auth/github/callback")
async def github_callback(code: str, request: Request, state: Optional[str] = ""):
    env = request.scope["env"]
    await enforce_rate_limit(
        env.DB, f"github-callback:{get_client_ip(request)}",
        limit=30, window_seconds=600, detail="Too many login attempts. Try again later.",
    )
    redirect_uri = github_callback_redirect_uri(env, str(request.base_url))

    state_payload = parse_oauth_state(env.JWT_SECRET, state)
    if state_payload is None:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")

    try:
        access_token = await exchange_code_for_token(env, code, redirect_uri)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        github_user = await fetch_github_user(access_token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        github_id = str(github_user["id"])
        name = github_user.get("name") or github_user["login"]
        avatar_url = github_user.get("avatar_url", "")
        # Only verified emails may be used for account matching — the public
        # profile email from /user is unverified and must not be trusted.
        github_email = await fetch_primary_email(access_token)

        user_id = await find_or_create_user(env.DB, github_id, name, avatar_url, github_email, github_user["login"])
        # Short-lived, single-purpose code — the frontend exchanges it for a
        # session token via POST /auth/exchange so the credential never sits in
        # a URL longer than necessary.
        auth_code = encode_token(
            {"type": "auth_code", "id": user_id},
            env.JWT_SECRET,
            ttl_seconds=AUTH_CODE_TTL_SECONDS,
        )
        frontend_url = getattr(env, "FRONTEND_URL", str(request.base_url).replace("/auth/github/callback", ""))
        from urllib.parse import quote
        callback_url = f"{frontend_url}/auth/callback?code={quote(auth_code, safe='')}&state={quote(state, safe='')}"
        redirect_to = state_payload.get("redirect_to") or ""
        if redirect_to:
            callback_url += f"&redirect_to={quote(redirect_to, safe='')}"
        return RedirectResponse(url=callback_url)
    except HTTPException:
        raise
    except Exception as e:
        print(f"GitHub callback error: {e}")
        raise HTTPException(status_code=500, detail="Failed to complete GitHub login")


@router.post("/auth/exchange")
async def auth_exchange(request: Request):
    """Swap a short-lived auth code (from the OAuth callback) for a session token."""
    env = request.scope["env"]
    await enforce_rate_limit(
        env.DB, f"auth-exchange:{get_client_ip(request)}",
        limit=30, window_seconds=600, detail="Too many attempts. Try again later.",
    )
    body = await request.json()
    code = str(body.get("code", "")).strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    payload = decode_token(code, env.JWT_SECRET)
    if not payload or payload.get("type") != "auth_code":
        raise HTTPException(status_code=401, detail="Invalid or expired auth code")
    user_model = UserModel(env.DB)
    user = await user_model.find_by_id(str(payload["id"]))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    token = encode_token(
        {"id": user["id"], "email": user["email"], "name": user["name"]},
        env.JWT_SECRET,
        ttl_seconds=SESSION_TOKEN_TTL_SECONDS,
    )
    return success({
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "name": user["name"]},
    })


# Workspace API
