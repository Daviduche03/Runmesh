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
- **Durable execution** — HTTP tasks, UTC scheduling, and multi-step workflows with retries, idempotency, and replay.
- **Audit trail** — follow a token from request, to approval, to the action it authorized.
- **Dashboard** — runs, workflow execution, analytics, API keys, and outbound webhooks in one place.
- **Dual auth** — JWT for the dashboard, API keys for integrations, on `/api/v1` routes.

A single Bun process (Express + Drizzle) backed by SQLite — no external services,
runs on any VM or container host.

## Repository layout

```
Runmesh/
├── runmesh-ts/           Backend — Bun + Express + Drizzle, SQLite
├── frontend/             Dashboard + landing — React + Vite
└── legacy/runmesh-main/  Retired Python/FastAPI server, kept as the parity oracle
```

## Prerequisites

- [Bun](https://bun.sh/) 1.4+ (backend runtime, includes the SQLite driver)
- [Node.js](https://nodejs.org/) 20+ (frontend tooling)
- [pnpm](https://pnpm.io/) (package manager for both)

## Quick start

### 1. Database

Migrations apply automatically when the server starts, so there is nothing to run
first. On a blank database the schema is created from `schema.sql`.

To start from production data instead, see the migration notes in
[legacy/runmesh-main/DEPLOY.md](./legacy/runmesh-main/DEPLOY.md).

### 2. Backend

```bash
cd runmesh-ts
pnpm install
cp .env.example .env      # set JWT_SECRET at minimum
pnpm dev                  # or: bun src/main.ts
```

The API listens on `http://localhost:8787` by default. Migrations apply on boot:
a blank database is bootstrapped from `schema.sql`, then the files in
`migrations/` run in order.

Verify the backend:

```bash
pnpm typecheck            # tsc --noEmit
pnpm test                 # bun test (237 tests)
pnpm smoke                # 13 live checks against a running server
pnpm e2e                  # 30 live end-to-end checks
pnpm contract             # 27 checks over the dashboard's HTTP contract
```

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

Configure in `runmesh-ts/.env` (see [runmesh-ts/.env.example](./runmesh-ts/.env.example)).

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Secret for signing dashboard session tokens **and** webhook signatures |
| `DB_PATH` | Path to the SQLite database file (default `runmesh.db`) |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret |
| `FRONTEND_URL` | Dashboard origin for OAuth redirects (e.g. `http://localhost:5173`) |
| `PUBLIC_URL` | Public API URL used as OAuth callback base |

Storage is a single SQLite file; dispatch is a queue table the runtime polls.

## API overview

All JSON endpoints share a consistent response envelope (`{ ok, data, meta?, message?, error? }`).
Identity and access run through Connect; execution runs through tasks and workflows.

| Route | Auth | Purpose |
|-------|------|---------|
| `GET/POST /api/v1/tasks` | JWT or API key | List / create tasks |
| `POST /api/v1/tasks/schedule` | JWT or API key | Schedule a future task |
| `GET/POST /api/v1/workflows` | JWT or API key | List / create workflows |
| `GET /api/v1/workflows/{id}` | JWT or API key | Workflow detail |
| `PUT /api/v1/workflows/{id}/graph` | JWT or API key | Save workflow graph |
| `POST /api/v1/workflows/{id}/trigger` | JWT or API key | Trigger a workflow run |
| `GET /api/v1/workflows/{id}/runs` | JWT or API key | List workflow runs |
| `GET /api/v1/grants` | JWT only | List grants with scope/expiry/use limits |
| `POST /api/v1/connect/grants/{id}/approve` | JWT only | Approve a pending grant |
| `POST /api/v1/connect/sessions` | Public (app credentials) | Start Connect user session |
| `POST /api/v1/connect/otp/verify` | Public | Verify OTP and authenticate |
| `GET /connect/authorize` | Public | OAuth authorization redirect |
| `POST /api/v1/connect/token` | Public | Exchange Connect authorization code |
| `GET /api/analytics` | JWT only | Dashboard metrics |
| `GET/POST /api/webhooks` | JWT only | Outbound webhook config |
| `GET/POST /api-keys` | JWT only | API key management |
| `GET /auth/github/login` | Public | Start GitHub OAuth |

Full reference: [legacy/runmesh-main/TASK_API_DOCUMENTATION.md](./legacy/runmesh-main/TASK_API_DOCUMENTATION.md)
(the FastAPI implementation this server matches, endpoint for endpoint).

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

One process, one SQLite file on a mounted volume:

```bash
cd runmesh-ts
cp .env.example .env       # set JWT_SECRET, PUBLIC_URL, FRONTEND_URL
bun src/main.ts            # serves HTTP + queue workers + scheduler sweep
```

Historical deployment notes (including migrating production data off Cloudflare
D1) live in [legacy/runmesh-main/DEPLOY.md](./legacy/runmesh-main/DEPLOY.md).

Deploy the frontend separately (Cloudflare Pages, Vercel, etc.) and set
`VITE_API_URL` to the API origin.

## Development

```bash
cd runmesh-ts && pnpm dev        # bun --watch src/main.ts
cd frontend && pnpm dev
cd frontend && pnpm typecheck && pnpm build
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

See [SECURITY.md](./SECURITY.md) to report vulnerabilities.

## License

[MIT](./LICENSE)
