# runmesh-ts

TypeScript implementation of the Runmesh API. Same HTTP contract as `../runmesh-main`
(the FastAPI server it replaces), same SQLite schema and migrations, idiomatic
Express + Drizzle on the inside.

`runmesh-main/` stays runnable as the parity oracle until cutover.

## Stack

| Concern | Choice |
|---|---|
| Runtime | Bun (`bun:sqlite`, TS executed directly — no build step) |
| HTTP | Express 5 |
| Data | Drizzle ORM + `bun:sqlite` |
| Validation | zod |
| Tokens | `jose` (HS256 JWT) |
| Tests | `bun test` |

## Run

```bash
bun install
cp .env.example .env      # set JWT_SECRET at minimum
bun run dev               # http://localhost:8787
```

Migrations apply on boot: a blank database is bootstrapped from `schema.sql`
(snapshot of migrations 0001–0042) and the remaining files in `migrations/` run
in order.

Verify:

```bash
bun run typecheck
bun test
```

## Layout

```
src/
  main.ts                  composition root: migrate, DB, queues, runner, server
  app.ts                   Express app (CORS, JSON, context, routes, errors)
  routes.ts                route mounting, in the same order as entry.py
  core/                    must not import from modules/
    config.ts              zod-validated environment, camelCase
    db/                    client, Drizzle schema, typed table models
    auth/                  JWT tokens, API-key hashing
    http/                  response envelope, error mapping, request context
    middleware/            context, auth, error handler, validation
    runtime/               migrations, DB-backed queue, worker loops
    types/                 shared helpers/enums
  modules/<domain>/        one folder per domain: routes.ts, service.ts, ...
tests/core/                unit + HTTP + schema-drift tests
migrations/                authoritative SQL, append-only
schema.sql                 bootstrap snapshot (do not edit by hand)
```

`core/` is the lower layer: when something would be needed by both `core/` and a
module, it moves into `core/` rather than creating a cycle. Cross-module use goes
through the module's `index.ts`.

## What is portable and what is not

Kept on purpose (external contracts):

- **Response envelope** — every endpoint returns `{ ok: true, data }` or
  `{ ok: false, error: { code, message } }`.
- **Wire field names** — snake_case JSON (`avatar_url`, `created_at`, …), because
  the frontend is not being rewritten.
- **Schema and migrations** — byte-identical SQL; `schema.ts` mirrors the migrated
  database and a drift test fails if they diverge.
- **Webhook signature header** — `t=<ts>,v1=<hmac>`, verified by receivers.
- **Stored ciphertext** — the `v2.` connect-vault format stays readable.

Deliberately idiomatic (not byte-compatible with the Python server):

- **JWT** tokens are standard HS256 JWTs (`sub` = user id). The frontend treats
  tokens as opaque, so existing sessions simply re-login on cutover.
- **Timestamps** are `new Date().toISOString()` (`...Z`). Only comparisons made by
  the same server matter, so mixed-format rows are harmless.
- **Config** is a typed singleton (`config.dbPath`), not an uppercase `env.DB`
  binding map.
- **No Cloudflare shims** — no D1-shaped `prepare().bind()`, no `env` object.

## Status

Done:

- core layer (config, schema mirror, table models, auth, envelope/errors,
  middleware, migrations, queue, runner), `/`, `/health`, `/api/me`
- **policy evaluation engine** (`src/modules/policies/engine.ts`) — pure, no DB,
  verified against 47 vectors generated from the Python engine by
  `scripts/gen-policy-vectors.py`
- **workspace tenancy** (`src/modules/workspace/`) — membership gate, personal
  workspace provisioning, onboard/list/invites, project links
- **auth** (`src/modules/auth/`) — GitHub OAuth login/callback/exchange, CLI
  device-code flow, verification page
- **agents** (`src/modules/agents/`) — create/list/archive identities (public
  key kept private, fingerprint exposed)
- **API keys** (`src/modules/api-keys/`) — mint/list/deactivate, workspace-scoped
- **policies service + routes** (`src/modules/policies/`) — rule CRUD/reorder,
  dry-run, coverage gaps, capability matrix, issuance enforcement and the
  decision ledger (`policy_decisions` + `policy.decision` audit rows)
- **audit ledger** (`src/modules/connect/audit.ts`) — the shared append-only
  writer connect will build on

Pending: the remaining domain modules (tasks, workflows, webhooks, api keys,
connect, dashboard), their route registration in `routes.ts`, and the
task/webhook handlers injected into the runner in `main.ts`. Until those land the
queue consumers and scheduler sweep are wired but have no handlers.

Port order (dependencies, not preference): `tasks`/`webhooks`/`api-keys` →
`workflows` → `connect` → `dashboard`.

## Policy

Policy is the default approver, not a detail of Connect. It is its own module with
two tables (`policy_rules`, `policy_decisions`), a decision ledger, and eight
endpoints under `/api/v1/policies`.

The engine is a pure function and the only piece verified against the Python
oracle before being wired up:

- first match wins; `log-only` rules are recorded as shadows and never decide
- unmatched falls to the default (`deny`); the *caller* decides whether the
  default applies — at issuance it only applies once a workspace has at least one
  enabled enforce rule, otherwise issuance proceeds
- the action identity is derived server-side (`buildActionIdentity(provider)`),
  never from a label the calling agent supplies

`scripts/gen-policy-vectors.py` regenerates the vectors from
`runmesh-main/src/services/policy_engine.py`; the TypeScript must reproduce them
exactly.
