import hashlib
import json
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request
from starlette.responses import Response
from workers import fetch

CONNECT_ACCOUNT_COOKIE = "rm_connect_account"
CONNECT_ACCOUNT_TTL_DAYS = 30
OTP_TTL_MINUTES = 10
OTP_LENGTH = 6
OTP_MAX_ATTEMPTS = 5
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@dataclass
class ConnectRedirect:
    url: str
    connect_user_id: str | None = None
    account_token: str | None = None


def normalize_email(email: str) -> str:
    return email.strip().lower()


def is_valid_email(email: str) -> bool:
    return bool(EMAIL_PATTERN.match(normalize_email(email)))


def hash_connect_secret(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def generate_otp_code() -> str:
    return "".join(str(secrets.randbelow(10)) for _ in range(OTP_LENGTH))


def issue_account_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(32)
    return raw, hash_connect_secret(raw)


def account_session_expires_at() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=CONNECT_ACCOUNT_TTL_DAYS)).isoformat()


def otp_expires_at() -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES)).isoformat()


def attach_connect_account_cookie(
    response: Response,
    *,
    token: str,
    secure: bool,
) -> None:
    response.set_cookie(
        key=CONNECT_ACCOUNT_COOKIE,
        value=token,
        httponly=True,
        secure=secure,
        samesite="lax",
        max_age=CONNECT_ACCOUNT_TTL_DAYS * 24 * 60 * 60,
        path="/",
    )


def read_connect_account_token(request: Request) -> str | None:
    value = request.cookies.get(CONNECT_ACCOUNT_COOKIE)
    if not value or not value.strip():
        return None
    return value.strip()


async def send_connect_otp_email(env, to_email: str, code: str) -> None:
    api_key = getattr(env, "RESEND_API_KEY", None)
    from_email = getattr(env, "CONNECT_EMAIL_FROM", "Runmesh Connect <onboarding@resend.dev>")
    if not api_key:
        print(f"[connect-otp] email={to_email} code={code}")
        return
    resp = await fetch(
        "https://api.resend.com/emails",
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        body=json.dumps({
            "from": from_email,
            "to": [to_email],
            "subject": "Your Runmesh Connect code",
            "text": f"Your verification code is {code}. It expires in {OTP_TTL_MINUTES} minutes.",
        }),
    )
    if resp.status >= 400:
        text = await resp.text()
        raise HTTPException(status_code=502, detail=f"Failed to send verification email: {text[:200]}")
