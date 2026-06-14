import json
from urllib.parse import urlencode

from workers import fetch

from utils.connect_providers import (
    ConnectProvider,
    oauth_needs_offline_access,
    resolve_oauth_scopes,
)
from utils.types import ConnectSessionMode

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
def connect_callback_uri(public_base_url: str) -> str:
    return f"{public_base_url.rstrip('/')}/connect/callback"


def build_google_authorize_url(
    env,
    public_base_url: str,
    session_state: str,
    mode: ConnectSessionMode,
    requested_scopes: list[str],
) -> str:
    redirect_uri = connect_callback_uri(public_base_url)
    google_scopes = resolve_oauth_scopes(ConnectProvider.GOOGLE, mode, requested_scopes)
    params = {
        "client_id": env.GOOGLE_CONNECT_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(google_scopes),
        "state": session_state,
        "include_granted_scopes": "true",
    }
    if oauth_needs_offline_access(ConnectProvider.GOOGLE, mode):
        params["access_type"] = "offline"
        params["prompt"] = "consent"
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


async def exchange_google_code(env, code: str, public_base_url: str) -> dict:
    redirect_uri = connect_callback_uri(public_base_url)
    token_resp = await fetch(
        GOOGLE_TOKEN_URL,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        body=urlencode({
            "code": code,
            "client_id": env.GOOGLE_CONNECT_CLIENT_ID,
            "client_secret": env.GOOGLE_CONNECT_CLIENT_SECRET,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }),
    )
    token_text = await token_resp.text()
    try:
        token_data = json.loads(token_text)
    except Exception:
        token_data = {}
    if not token_data.get("access_token"):
        message = token_data.get("error_description") or token_data.get("error") or "unknown"
        raise ValueError(f"Google token exchange failed: {message}")
    return token_data


async def fetch_google_provider_account(access_token: str) -> dict:
    from urllib.parse import quote

    resp = await fetch(
        f"https://www.googleapis.com/oauth2/v1/tokeninfo?access_token={quote(access_token)}",
    )
    text = await resp.text()
    try:
        data = json.loads(text)
    except Exception:
        raise ValueError("Failed to parse Google token info")
    if resp.status != 200:
        message = data.get("error_description") or data.get("error") or "invalid_token"
        raise ValueError(f"Google token info failed: {message}")
    user_id = str(data.get("user_id", "")).strip()
    if not user_id:
        raise ValueError("Google token info is missing user_id")
    return {
        "sub": user_id,
        "email": data.get("email"),
        "email_verified": bool(data.get("verified_email")),
    }


async def fetch_google_userinfo(access_token: str) -> dict:
    user_resp = await fetch(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    user_text = await user_resp.text()
    try:
        return json.loads(user_text)
    except Exception:
        raise ValueError("Failed to fetch Google user info")
