import json
from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException

WEBHOOK_TRIGGER_TYPES = frozenset({"queue", "webhook"})


def parse_trigger_config(workflow: dict[str, Any]) -> dict[str, Any]:
    raw = workflow.get("trigger_config") or "{}"
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def format_trigger_config_for_api(config: dict[str, Any]) -> str:
    if not config:
        return "{}"
    out = {k: v for k, v in config.items() if k not in ("secret", "secret_hint")}
    return json.dumps(out)


def normalize_trigger_config(
    trigger_type: str,
    trigger_config: Optional[str],
) -> str:
    config = {}
    if trigger_config:
        try:
            parsed = json.loads(trigger_config) if isinstance(trigger_config, str) else trigger_config
            if isinstance(parsed, dict):
                config = parsed
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail="trigger_config must be valid JSON") from e

    config.pop("secret", None)
    config.pop("secret_hint", None)

    if trigger_type == "schedule":
        cron = (config.get("cron") or "").strip()
        scheduled_at = (config.get("scheduled_at") or "").strip()
        if not cron and not scheduled_at:
            raise HTTPException(
                status_code=400,
                detail='Schedule workflows require trigger_config.cron or trigger_config.scheduled_at',
            )
        if cron and not validate_cron_expression(cron):
            raise HTTPException(status_code=400, detail="Invalid cron expression in trigger_config")
        if scheduled_at and not parse_scheduled_at(scheduled_at):
            raise HTTPException(status_code=400, detail="Invalid scheduled_at in trigger_config")

    return json.dumps(config)


def parse_scheduled_at(value: str) -> Optional[datetime]:
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def is_workflow_schedule_due(workflow: dict[str, Any], now: datetime) -> bool:
    config = parse_trigger_config(workflow)
    scheduled_at = (config.get("scheduled_at") or "").strip()
    if scheduled_at:
        at = parse_scheduled_at(scheduled_at)
        if at and at <= now and (workflow.get("status") or "draft").lower() == "draft":
            return True
    cron = (config.get("cron") or "").strip()
    if cron and cron_matches(cron, now):
        return True
    return False


def validate_cron_expression(expression: str) -> bool:
    parts = expression.strip().split()
    if len(parts) != 5:
        return False
    ranges = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 6)]
    for part, (lo, hi) in zip(parts, ranges):
        if not _cron_field_valid(part, lo, hi):
            return False
    return True


def _cron_field_valid(field: str, lo: int, hi: int) -> bool:
    if field == "*":
        return True
    for piece in field.split(","):
        piece = piece.strip()
        if not piece:
            return False
        if piece.startswith("*/"):
            try:
                int(piece[2:])
            except ValueError:
                return False
            continue
        if "-" in piece:
            bounds = piece.split("-", 1)
            if len(bounds) != 2:
                return False
            try:
                start, end = int(bounds[0]), int(bounds[1])
            except ValueError:
                return False
            if start < lo or end > hi or start > end:
                return False
            continue
        try:
            value = int(piece)
        except ValueError:
            return False
        if value < lo or value > hi:
            return False
    return True


def _cron_field_matches(field: str, value: int, lo: int, hi: int) -> bool:
    if field == "*":
        return True
    for piece in field.split(","):
        piece = piece.strip()
        if piece.startswith("*/"):
            step = int(piece[2:])
            if step > 0 and value % step == 0:
                return True
            continue
        if "-" in piece:
            start, end = piece.split("-", 1)
            if int(start) <= value <= int(end):
                return True
            continue
        if int(piece) == value:
            return True
    return False


def cron_matches(expression: str, dt: datetime) -> bool:
    parts = expression.strip().split()
    if len(parts) != 5:
        return False
    cron_weekday = (dt.weekday() + 1) % 7
    return (
        _cron_field_matches(parts[0], dt.minute, 0, 59)
        and _cron_field_matches(parts[1], dt.hour, 0, 23)
        and _cron_field_matches(parts[2], dt.day, 1, 31)
        and _cron_field_matches(parts[3], dt.month, 1, 12)
        and _cron_field_matches(parts[4], cron_weekday, 0, 6)
    )


def is_webhook_trigger(trigger_type: str) -> bool:
    return trigger_type in WEBHOOK_TRIGGER_TYPES
