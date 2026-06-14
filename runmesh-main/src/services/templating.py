import json
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException
from jinja2 import TemplateSyntaxError, UndefinedError
from jinja2.sandbox import SandboxedEnvironment

_jinja = SandboxedEnvironment(autoescape=False)


def validate_template(template: str, field_name: str) -> None:
    if not template or not template.strip():
        return
    try:
        _jinja.from_string(template)
    except TemplateSyntaxError as e:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name} template: {e.message}") from e


def render_template(template: str, context: dict[str, Any]) -> str:
    try:
        return _jinja.from_string(template).render(**context)
    except TemplateSyntaxError as e:
        raise HTTPException(status_code=400, detail=f"Template syntax error: {e.message}") from e
    except UndefinedError as e:
        raise HTTPException(status_code=400, detail=f"Template variable error: {e.message}") from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Template render error: {e}") from e


def parse_stored_response(raw: Any) -> Any:
    if raw is None or raw == "":
        return None
    if isinstance(raw, (dict, list)):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw
    return raw


async def read_fetch_response_body(res) -> str:
    if res is None:
        return ""
    for attr in ("text", "bytes"):
        reader = getattr(res, attr, None)
        if not callable(reader):
            continue
        try:
            out = reader()
            if hasattr(out, "__await__"):
                out = await out
            if isinstance(out, bytes):
                return out.decode("utf-8", errors="replace")[:65536]
            return str(out)[:65536]
        except Exception:
            continue
    return ""


def build_task_context(
    task_row: dict[str, Any],
    extra_context: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    payload = task_row.get("payload")
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = {"raw": payload}
    if not isinstance(payload, dict):
        payload = {"value": payload}

    context = {
        "task": {
            "id": task_row.get("id"),
            "type": task_row.get("type"),
            "status": task_row.get("status"),
            "url": task_row.get("url"),
            "execution_type": task_row.get("execution_type"),
            "workflow_id": task_row.get("workflow_id"),
            "retries": task_row.get("retries", 0),
            "max_retries": task_row.get("max_retries", 5),
            "step_order": task_row.get("step_order", 0),
            "created_at": task_row.get("created_at"),
            "updated_at": task_row.get("updated_at"),
        },
        "payload": payload,
        "now": datetime.now(timezone.utc).isoformat(),
    }
    if extra_context:
        context.update(extra_context)
    return context


def resolve_task_request(
    task_row: dict[str, Any],
    extra_context: Optional[dict[str, Any]] = None,
) -> tuple[str, Any]:
    context = build_task_context(task_row, extra_context)
    url_template = task_row.get("url_template")
    payload_template = task_row.get("payload_template")

    if url_template and str(url_template).strip():
        url = render_template(str(url_template), context).strip()
    else:
        url = task_row.get("url") or ""
    if not url:
        raise HTTPException(status_code=400, detail="Task URL is empty after template render")

    if payload_template and str(payload_template).strip():
        rendered = render_template(str(payload_template), context).strip()
        try:
            body = json.loads(rendered)
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=400,
                detail=f"payload_template must render valid JSON: {e}",
            ) from e
    else:
        body = context["payload"]

    return url, body


def apply_task_templates(task_data: dict[str, Any], payload_template: Optional[str], url_template: Optional[str]) -> None:
    if payload_template and payload_template.strip():
        validate_template(payload_template, "payload_template")
        task_data["payload_template"] = payload_template.strip()
    if url_template and url_template.strip():
        validate_template(url_template, "url_template")
        task_data["url_template"] = url_template.strip()
