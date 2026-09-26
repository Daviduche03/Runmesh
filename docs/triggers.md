# Triggers

Date: 2026-09-24
Status: Design for review. Not built.
Extends: `docs/agentic-infrastructure-strategy.md`, `AGENTS.md` (vocabulary, §6 IA).
Context: Guild's triggers page (`docs.guild.ai/platform/triggers`) — the comparison
that prompted this.

## How it works, in plain terms

Three actors:

- **Your agent app** — the code your team writes. It owns the agent (the model, the
  tools) and runs it; it is a web server with a URL.
- **Runmesh** — the middle. It holds credentials, checks policy, and records.
- **A trigger** — the thing that says *when* to run: a Slack mention, a clock, or an
  API call.

The key fact: **Runmesh does not run your agent — your app does.** Runmesh is the
receptionist; your app is the specialist.

A Slack mention, end to end:

1. **Setup (once).** The customer connected Slack through Runmesh; your team
   registered the agent and gave Runmesh your app's URL; someone created a trigger:
   *"on a Slack mention in this workspace, run the support agent."*
2. **The mention happens.** Runmesh receives the Slack event (it subscribed to the
   connection for you).
3. **Runmesh matches it** to the trigger and figures out who it came from (the
   customer, so the run can act on their behalf).
4. **Runmesh wakes your app up.** It opens a run record and calls your app's URL:
   `POST https://yourapp.com/agent` with `{ runId, message, user }`. This call is
   the whole trick — you never poll Slack.
5. **Your app runs the agent.** The agent's tool calls go through Runmesh as usual:
   credentials injected, rules checked, everything recorded under that run id.
6. **Reply and finish.** Your app replies; Runmesh marks the run done.

In the dashboard: **one run**, tagged *"started by the Slack trigger,"* with every
tool call and decision under it. That is the "single timeline" made real.

The three trigger types are the same story with a different wake-up: **Event**
(Slack/GitHub tells Runmesh), **Schedule** (the clock), **API** (someone calls
Runmesh). In all three, Runmesh's job is identical: notice it is time, and call
your app with the run id and the input.

What you build: **one URL in your app** that accepts that call and runs the agent —
essentially the "customer sent a message" handler you already have, with Runmesh as
the caller.

One simpler case: if the "agent" is just a Runmesh task (an HTTP call with no app
of its own), there is no URL to call and **Runmesh runs it directly** — same
trigger, no callback. That is the path we already have.

The rest of this document is the same design with the details.

## Why

Today a trigger fires a **workflow** or a **task**, not an agent run. That leaves
two execution models with a seam: triggers → tasks/workflows, while the
credential/consent/audit work lives in `agent_runs`/`agent_events`. `AGENTS.md`
names the symptom: *"actions (tasks) and access are separate streams; no single
agent → grant → action → result timeline."*

We also have no **event triggers**: ours is a raw inbound webhook you wire
yourself. Guild fires a run when an event happens in a connected service (a Slack
mention, a GitHub PR). We have the connections; nothing turns their events into
runs.

Goal: make a trigger **agent-native** — it opens an agent run, with the trigger as
the run's origin — and add **event triggers over Connect**. Keep our durability
(queues, retries, idempotency, dead-letter replay), which is ahead of a generic
trigger page.

## The constraint that shapes everything

**Runmesh does not execute agents.** The agent's loop and model live in the
caller's process (that is the whole interception design). Tasks/workflows are
Runmesh-executed HTTP; agents are not.

So "a trigger runs the agent" means Runmesh **dispatches to the agent**, it does
not run it. Two delivery modes, one of which is the default:

- **A — signed callback (recommended).** The trigger opens a run, then delivers a
  signed HTTP callback to the agent's registered endpoint. The caller's app runs
  the agent with that `run_id` and reports telemetry back through the existing
  pipeline. Reuse the shared signed-webhook delivery already used for tasks.
- **B — Runmesh-executed.** If the agent is declared as a Runmesh task/workflow
  (no external app), the trigger dispatches it directly. This is today's path,
  kept for compatibility.

## Model

A **Trigger** is a first-class row bound to an **agent** (not a workflow/task):

| Field | Notes |
| --- | --- |
| `id` | `trg_…` |
| `workspace_id` | tenancy |
| `agent_id` | the agent the trigger runs |
| `type` | `event` \| `schedule` \| `api` |
| `name`, `enabled`, `status` | activation without delete |
| `config` (JSON) | type-specific (below) |
| `input_schema` (JSON) | optional; validated against the dispatch input |
| `secret_hash` | for `api` triggers |
| `last_fired_at`, `created_at`, `updated_at` | |

Type configs:

- **schedule** — `{ "cron": "0 9 * * 1" }` and/or `{ "at": "<iso>" }`. Evaluated by
  the existing minute cron in `entry.py scheduled()` (granularity: one minute).
- **api** — authenticated `POST /api/v1/triggers/{id}/fire`. Auth by trigger key
  (`Authorization: Bearer trg_…`) or workspace JWT.
