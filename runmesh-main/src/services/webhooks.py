import hashlib
import hmac
import json
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Awaitable, Optional
from urllib.parse import urlparse

from fastapi import HTTPException

from db.orm import WebhookModel, WebhookDeadLetterModel

WEBHOOK_QUEUE_NAME = "runmesh-webhooks"
WEBHOOK_SECRET_PREFIX = "whsec_"
SIGNATURE_HEADER = "X-Runmesh-Signature"
TIMESTAMP_HEADER = "X-Runmesh-Timestamp"
EVENT_HEADER = "X-Runmesh-Event"
ATTEMPT_HEADER = "X-Runmesh-Delivery-Attempt"

MAX_WEBHOOK_DELIVERY_ATTEMPTS = 6
WEBHOOK_RETRY_DELAYS = (60, 300, 900, 3600, 14400)

VALID_EVENTS = frozenset({
    "task.completed",
    "task.failed",
    "task.running",
})

DEFAULT_EVENTS = "task.completed,task.failed"


def generate_webhook_secret() -> str:
    return f"{WEBHOOK_SECRET_PREFIX}{secrets.token_urlsafe(32)}"


def mask_webhook_secret(secret: str) -> str:
    if not secret or len(secret) < 12:
        return f"{WEBHOOK_SECRET_PREFIX}••••"
    return f"{secret[:7]}••••{secret[-4:]}"


def normalize_events(events: str) -> list[str]:
    if not events or not events.strip():
        return list(DEFAULT_EVENTS.split(","))
    parsed = []
    for part in events.split(","):
        name = part.strip().lower()
        if not name:
            continue
        if name not in VALID_EVENTS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid event '{name}'. Allowed: {', '.join(sorted(VALID_EVENTS))}",
            )
        if name not in parsed:
            parsed.append(name)
    if not parsed:
        raise HTTPException(status_code=400, detail="At least one event is required")
    return parsed


def events_to_string(events: list[str]) -> str:
    return ",".join(events)


def webhook_subscribes_to(events_field: str, event: str) -> bool:
    subscribed = {e.strip().lower() for e in events_field.split(",") if e.strip()}
    return event.lower() in subscribed


def validate_webhook_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("https", "http"):
        raise HTTPException(status_code=400, detail="Webhook URL must use http or https")
    if not parsed.netloc:
        raise HTTPException(status_code=400, detail="Webhook URL is invalid")
    return url.strip()


def retry_delay_after_failure(failed_attempt: int) -> int:
    idx = min(max(failed_attempt - 1, 0), len(WEBHOOK_RETRY_DELAYS) - 1)
    return WEBHOOK_RETRY_DELAYS[idx]


def sign_payload(secret: str, timestamp: int, body: bytes) -> str:
    signed = f"{timestamp}.".encode() + body
    return hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()


def build_signature_header(timestamp: int, signature: str) -> str:
    return f"t={timestamp},v1={signature}"


