# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command | Purpose |
|---------|---------|
| `npx wrangler dev` | Local development |
| `npx wrangler deploy` | Deploy to Cloudflare |
| `npx wrangler types` | Generate TypeScript types |

Run `wrangler types` after changing bindings in wrangler.jsonc.

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`

## Best Practices (conditional)

If the application uses Durable Objects or Workflows, refer to the relevant best practices:

- Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Workflows: https://developers.cloudflare.com/workflows/build/rules-of-workflows/

## Runmesh — production gaps

Not production-ready. Treat as MVP/dev until these are addressed.

| Gap | Risk | Current state |
|-----|------|---------------|
| Sequential runner only | No branches, conditions, or parallel steps | `workflow_runner.py` chains one HTTP step at a time via `linear_order_from_trigger` |
| One active run per workflow | No concurrent runs; limited retry/cancel | `find_active_for_workflow` blocks with 409; stale-run recovery is heuristic only |
| Queue-based latency | Every step is a separate queue hop | Run → enqueue step 1 → on complete enqueue step 2; slow in local dev |
| Live run UI is poll-based only | ~2s delay; no SSE/WebSocket | Workflow detail polls `GET /api/v1/workflows/{id}` while running; canvas step badges update from task status |
| Step chaining is linear only | No branch-specific context | Completed prior steps expose `prev` / `steps` in Jinja; `response_body` stored per task (64KB cap) |
| External test URL deps | Third-party URLs (e.g. httpbin) can 503 and fail runs | Steps fail when `fetch` returns status ≥ 400 |
| Stale-run recovery is basic | Manual DB fixes sometimes needed in dev | Auto-fail stale `workflow_runs` when no tasks are queued/running |
| Secrets in wrangler.jsonc | GitHub client secret visible in config | Move to `wrangler secret` / env; never commit production secrets |
| No observability | No structured logging, metrics, or alerting | `print()` only; enable Workers observability + external monitoring for prod |
| Limited test coverage | Regressions found manually | No integration tests for queue handler, workflow runner, or graph sync |

### Implemented (not gaps)

| Feature | How it works |
|---------|--------------|
| Webhook workflow trigger | `POST /api/v1/workflows/{id}/trigger` with JWT or `X-API-Key` (write); workflow must be `queue`/`webhook` |
| Schedule workflow trigger | `trigger_type: schedule` + `trigger_config.cron` (recurring) or `trigger_config.scheduled_at` (one-shot ISO UTC); evaluated every minute in `scheduled()` |
| Standalone + workflow scheduling | Same cron tick in `entry.py` `scheduled()`: `enqueue_due_tasks()` for standalone tasks, `run_due_scheduled_workflows()` for workflows |
| Step output chaining | Prior completed steps available in Jinja as `prev` (last) and `steps` (list); `response_body` / `response_status` stored on each task |

### Worker entrypoints (`entry.py` `Default`)

- `fetch` — FastAPI app (HTTP API)
- `queue` — `runmesh-tasks` + `runmesh-webhooks` consumers
- `scheduled` — cron `* * * * *`; enqueues due standalone scheduled tasks and starts due scheduled workflows

`src/scheduler.py` was removed; do not reintroduce a separate scheduler worker.

### Safe test URLs for workflow steps

Prefer `https://jsonplaceholder.typicode.com/posts` (201). Avoid `httpbin.org` when unreliable. `https://httpbingo.org/post` is a fallback mirror.
