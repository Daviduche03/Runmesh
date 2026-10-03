# Deploying Runmesh on a VM (VPS)

Runmesh now runs as a plain Python process backed by SQLite. Cloudflare Workers
is no longer part of the runtime.

## Why

Cloudflare's cron entrypoint is broken for this app: every `scheduled()` tick
fails before reaching our code with

```
NoGilError: Attempted to use PyProxy when Python GIL not held
```

raised from `preparePython` / `initPyInstance`. It is a Pyodide/workerd bug
(cloudflare/workerd#6624), not ours — redeploying the same version does not
help. The effect is that `enqueue_due_tasks()` never runs, so scheduled tasks
stay `queued` forever. HTTP still worked, which is why the outage looked like
"scheduled jobs stopped", not "the API is down".

Rather than work around a platform bug, the runtime was ported off Cloudflare.

## What changed in the code

| Cloudflare | Replacement |
|---|---|
| `Default(WorkerEntrypoint)` in `src/entry.py` | `src/main.py` (`uvicorn`) |
| `env.DB` (D1) | `src/runtime/sqlite_db.py` — same `prepare().bind().run()/.first()/.all()` shape |
| `env.TASK_QUEUE` / `env.WEBHOOK_QUEUE` | `src/runtime/queue.py` — `queue_messages` table (migration `0044`) |
| `scheduled()` cron every minute | `src/runtime/runner.py` sweep loop (default every 5s) |
| `queue()` consumer | `src/runtime/runner.py` drain loop |
| `from workers import fetch` | `src/runtime/http_fetch.py` (httpx) |
| `request.scope["env"]` injected by the bridge | `src/runtime/asgi_env.py` |

Nothing else changed: routes, services, and the ORM are untouched.

## Migrating production data

```bash
cd runmesh-main

# 1. Export prod (read-only; takes a minute)
npx wrangler d1 export runmesh-db --remote --output prod.sql

# 2. Import into a SQLite file
python3 -c "import sqlite3,sys; c=sqlite3.connect('runmesh.db'); c.executescript(open('prod.sql').read()); c.commit()"

# 3. Boot — pending migrations apply automatically
cp .env.example .env   # then edit JWT_SECRET, PUBLIC_URL, FRONTEND_URL
DB_PATH=runmesh.db uv run python src/main.py
```

At step 3 the migrator reads `d1_migrations` from the dump and applies only what
is still missing. Prod is currently at `0017`, so it applies `0018`→`0044`.

A **blank** database is handled too: migration `0001` was never committed, so
`schema.sql` (a generated snapshot whose header records the migration range it
covers) is loaded first and those migrations are marked applied instead of
replayed — replaying them would fail on table-rebuild migrations such as `0012`,
which select from `_new` tables that only exist mid-rebuild.

## Running it

### Docker (recommended)

```bash
cp .env.example .env      # set JWT_SECRET, PUBLIC_URL, FRONTEND_URL
docker compose up -d --build
```

The SQLite file lives in the `runmesh-data` volume. Back it up with
`sqlite3 /path/to/volume/runmesh.db ".backup backup.db"` — do not copy the file
while the server is writing to it.

### Directly

```bash
uv sync --all-groups
DB_PATH=runmesh.db JWT_SECRET=... uv run python src/main.py
```

## Verifying a deployment

```bash
uv run python scripts/smoke_vps.py http://localhost:8787 <JWT_SECRET> /path/to/runmesh.db
```

13 checks: health, the agent archive lifecycle, immediate task execution, and —
the one that matters — a task created through `/api/v1/tasks/schedule` that must
sit in `queued` until its due time and is then dispatched by the sweep. That is
the exact behaviour Cloudflare's cron stopped providing.

## Configuration

`.env.example` is the source of truth. `JWT_SECRET` is required (it signs
sessions *and* webhook signatures). `PUBLIC_URL` must be the address callers
actually reach.

## Cloudflare after this change

`src/entry.py` no longer defines the `Default` worker class, so
`uv run pywrangler dev` and `uv run pywrangler deploy` will not serve traffic.
`wrangler.jsonc` and the `workers-py` dev dependencies are left in place but
dormant; removing them is a separate decision. Point the frontend at the new
origin — `VITE_API_URL` — and update any webhook senders to the new
`PUBLIC_URL`.
