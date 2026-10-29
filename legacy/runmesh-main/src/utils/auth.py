import hashlib
import hmac
import json
import base64
import secrets
import time
from datetime import datetime
from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()

# Token lifetimes (seconds)
SESSION_TOKEN_TTL_SECONDS = 24 * 60 * 60          # dashboard session tokens
CLI_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60         # CLI device-flow tokens
AUTH_CODE_TTL_SECONDS = 120                        # one-time code exchanged for a session token
OAUTH_STATE_TTL_SECONDS = 600                      # GitHub OAuth state nonce lifetime


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode()


def _sign(raw: bytes, secret: str) -> bytes:
    return hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest().encode()


def _exp_to_epoch(value) -> float | None:
    """Normalize an exp claim (epoch number or ISO-8601 string) to epoch seconds."""
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if text.isdigit():
            return float(text)
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def encode_token(payload: dict, secret: str, ttl_seconds: int | None = None) -> str:
    """Sign a payload as an HMAC token. Always stamps iat; exp when ttl_seconds is given."""
    body = dict(payload)
    now = int(time.time())
    body.setdefault("iat", now)
    if ttl_seconds is not None:
        body["exp"] = now + int(ttl_seconds)
    raw = json.dumps(body).encode()
    return _b64url_encode(raw + b"." + _sign(raw, secret))


def decode_token(token: str, secret: str, *, require_exp: bool = True) -> dict | None:
    """Verify and decode a token. Expired tokens (and tokens without exp, by default) are rejected."""
    try:
        decoded = base64.urlsafe_b64decode(token.encode())
        raw, sig = decoded.rsplit(b".", 1)
        expected = _sign(raw, secret)
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(raw.decode())
        if not isinstance(payload, dict):
            return None
        exp = _exp_to_epoch(payload.get("exp"))
        if exp is None:
            return None if require_exp else payload
        if exp <= time.time():
            return None
        return payload
    except Exception:
        return None


def validate_redirect_to(value: str | None) -> str:
    """Only allow in-app relative paths as post-login redirects (prevents open redirects)."""
    if not value:
        return ""
    value = value.strip()
    if not value.startswith("/") or value.startswith("//"):
        return ""
    # Strip control characters that could mangle the Location header
    if any(ord(c) < 32 for c in value):
        return ""
    return value


def build_oauth_state(secret: str, redirect_to: str = "") -> str:
    """Create a signed, short-lived OAuth state nonce (CSRF protection for the login flow)."""
    payload = {
        "type": "oauth_state",
        "nonce": secrets.token_urlsafe(16),
        "redirect_to": validate_redirect_to(redirect_to),
    }
    return encode_token(payload, secret, ttl_seconds=OAUTH_STATE_TTL_SECONDS)


def parse_oauth_state(secret: str, state: str | None) -> dict | None:
    """Verify a state produced by build_oauth_state. Returns the payload or None."""
    if not state:
        return None
    payload = decode_token(state, secret)
    if not payload or payload.get("type") != "oauth_state":
        return None
    payload["redirect_to"] = validate_redirect_to(payload.get("redirect_to"))
    return payload


async def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    env = request.scope["env"]
    payload = decode_token(token, env.JWT_SECRET)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    return payload
