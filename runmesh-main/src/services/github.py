import json
from datetime import datetime, timezone
from workers import fetch
from db.orm import UserModel


def github_callback_redirect_uri(env, request_base_url: str) -> str:
    base = getattr(env, "PUBLIC_URL", request_base_url.rstrip("/"))
    return f"{base}/auth/github/callback"


async def exchange_code_for_token(env, code: str, redirect_uri: str) -> str:
    token_resp = await fetch(
        "https://github.com/login/oauth/access_token",
        method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        body=json.dumps({
            "client_id": env.GITHUB_CLIENT_ID,
            "client_secret": env.GITHUB_CLIENT_SECRET,
            "code": code,
            "redirect_uri": redirect_uri,
        }),
    )
    token_text = await token_resp.text()
    token_data = {}
    try:
        token_data = json.loads(token_text)
    except Exception:
        pass
    access_token = token_data.get("access_token")
    if not access_token:
        raise ValueError(f"GitHub token exchange failed: {token_data.get('error_description', token_data.get('error', 'unknown'))}")
    return access_token


async def fetch_github_user(access_token: str) -> dict:
    user_resp = await fetch(
        "https://api.github.com/user",
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json", "User-Agent": "Runmesh"},
    )
    user_text = await user_resp.text()
    try:
        user_data = json.loads(user_text)
    except Exception:
        raise ValueError("Failed to fetch GitHub user info")
    if not isinstance(user_data, dict) or "id" not in user_data:
        raise ValueError("Failed to fetch GitHub user info")
    return user_data


async def fetch_primary_email(access_token: str) -> str:
    emails_resp = await fetch(
        "https://api.github.com/user/emails",
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json", "User-Agent": "Runmesh"},
    )
    emails_text = await emails_resp.text()
    try:
        emails = json.loads(emails_text)
    except Exception:
        return ""
    if not isinstance(emails, list):
        return ""
    for entry in emails:
        if not isinstance(entry, dict):
            continue
        if entry.get("primary") and entry.get("verified"):
            email = entry.get("email")
            if email:
                return email
    for entry in emails:
        if isinstance(entry, dict):
            email = entry.get("email")
            if email:
                return email
    return ""


async def find_or_create_user(db, github_id: str, name: str, avatar_url: str, github_email: str, login: str) -> str:
    user_model = UserModel(db)
    existing = await user_model.find_by_github_id(github_id)

    if existing:
        await user_model.update(
            "users", "id = ?",
            {"name": name, "avatar_url": avatar_url, "updated_at": datetime.now(timezone.utc).isoformat()},
            existing["id"]
        )
        return existing["id"]

    if not github_email:
        github_email = f"{github_id}+{login}@users.noreply.github.com"

    by_email = await user_model.find_by_email(github_email)
    if by_email:
        await user_model.update(
            "users", "id = ?",
            {
                "name": name,
                "avatar_url": avatar_url,
                "github_id": github_id,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            by_email["id"]
        )
        return by_email["id"]

    user_data = {
        "name": name,
        "email": github_email,
        "password": "github_oauth:no_password",
        "github_id": github_id,
        "avatar_url": avatar_url,
    }
    return await user_model.create(user_data)