def build_event_envelope(event: str, task: dict[str, Any], extra: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    payload = task.get("payload")
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = {"raw": payload}

    data: dict[str, Any] = {
        "task_id": task.get("id"),
        "url": task.get("url"),
        "status": task.get("status"),
        "type": task.get("type"),
        "execution_type": task.get("execution_type"),
        "workflow_id": task.get("workflow_id"),
        "retries": task.get("retries", 0),
        "max_retries": task.get("max_retries", 5),
        "payload": payload,
        "created_at": task.get("created_at"),
        "updated_at": task.get("updated_at"),
    }
    if extra:
        data.update(extra)

    return {
        "id": f"evt_{uuid.uuid4().hex}",
        "type": event,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }


def format_webhook_row(row: dict[str, Any], include_secret: bool = False) -> dict[str, Any]:
    secret = row.get("secret", "")
    item = {
        "id": row["id"],
        "name": row.get("name", ""),
        "url": row.get("url", ""),
        "events": row.get("events", DEFAULT_EVENTS),
        "status": row.get("status", "active"),
        "created_at": row.get("created_at", ""),
        "updated_at": row.get("updated_at", ""),
    }
    if include_secret:
        item["secret"] = secret
    else:
        item["secret_hint"] = mask_webhook_secret(secret)
    return item


async def create_webhook(model: WebhookModel, name: str, url: str, events: str, user_id: str) -> dict[str, Any]:
    event_list = normalize_events(events)
    now = datetime.now(timezone.utc).isoformat()
    secret = generate_webhook_secret()
    data = {
        "name": name.strip(),
        "url": validate_webhook_url(url),
        "events": events_to_string(event_list),
        "status": "active",
        "secret": secret,
        "user_id": user_id,
        "created_at": now,
        "updated_at": now,
    }
    webhook_id = await model.create(data)
    return format_webhook_row({"id": webhook_id, **data}, include_secret=True)


async def list_webhooks(model: WebhookModel, user_id: str) -> list[dict[str, Any]]:
    rows = await model.find_by_user_id(user_id)
    return [format_webhook_row(row) for row in rows]


async def delete_webhook(model: WebhookModel, webhook_id: str, user_id: str) -> str:
    row = await model.find_by_id(webhook_id)
    if not row or row.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Webhook not found")
    await model.delete(webhook_id)
    return webhook_id


async def rotate_webhook_secret(model: WebhookModel, webhook_id: str, user_id: str) -> dict[str, Any]:
    row = await model.find_by_id(webhook_id)
    if not row or row.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Webhook not found")
    secret = generate_webhook_secret()
    now = datetime.now(timezone.utc).isoformat()
    await model.update(
        "webhooks",
        "id = ?",
        {"secret": secret, "updated_at": now},
        webhook_id,
    )
    updated = {**row, "secret": secret, "updated_at": now}
    return format_webhook_row(updated, include_secret=True)


FetchFn = Callable[..., Awaitable[Any]]
QueueSendFn = Callable[..., Awaitable[Any]]


async def enqueue_webhook_delivery(
    queue: QueueSendFn,
    webhook_id: str,
    event: str,
    envelope: dict[str, Any],
    delivery_attempt: int = 1,
    delay_seconds: int = 0,
) -> None:
    message = {
        "webhook_id": webhook_id,
        "event": event,
        "body": envelope,
        "delivery_attempt": delivery_attempt,
    }
    if delay_seconds > 0:
        await queue.send(message, delaySeconds=delay_seconds)
    else:
        await queue.send(message)


async def deliver_webhook(
    fetch_fn: FetchFn,
    webhook: dict[str, Any],
    event: str,
    envelope: dict[str, Any],
    delivery_attempt: int,
) -> tuple[bool, Optional[int], Optional[str]]:
    body_bytes = json.dumps(envelope, separators=(",", ":")).encode()
    timestamp = int(datetime.now(timezone.utc).timestamp())
    secret = webhook.get("secret", "")
    signature = sign_payload(secret, timestamp, body_bytes)

    try:
        response = await fetch_fn(
            webhook["url"],
            method="POST",
            headers={
                "content-type": "application/json",
                SIGNATURE_HEADER: build_signature_header(timestamp, signature),
                TIMESTAMP_HEADER: str(timestamp),
                EVENT_HEADER: event,
                ATTEMPT_HEADER: str(delivery_attempt),
                "user-agent": "Runmesh-Webhook/1.0",
            },
            body=body_bytes,
        )
        status_code = response.status
        if status_code >= 400:
            return False, status_code, f"HTTP {status_code}"
        return True, status_code, None
    except Exception as e:
        return False, None, str(e)


async def schedule_webhook_retry(
    queue: QueueSendFn,
    webhook_id: str,
    event: str,
    envelope: dict[str, Any],
    failed_attempt: int,
) -> bool:
    next_attempt = failed_attempt + 1
    if next_attempt > MAX_WEBHOOK_DELIVERY_ATTEMPTS:
        return False
    delay = retry_delay_after_failure(failed_attempt)
    await enqueue_webhook_delivery(
        queue,
        webhook_id,
        event,
        envelope,
        delivery_attempt=next_attempt,
        delay_seconds=delay,
    )
    return True


async def process_webhook_queue_message(
    db,
    queue: QueueSendFn,
    fetch_fn: FetchFn,
    message_body: dict[str, Any],
) -> None:
    webhook_id = message_body.get("webhook_id")
    event = message_body.get("event")
    envelope = message_body.get("body")
    delivery_attempt = int(message_body.get("delivery_attempt") or 1)

    if not webhook_id or not event or not envelope:
        return

    model = WebhookModel(db)
    webhook = await model.find_by_id(webhook_id)
    if not webhook or webhook.get("status") != "active":
        return

    if not webhook_subscribes_to(webhook.get("events", ""), event):
        return

    ok, status_code, err = await deliver_webhook(fetch_fn, webhook, event, envelope, delivery_attempt)
    if ok:
        return

    detail = err or "unknown error"
    print(
        f"Webhook {webhook_id} attempt {delivery_attempt}/{MAX_WEBHOOK_DELIVERY_ATTEMPTS} "
        f"failed for {event}: {detail}"
    )

    scheduled = await schedule_webhook_retry(queue, webhook_id, event, envelope, delivery_attempt)
    if not scheduled:
        await record_dead_letter(
            db,
            webhook,
            event,
            envelope,
            delivery_attempt,
            status_code,
            detail,
        )
        print(f"Webhook {webhook_id} exhausted retries for event {event} (event id {envelope.get('id')})")


def _queue_message_body(message) -> dict:
    body = message.body if hasattr(message, "body") else message
    if hasattr(body, "to_py"):
        body = body.to_py()
    elif hasattr(body, "as_py"):
        body = body.as_py()
    if isinstance(body, str):
        body = json.loads(body)
    if not isinstance(body, dict):
        raise TypeError("queue message body must be a dict")
    return body


def _ack_message(message) -> None:
    ack = getattr(message, "ack", None)
    if ack:
        ack()


async def handle_webhook_queue_batch(
    db,
    queue: QueueSendFn,
    fetch_fn: FetchFn,
    messages: list,
) -> None:
    for message in messages:
        try:
            body = _queue_message_body(message)
            await process_webhook_queue_message(db, queue, fetch_fn, body)
            _ack_message(message)
        except Exception as e:
            print(f"Webhook queue handler error: {e}")
            try:
                _ack_message(message)
            except Exception:
                pass


async def dispatch_event(
    db,
    queue: QueueSendFn,
    user_id: str,
    event: str,
    task: dict[str, Any],
    delivery_extra: Optional[dict[str, Any]] = None,
) -> int:
    if event not in VALID_EVENTS:
        return 0

    model = WebhookModel(db)
    webhooks = await model.find_active_by_user_id(user_id)
    queued = 0

    for webhook in webhooks:
        if not webhook_subscribes_to(webhook.get("events", ""), event):
            continue

        envelope = build_event_envelope(event, task, delivery_extra)
        await enqueue_webhook_delivery(queue, webhook["id"], event, envelope)
        queued += 1

    return queued


def format_dead_letter_row(row: dict[str, Any], webhook_name: str = "") -> dict[str, Any]:
    body_raw = row.get("body", "{}")
    try:
        body = json.loads(body_raw) if isinstance(body_raw, str) else body_raw
    except json.JSONDecodeError:
        body = {"raw": body_raw}

    return {
        "id": row["id"],
        "webhook_id": row.get("webhook_id", ""),
        "webhook_name": webhook_name,
        "event": row.get("event", ""),
        "event_id": row.get("event_id", ""),
        "body": body,
        "last_status_code": row.get("last_status_code"),
        "last_error": row.get("last_error"),
        "attempts": row.get("attempts", 0),
        "failed_at": row.get("failed_at", ""),
        "replayed_at": row.get("replayed_at"),
        "created_at": row.get("created_at", ""),
    }


async def record_dead_letter(
    db,
    webhook: dict[str, Any],
    event: str,
    envelope: dict[str, Any],
    attempts: int,
    last_status_code: Optional[int],
    last_error: str,
) -> str:
    model = WebhookDeadLetterModel(db)
    now = datetime.now(timezone.utc).isoformat()
    data = {
        "webhook_id": webhook["id"],
        "user_id": webhook.get("user_id", ""),
        "event": event,
        "event_id": envelope.get("id", ""),
        "body": json.dumps(envelope, separators=(",", ":")),
        "last_status_code": last_status_code,
        "last_error": last_error,
        "attempts": attempts,
        "failed_at": now,
        "created_at": now,
    }
    return await model.create(data)


async def list_dead_letters(
    model: WebhookDeadLetterModel,
    user_id: str,
    include_replayed: bool = False,
) -> list[dict[str, Any]]:
    rows = await model.find_by_user_id(user_id, include_replayed=include_replayed)
    webhook_model = WebhookModel(model.db)
    names: dict[str, str] = {}
    out = []
    for row in rows:
        wid = row.get("webhook_id", "")
        if wid not in names:
            wh = await webhook_model.find_by_id(wid)
            names[wid] = wh.get("name", "") if wh else ""
        out.append(format_dead_letter_row(row, names[wid]))
    return out


async def replay_dead_letter(
    model: WebhookDeadLetterModel,
    queue: QueueSendFn,
    dead_letter_id: str,
    user_id: str,
) -> dict[str, Any]:
    row = await model.find_by_id(dead_letter_id)
    if not row or row.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Dead letter not found")
    if row.get("replayed_at"):
        raise HTTPException(status_code=400, detail="Dead letter already replayed")

    body_raw = row.get("body", "{}")
    try:
        envelope = json.loads(body_raw) if isinstance(body_raw, str) else body_raw
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Dead letter body is invalid")

    webhook_id = row.get("webhook_id", "")
    event = row.get("event", "")
    await enqueue_webhook_delivery(queue, webhook_id, event, envelope, delivery_attempt=1)
    await model.mark_replayed(dead_letter_id)

    webhook_model = WebhookModel(model.db)
    wh = await webhook_model.find_by_id(webhook_id)
    webhook_name = wh.get("name", "") if wh else ""
    updated = {**row, "replayed_at": datetime.now(timezone.utc).isoformat()}
    return format_dead_letter_row(updated, webhook_name)


async def dismiss_dead_letter(
    model: WebhookDeadLetterModel,
    dead_letter_id: str,
    user_id: str,
) -> str:
    row = await model.find_by_id(dead_letter_id)
    if not row or row.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Dead letter not found")
    await model.delete(dead_letter_id)
    return dead_letter_id
