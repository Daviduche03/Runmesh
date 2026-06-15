# Runmesh

Runmesh is a platform for async infrastructure — task execution, workflow automation, and Connect identity. Queue webhooks, schedule jobs, orchestrate multi-step workflows, and give users portable identity across your apps.

Built on [Cloudflare Workers](https://developers.cloudflare.com/workers/) (Python) with [D1](https://developers.cloudflare.com/d1/) for storage and [Queues](https://developers.cloudflare.com/queues/) for task and webhook dispatch (`runmesh-tasks`, `runmesh-webhooks`).

Backend for [Runmesh](../README.md) — a Cloudflare Worker (FastAPI + D1 + Queues).

## Features

- **Task API** — queue and dispatch HTTP tasks to any webhook URL, with UTC scheduling and idempotency
- **Workflows** — visual graph editor, webhook/cron triggers, linear step chains, and Jinja templates between steps
- **Runmesh Connect** — portable user identity for third-party apps via OTP login, OAuth providers, and scoped grants
- Dashboard with runs, workflow execution, analytics, API keys, and outbound webhooks
- Outbound webhook retries with dead-letter storage and replay
- Jinja2 task `url_template` / `payload_template` rendered at execution time
- Dual auth: JWT (dashboard) or API key (integrations) on `/api/v1` routes

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
cp .env.example .env.local   # if present, otherwise create one
pnpm dev
```

Set the API URL in `frontend/.env.local`:

```env
VITE_API_URL=http://localhost:8787
```

Open `http://localhost:5173`.

## Environment variables

Configure in `runmesh-main/wrangler.jsonc` under `vars` (use [Wrangler secrets](https://developers.cloudflare.com/workers/configuration/secrets/) for sensitive values in production).

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

## API overview

All JSON endpoints share a [consistent response envelope](./TASK_API_DOCUMENTATION.md#response-format).

| Route | Auth | Purpose |
|-------|------|---------|
| `GET/POST /api/v1/tasks` | JWT or API key | List / create tasks |
| `POST /api/v1/tasks/schedule` | JWT or API key | Schedule a future task |
| `GET/POST /api/v1/workflows` | JWT or API key | List / create workflows |
| `GET /api/v1/workflows/{id}` | JWT or API key | Workflow detail |
| `PUT /api/v1/workflows/{id}/graph` | JWT or API key | Save workflow graph |
| `POST /api/v1/workflows/{id}/trigger` | JWT or API key | Trigger a workflow run |
| `POST /api/v1/connect/apps` | JWT only | Register a Connect app |
| `POST /api/v1/connect/sessions` | Public (app credentials) | Start Connect user session |
| `POST /api/v1/connect/otp/verify` | Public | Verify OTP and authenticate |
| `GET /connect/authorize` | Public | OAuth authorization redirect |
| `GET /api/analytics` | JWT only | Dashboard metrics |
| `GET/POST /api/webhooks` | JWT only | Outbound webhook config |
| `GET/POST /api-keys` | JWT only | API key management |
| `GET /auth/github/login` | Public | Start GitHub OAuth |

Full reference: [TASK_API_DOCUMENTATION.md](./TASK_API_DOCUMENTATION.md)

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
# Backend with live reload
cd runmesh-main && uv run pywrangler dev

# Frontend
cd frontend && pnpm dev

# Frontend production build
cd frontend && pnpm build
```

Python type hints and autocomplete are available after `uv sync` — point your editor at `runmesh-main/.venv`.

## License

[MIT](../LICENSE)
