# Runmesh

**The control plane for AI agents.** Give every agent an identity and a scoped, revocable, auditable credential — run its work durably, gate the actions that matter behind approvals, and see everything it did.

Observability tells you what an agent *did*. Runmesh decides what it is *allowed* to do. One layer for identity, access, approvals, execution, and audit.

## Why

For thirty years we built a discipline around human access: identity, least privilege, approvals, audit trails. Then a new actor showed up — one that doesn't sleep, acts thousands of times a minute, and today usually gets a long-lived API key with every scope, no expiry, and no record of what it did.

The missing layer is not another tracing dashboard. It is control:

- **Identity** — an agent is a principal, not a shared secret.
- **Access** — credentials scoped to an agent, a task, a resource, and an expiry.
- **Approvals** — a human in the loop when policy says so.
- **Execution** — the work itself, run durably.
- **Audit** — every action, explainable and replayable.

## What you get

- **Agent identity** — register agents and tie every action to the agent, task, or workflow run that requested it.
- **Scoped grants** — mint tokens bound to a scope, a resource, and an expiry. Revoke the agent without revoking everything.
- **Approval gates** — decide what runs freely and what waits for a person before it happens.
- **Durable execution** — HTTP tasks, UTC scheduling, and multi-step workflows on Cloudflare Queues with retries, idempotency, and replay.
- **Audit trail** — follow a token from request, to approval, to the action it authorized.
- **Dashboard** — runs, workflow execution, analytics, API keys, and outbound webhooks in one place.
- **Dual auth** — JWT for the dashboard, API keys for integrations, on `/api/v1` routes.

Built on [Cloudflare Workers](https://developers.cloudflare.com/workers/) (Python) with [D1](https://developers.cloudflare.com/d1/) for storage and [Queues](https://developers.cloudflare.com/queues/) for dispatch.

## Repository layout

```
Runmesh/
├── runmesh-main/     Backend — Cloudflare Worker (FastAPI + D1 + Queues)
└── frontend/         Dashboard + landing — React + Vite
```

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) (frontend)
- [uv](https://docs.astral.sh/uv/) 0.8.10+ (backend)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) via `uv sync` in `runmesh-main/`
- A Cloudflare account with D1 and Queues enabled

## Quick start

### 1. Backend

```bash
cd runmesh-main
uv sync --all-groups
cp .dev.vars.example .dev.vars
uv run pywrangler dev
```

The API listens on `http://localhost:8787` by default.

### 2. Database

Apply migrations to your local D1 instance:

```bash
cd runmesh-main
uv run pywrangler d1 migrations apply runmesh-db --local
```

For production, omit `--local`.

### 3. Frontend

```bash
cd frontend
pnpm install
cp .env.example .env.local
pnpm dev
```

Set the API URL in `frontend/.env.local`:

```env
VITE_API_URL=http://localhost:8787
```

Open `http://localhost:5173`.

## Environment variables

Configure in `runmesh-main/wrangler.jsonc` under `vars`. Use [Wrangler secrets](https://developers.cloudflare.com/workers/configuration/secrets/) for sensitive values in production.

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Secret for signing dashboard session tokens |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret |
| `FRONTEND_URL` | Dashboard origin for OAuth redirects (e.g. `http://localhost:5173`) |
| `PUBLIC_URL` | Public Worker URL used as OAuth callback base |

### Bindings (wrangler.jsonc)

| Binding | Resource |
|---------|----------|
| `DB` | D1 database |
| `TASK_QUEUE` | Cloudflare Queue for task dispatch |
| `WEBHOOK_QUEUE` | Cloudflare Queue for outbound webhooks |

### Cloudflare Queues

Create both queues before deploying:

```bash
cd runmesh-main
wrangler queues create runmesh-tasks --message-retention-period-secs 86400
wrangler queues create runmesh-webhooks --message-retention-period-secs 86400
```

## API overview

All JSON endpoints share a [consistent response envelope](./runmesh-main/TASK_API_DOCUMENTATION.md#response-format). Identity and access run through Connect; execution runs through tasks and workflows.

| Route | Auth | Purpose |
|-------|------|---------|
| `GET/POST /api/v1/tasks` | JWT or API key | List / create tasks |
| `POST /api/v1/tasks/schedule` | JWT or API key | Schedule a future task |
| `GET/POST /api/v1/workflows` | JWT or API key | List / create workflows |
| `GET /api/v1/workflows/{id}` | JWT or API key | Workflow detail |
| `PUT /api/v1/workflows/{id}/graph` | JWT or API key | Save workflow graph |
| `POST /api/v1/workflows/{id}/trigger` | JWT or API key | Trigger a workflow run |
| `GET /api/v1/workflows/{id}/runs` | JWT or API key | List workflow runs |
| `POST /api/v1/connect/apps` | JWT only | Register a Connect app |
| `POST /api/v1/connect/sessions` | Public (app credentials) | Start Connect user session |
| `POST /api/v1/connect/otp/verify` | Public | Verify OTP and authenticate |
| `GET /connect/authorize` | Public | OAuth authorization redirect |
| `POST /api/v1/connect/token` | Public | Exchange Connect authorization code |
| `GET /api/analytics` | JWT only | Dashboard metrics |
| `GET/POST /api/webhooks` | JWT only | Outbound webhook config |
| `GET/POST /api-keys` | JWT only | API key management |
| `GET /auth/github/login` | Public | Start GitHub OAuth |

Full reference: [runmesh-main/TASK_API_DOCUMENTATION.md](./runmesh-main/TASK_API_DOCUMENTATION.md)

### Authentication

**Dashboard** — sign in via GitHub OAuth, then send:

```
Authorization: Bearer <jwt>
```

**Integrations** — create an API key in Settings, then send:

```
X-API-Key: rk_...
```

## Deploy

```bash
cd runmesh-main
uv run pywrangler deploy
uv run pywrangler d1 migrations apply runmesh-db --remote
```

Deploy the frontend separately (Cloudflare Pages, Vercel, etc.) and set `VITE_API_URL` to your Worker URL.

## Development

```bash
cd runmesh-main && uv run pywrangler dev
cd frontend && pnpm dev
cd frontend && pnpm build
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

See [SECURITY.md](./SECURITY.md) to report vulnerabilities.

## License

[MIT](./LICENSE)
