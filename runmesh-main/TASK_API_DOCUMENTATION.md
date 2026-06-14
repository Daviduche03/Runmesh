# Runmesh API Reference

## Response format

Every JSON endpoint returns a consistent envelope.

### Success

```json
{
  "ok": true,
  "data": {},
  "message": "Optional human-readable summary",
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 128
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Always `true` on success |
| `data` | any | Primary payload — object, array, or null |
| `message` | string | Optional summary for mutations |
| `meta` | object | Optional pagination or counts |

**Lists** — `data` is an array; pagination lives in `meta`:

```json
{
  "ok": true,
  "data": [{ "id": "...", "endpoint": "...", "status": "Completed" }],
  "meta": { "page": 1, "limit": 50, "total": 128 }
}
```

**Single resource** — `data` is the object:

```json
{
  "ok": true,
  "data": { "id": "...", "name": "Order flow", "status": "Active" }
}
```

**Mutations** — `data` holds created/updated identifiers:

```json
{
  "ok": true,
  "data": { "task_id": "uuid" },
  "message": "Task queued"
}
```

### Error

```json
{
  "ok": false,
  "error": {
    "code": "not_found",
    "message": "Workflow not found"
  }
}
```

| Code | HTTP | Meaning |
|------|------|---------|
| `bad_request` | 400 | Invalid input |
| `unauthorized` | 401 | Missing or invalid auth |
| `forbidden` | 403 | Insufficient API key permissions |
| `not_found` | 404 | Resource not found |
| `validation_error` | 422 | Request body failed validation |
| `internal_error` | 500 | Server error |

## Architecture

```
/
├── /api/v1/tasks              Tasks (JWT or API key)
├── /api/v1/workflows          Workflows (JWT or API key)
├── /api/analytics             Dashboard metrics (JWT only)
├── /api/webhooks              Outbound webhooks (JWT only)
├── /api-keys                  API key management (JWT only)
└── /auth/github/*             OAuth login
```

## Authentication

All `/api/v1` routes accept **either**:

| Client | Header |
|--------|--------|
| Dashboard (browser) | `Authorization: Bearer <jwt>` |
| Scripts / integrations | `X-API-Key: rk_...` |

Dashboard-only routes require a Bearer token.

### API keys

Create a key from the dashboard or via:

```bash
curl -X POST https://your-domain/api-keys \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"name": "Production", "permissions": ["read", "write"]}'
```

Response:

```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "name": "Production",
    "key": "rk_...",
    "permissions": ["read", "write"]
  },
  "message": "API key created"
}
```

| Permission | Allows |
|------------|--------|
| `read` | List tasks, workflows |
| `write` | Create tasks, workflows, schedule, cancel |
| `delete` | Delete resources |
| `admin` | Full access |

JWT sessions from login have full workspace access without permission checks.

## Tasks

### List tasks

`GET /api/v1/tasks`

Query params: `status`, `workflow_id`, `page`, `limit`

```bash
curl https://your-domain/api/v1/tasks?page=1&limit=50 \
  -H "X-API-Key: rk_your_key"
```

### Create task

`POST /api/v1/tasks`

Queues a task for immediate execution.

```bash
curl -X POST https://your-domain/api/v1/tasks \
  -H "X-API-Key: rk_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/webhook",
    "payload": {"message": "Hello"},
    "execution_type": "queue",
    "workflow_id": "optional-workflow-uuid"
  }'
```

Optional Jinja2 templates render at execution time (sandboxed). Provide `url` or `url_template`, and static `payload` and/or `payload_template`:

```json
{
  "url_template": "https://api.example.com/orders/{{ payload.order_id }}/notify",
  "payload_template": "{\"status\": \"{{ task.status }}\", \"order_id\": \"{{ payload.order_id }}\"}",
  "payload": { "order_id": "ord_1042" }
}
```

Template context: `task` (id, status, url, …), `payload` (stored JSON), `now` (ISO UTC).

`payload_template` must render to valid JSON. Syntax errors return `400` at create time.

Response:

```json
{
  "ok": true,
  "data": { "task_id": "uuid" },
  "message": "Task queued"
}
```

### Schedule task

`POST /api/v1/tasks/schedule`

```bash
curl -X POST https://your-domain/api/v1/tasks/schedule \
  -H "X-API-Key: rk_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/webhook",
    "payload": {},
    "scheduled_at": "2026-06-05T10:00:00Z",
    "max_retries": 3
  }'
```

### List scheduled tasks

`GET /api/v1/tasks/scheduled`

### Cancel scheduled task

`POST /api/v1/tasks/{task_id}/cancel`

### Reschedule task

`POST /api/v1/tasks/{task_id}/reschedule`

```json
{"scheduled_at": "2026-06-06T15:00:00Z"}
```

## Workflows

### List workflows

`GET /api/v1/workflows`

```json
{
  "ok": true,
  "data": [{ "id": "...", "name": "...", "status": "Draft", "tasks": [] }],
  "meta": { "total": 1 }
}
```

### Create workflow

`POST /api/v1/workflows`

```json
{
  "name": "Order processing",
  "description": "Webhook-triggered order flow",
  "trigger_type": "webhook",
  "trigger_config": "{}",
  "tasks": []
}
```

### Get workflow

`GET /api/v1/workflows/{workflow_id}`

Returns workflow metadata, `tasks`, and `graph` (`nodes` + `edges`) in `data`. Legacy workflows without a stored graph get a linear graph generated from `step_order`.

### Save workflow graph

`PUT /api/v1/workflows/{workflow_id}/graph`

```json
{
  "nodes": [
    { "id": "trigger", "type": "trigger", "position": { "x": 40, "y": 160 }, "data": { "label": "Trigger", "triggerType": "manual" } },
    { "id": "http-...", "type": "http", "position": { "x": 260, "y": 160 }, "data": { "label": "Step 1", "url": "https://...", "payload": {} } }
  ],
  "edges": [
    { "id": "edge-trigger-http-...", "source": "trigger", "target": "http-..." }
  ]
}
```

Phase A supports a **single linear path** from `trigger` through `http` nodes. Saving syncs HTTP nodes to `tasks` (create/update/delete) and enqueues **new** steps only.

## Analytics

`GET /api/analytics` (JWT only)

Returns dashboard stats and chart data in `data`.

## Webhooks (JWT only)

Manage outbound endpoints that receive signed HTTP POSTs when tasks change state.

### List webhooks

`GET /api/webhooks`

Returns `data` as an array. Secrets are never returned in full — each item includes `secret_hint` (e.g. `whsec_••••abcd`).

### Create webhook

`POST /api/webhooks`

```json
{
  "name": "Production notifier",
  "url": "https://api.example.com/hooks/runmesh",
  "events": "task.completed,task.failed"
}
```

`events` is comma-separated. Allowed values: `task.completed`, `task.failed`, `task.running`. Default: `task.completed,task.failed`.

The response `data` includes the full `secret` once (prefix `whsec_`). Store it immediately; later list responses only show `secret_hint`.

### Rotate signing secret

`POST /api/webhooks/{webhook_id}/rotate-secret`

Returns a new full `secret` in `data`. Previous signatures become invalid.

### Delete webhook

`DELETE /api/webhooks/{webhook_id}`

### Outbound delivery

When a queued task runs, Runmesh POSTs JSON to every **active** webhook owned by the task’s user that subscribes to the event.

| Event | When |
|-------|------|
| `task.running` | Task status set to `running` before the target URL is called |
| `task.completed` | Task finished with HTTP status &lt; 400 |
| `task.failed` | Task finished with HTTP status ≥ 400 or an execution error |

**Request**

- Method: `POST`
- `Content-Type: application/json`
- `X-Runmesh-Event`: event name (e.g. `task.completed`)
- `X-Runmesh-Timestamp`: Unix seconds used in the signature
- `X-Runmesh-Signature`: `t={timestamp},v1={hex}`

**Body**

```json
{
  "id": "evt_...",
  "type": "task.completed",
  "created_at": "2026-06-04T12:00:00+00:00",
  "data": {
    "task_id": "...",
    "url": "https://...",
    "status": "completed",
    "type": "task",
    "execution_type": "queue",
    "workflow_id": null,
    "retries": 0,
    "max_retries": 5,
    "payload": {},
    "created_at": "...",
    "updated_at": "...",
    "target_status_code": 200
  }
}
```

`target_status_code` is present on `task.completed` and `task.failed` when the worker received an HTTP response.

**Retries**

Deliveries run on the `runmesh-webhooks` queue. A failed delivery (network error or HTTP status ≥ 400) is retried with exponential backoff:

| Retry after failure | Delay |
|---------------------|-------|
| 1st | 60s |
| 2nd | 5m |
| 3rd | 15m |
| 4th | 1h |
| 5th | 4h |

Up to **6** delivery attempts per event (initial try plus 5 retries). The same event `id` in the JSON body is preserved across retries. Each attempt is re-signed with a fresh timestamp. Receivers can read `X-Runmesh-Delivery-Attempt` (1–6).

**Dead letter queue (DLQ)**

After all retries fail, the event is stored in D1 (`webhook_dead_letters`). JWT-only API:

| Route | Action |
|-------|--------|
| `GET /api/webhooks/dead-letters` | List undelivered failures (`?include_replayed=1` for history) |
| `POST /api/webhooks/dead-letters/{id}/replay` | Re-enqueue delivery (attempt 1) |
| `DELETE /api/webhooks/dead-letters/{id}` | Dismiss without replay |

**Verify signature**

1. Read the raw request body as bytes (do not re-serialize JSON).
2. Parse `X-Runmesh-Signature` for `t` and `v1`.
3. Reject if `|now - t| > 300` (five minutes).
4. Compute `expected = HMAC-SHA256(secret, f"{t}.".encode() + body_bytes).hexdigest()`.
5. Compare `v1` to `expected` with a constant-time comparison.

Example (Python):

```python
import hmac, hashlib, time

def verify(secret: str, body: bytes, signature_header: str, tolerance: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in signature_header.split(","))
    ts = int(parts["t"])
    if abs(time.time() - ts) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(parts["v1"], expected)
```

## Task fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes* | Target URL for the HTTP POST |
| `url_template` | string | Yes* | Jinja2 URL template (rendered at run time) |
| `payload` | object | No | Static JSON context / body |
| `payload_template` | string | No | Jinja2 template that must render to JSON |
| `type` | string | No | Task type (default: `task`) |
| `execution_type` | string | No | `queue`, `webhook`, or `schedule` |
| `workflow_id` | string | No | Associate task with a workflow |
| `scheduled_at` | string | Schedule only | ISO 8601 UTC datetime |

\* Provide `url` or `url_template` (or both; template wins at execution).

## Task statuses

- `queued` — waiting to run
- `running` — in progress
- `completed` — success (2xx response)
- `failed` — failed after retries

## Legacy routes

These aliases remain for backward compatibility:

| Legacy | Preferred |
|--------|-----------|
| `POST /api/v1/task/publish` | `POST /api/v1/tasks` |
| `POST /api/v1/task/schedule` | `POST /api/v1/tasks/schedule` |
| `POST /api/v1/task/{id}/cancel` | `POST /api/v1/tasks/{id}/cancel` |
| `POST /api/v1/task/{id}/reschedule` | `POST /api/v1/tasks/{id}/reschedule` |

Removed duplicate dashboard routes — use v1:

- ~~`GET /api/tasks`~~ → `GET /api/v1/tasks`
- ~~`POST /api/tasks`~~ → `POST /api/v1/tasks`
- ~~`GET /api/workflows`~~ → `GET /api/v1/workflows`
