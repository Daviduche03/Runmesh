import json

from datetime import (
    datetime,
    timezone,
)

from typing import (
    Any,
    Dict,
    List,
    Optional,
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_json_list(value: Any, default: Optional[List[str]] = None) -> List[str]:
    if value is None:
        return list(default or [])
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, str):
        if not value.strip():
            return list(default or [])
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return list(default or [])
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
    return list(default or [])


def parse_json_dict(value: Any, default: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if value is None:
        return dict(default or {})
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        if not value.strip():
            return dict(default or {})
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return dict(default or {})
        if isinstance(parsed, dict):
            return parsed
    return dict(default or {})


def bool_from_sqlite(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return int(value) == 1


def sql_nullable(value: Any) -> Any:
    if value is None:
        return None
    if type(value).__name__ == "JsNull":
        return None
    return value


