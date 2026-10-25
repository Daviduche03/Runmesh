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

Done: core layer (config, schema mirror, table models, auth, envelope/errors,
middleware, migrations, queue, runner), `/`, `/health`, `/api/me`, tests.

Pending: the domain modules in `src/modules/` (auth, tasks, workflows, webhooks,
api keys, connect, workspace, dashboard), their route registration in
`routes.ts`, and the task/webhook handlers injected into the runner in
`main.ts`. Until those land the queue consumers and scheduler sweep are wired
but have no handlers.