- **event** — a source over a Connect connection: `{ "connection_id", "provider",
  "event": "app_mention", "filters": [...] }`, plus a payload→input mapping.

## Event triggers over Connect

An event trigger subscribes to a connection's events; when one arrives, Runmesh
matches triggers and dispatches runs.

1. **Subscription** — where the provider supports webhooks, register one at
   `POST /api/v1/connect/events/{provider}` during trigger creation (Slack Events
   API, GitHub webhooks). For providers without webhooks, a polling "signal" is a
   later phase.
2. **Inbound** — the endpoint verifies the provider signature (e.g. Slack signing
   secret), dedupes by provider event id, resolves the connection → workspace, and
   matches enabled event triggers by `event` + `filters`.
3. **Principal** — the event's author maps to a `connect_user_id` when possible
   (a Slack user → the Connect user for that workspace). The run carries it, so
   `on_behalf_of` and policy have something to anchor on. If it cannot be resolved,
   the run is left un-principaled and policy decides.
4. **Map + validate** — the provider payload is mapped to the agent input, then
   validated against the trigger's `input_schema`.

MVP: **one provider** (Slack `app_mention` → run), to prove the loop.

## Dispatch lifecycle

```
fire (event | schedule | api)
  → resolve trigger + agent version + principal
  → map payload → input; validate against input_schema
  → open agent_run { agent_version_id, trigger_id, thread_id, connect_user_id, input }
  → audit run.started { origin: trigger }
  → deliver (A: signed callback to agent endpoint | B: execute task/workflow)
  → agent runs → telemetry back (events, finish)
```

Failure handling (Guild calls this *dispatch failures*; ours today lands in webhook
dead-letters):

- Invalid payload / input fails the schema / unresolved workspace variable / agent
  version deleted → record a **`system_error`** on the run (or a dispatch-failure
  row when no run could be opened) and stop. No silent pending.
- Delivery failure → existing retry + dead-letter + replay.

Idempotency: each fire gets a dedup key (`trigger_id` + provider event id, or
`trigger_id` + scheduled minute), stored in `idempotency_keys`, so a retry or a
duplicate event never double-runs.

## Lineage and audit

- `agent_runs.trigger_id` (nullable) — the origin.
- `GET /api/v1/triggers/{id}/runs` — every run a trigger spawned (Guild's
  `guild trigger sessions`).
- The run's thread carries the trigger origin into the audit timeline, so
  "trigger → run → tool calls → decisions → result" is one view. This is the seam
  closed.

## Data model (migration `0043`)

- `triggers` (as above; unique `(workspace_id, name)`).
- `agent_runs.trigger_id TEXT` (+ index).
- `agents.endpoint_url TEXT`, `agents.endpoint_secret_enc TEXT` — the signed
  callback target for delivery A (nullable; agents without one can only be
  Runmesh-executed).
- `trigger_subscriptions` (connection_id, provider, external_subscription_id) for
  webhook registration state.
- No change to `agent_events` — `system_error` is an existing-style `error` event
  with `name = "system_error"`.

## API surface

| Route | Notes |
| --- | --- |
| `POST/GET /api/v1/triggers` | create / list (JWT or API key) |
| `GET/PATCH/DELETE /api/v1/triggers/{id}` | manage |
| `POST /api/v1/triggers/{id}/activate` \| `/deactivate` | pause without delete |
| `POST /api/v1/triggers/{id}/fire` | `api` type; trigger key or JWT |
| `GET /api/v1/triggers/{id}/runs` | lineage |
| `POST /api/v1/connect/events/{provider}` | inbound provider events (public, signature-verified) |

The old `workflow.trigger_type` / `task.scheduled_at` paths keep working; they are
delivery mode B. Migration of existing workflow/task triggers is out of scope.

## Phasing

1. **Trigger entity + agent-native dispatch (schedule, api).** Open a run, deliver
   via signed callback, record `trigger_id`, expose lineage. Closes the seam for
   the triggers we already have.
2. **Dispatch failures + input schema + dedup.** `system_error` on the run,
   schema validation, idempotency keys.
3. **Event triggers over Connect** (Slack first): subscribe, verify, match, map,
   principal resolution.
4. **Unify the audit timeline** around trigger → run → decisions → result.

## Open questions

1. **Delivery A vs B default.** Does every agent register an endpoint (A), or is B
   (Runmesh-executed) the default and A opt-in? A is the tight fit; it needs the
   agent app to expose a callback.
2. **First event provider** — Slack (`app_mention`) or GitHub (PR/issue)?
3. **Input schema source** — on the trigger, or on the agent version (so it travels
   with the definition)? Leaning agent version.
4. **Do we migrate existing workflow/task triggers**, or run both indefinitely?
5. **Schedule granularity** — minute cron today; is sub-minute needed?
6. **Event filters** — a small predicate language, or JSONPath, or provider-native
   query strings?
