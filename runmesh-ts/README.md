# runmesh-ts

The Runmesh API server. Same HTTP contract as the FastAPI implementation it
replaced (`../legacy/runmesh-main/`), same SQLite schema and migrations, idiomatic
Express + Drizzle on the inside.

`legacy/runmesh-main/` is kept read-only as the parity oracle: when in doubt about
a wire-level behaviour, that is the reference.

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
pnpm install
cp .env.example .env      # set JWT_SECRET at minimum
pnpm dev                  # bun --watch src/main.ts, http://localhost:8787
```

The frontend points at this server with `VITE_API_URL=http://localhost:8787`
(see `../frontend/.env.example`).

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

## Cutover from the FastAPI server

The frontend needs no code change: same base URL (`http://localhost:8787`), same
envelope, same snake_case payloads. What to expect when switching the process:

1. **Everyone signs in again.** The legacy server minted `base64(payload).signature`
   tokens; this server issues standard HS256 JWTs, so old tokens fail verification.
   The dashboard clears its stored token on any `401` and redirects to `/login`.
2. **Token claims are part of the contract.** `frontend/src/lib/stores/auth-store.ts`
   decodes the session payload, so session and CLI tokens carry
   `{ sub, id, email, name }` — `id` duplicates `sub` on purpose.
3. **Same database file.** `DB_PATH` can point at an existing SQLite file: this server
   applies the same migrations and reads the `v2.` vault ciphertext as-is.
4. **Background work moves in-process.** Queue consumption and the 5s scheduler sweep
   run inside the server; do not run the legacy process against the same file.

Checklist:

```bash
cd runmesh-ts && pnpm test && pnpm typecheck   # unit + types
bun src/main.ts                                 # boot on the shared DB
pnpm contract                                   # dashboard contract
pnpm e2e                                        # every module end to end
pnpm smoke                                      # scheduler/queue behaviour
```

## Verification

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # bun test — 237 tests across 21 files
```

Three scripts run against a live server (start it first, or pass a URL):

```bash
pnpm smoke     # 13 checks, incl. the scheduler only firing after the due time
pnpm e2e       # 30 checks across every module, incl. live queue + HMAC callbacks
pnpm contract  # 27 checks over exactly the HTTP paths the dashboard calls
```

`scripts/frontend-contract.ts` is the cutover guard: it seeds fixtures and asserts
the response shapes each zustand store in `frontend/` depends on (field names,
list-vs-object, `meta.total`). Reach for it before changing a serializer.

## Status

Feature-complete against the FastAPI server: all 16 route modules are ported
(system, auth, workspace, agents, api-keys, policies, webhooks, tasks, workflows,
connect, tools, collection, triggers, dashboard), with 99 route handlers matching
the Python route table.

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
`legacy/runmesh-main/src/services/policy_engine.py`; the TypeScript must reproduce
them exactly.
