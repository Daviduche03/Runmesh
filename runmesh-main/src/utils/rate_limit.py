"""Fixed-window rate limiting backed by the D1 `rate_limits` table
(see migrations/0016_rate_limits.sql).

Fails open if the table is missing or the query errors, so a deploy that
hasn't applied the migration yet keeps working (with a logged warning).
"""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request

TABLE_MISSING = "rate_limits"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def check_rate_limit(db, key: str, limit: int, window_seconds: int) -> bool:
    """Register one hit for `key`. Returns True if within the limit, False if exceeded."""
    now = _now()
    window_start = now - timedelta(seconds=window_seconds)
    try:
        row = await db.prepare(
            "SELECT count, window_start FROM rate_limits WHERE key = ?"
        ).bind(key).first()
        if row is not None:
            if hasattr(row, "as_py"):
                row = row.as_py()
            elif hasattr(row, "to_py"):
                row = row.to_py()
            else:
                row = dict(row)
            try:
                started = datetime.fromisoformat(str(row["window_start"]).replace("Z", "+00:00"))
            except (KeyError, ValueError):
                started = now
            if started <= window_start:
                # Window expired — reset it
                await db.prepare(
                    "UPDATE rate_limits SET count = 1, window_start = ? WHERE key = ?"
                ).bind(now.isoformat(), key).run()
                return True
            count = int(row.get("count", 0))
            if count >= limit:
                return False
            await db.prepare(
                "UPDATE rate_limits SET count = count + 1 WHERE key = ?"
            ).bind(key).run()
            return True
        await db.prepare(
            "INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)"
        ).bind(key, now.isoformat()).run()
        return True
    except Exception as exc:
        # Fail open: rate limiting must not take down the API
        print(f"[rate-limit] check failed for {key}: {exc}")
        return True


async def enforce_rate_limit(db, key: str, limit: int, window_seconds: int, detail: str = "Too many requests") -> None:
    """Raise HTTP 429 when the fixed-window limit for `key` is exceeded."""
    allowed = await check_rate_limit(db, key, limit, window_seconds)
    if not allowed:
        raise HTTPException(status_code=429, detail=detail)


def get_client_ip(request: Request) -> str:
    """Best-effort client IP: Cloudflare header first, then proxy headers, then ASGI scope."""
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    client = request.scope.get("client")
    if client:
        return str(client[0])
    return "unknown"
