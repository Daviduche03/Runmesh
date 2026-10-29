"""Structured logging for Workers Logs.

Emits one JSON object per line so Workers Logs can index the fields. `print()`
is the sink; the Workers runtime captures stdout.
"""
import json
from datetime import datetime, timezone


def log_event(level: str, event: str, **fields) -> None:
    print(json.dumps({
        "level": level,
        "event": event,
        "ts": datetime.now(timezone.utc).isoformat(),
        **fields,
    }, default=str))


def log_info(event: str, **fields) -> None:
    log_event("info", event, **fields)


def log_warn(event: str, **fields) -> None:
    log_event("warn", event, **fields)


def log_error(event: str, **fields) -> None:
    log_event("error", event, **fields)
