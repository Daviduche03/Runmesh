# AGENTS.md — Runmesh orientation

This is the **root orientation document** for anyone (human or agent) working on Runmesh. Read this first, then read [`runmesh-main/AGENTS.md`](./runmesh-main/AGENTS.md) for Cloudflare-specific rules.

If you only remember one thing: **Runmesh is being repositioned from "async infrastructure" into the control plane for AI agents.** Most work should move the product toward identity, access, approvals, execution, and audit — in that order of emphasis. Do not add features that pull it back toward being a generic task queue.

---

## 1. What Runmesh is

> **Runmesh is the action layer for agents.** It sits between an agent's *intent* and a *real action*: it decides whether the action is allowed, executes it durably, and records it.

Three verbs, done as one thing:

1. **Authorize** — policy decides by default; the end user consents; a human only handles exceptions.
2. **Execute** — durable tasks, schedules, and workflows on queues (retries, idempotency, replay).
3. **Record** — every action tied to an agent, grant, approver, and result.

**The one sentence we own:** *Consent, policy, and a receipt for everything your agents do.*
**The pitch:** *Agents propose. Runmesh authorizes, executes, and records.*

**What we are not** (this matters more than what we are):

- Not observability — we are *upstream*. Langfuse watches what happened; we decide what is allowed.
- Not an agent framework — we govern agent actions; we do not build agents.
- Not "OAuth for agents" alone — Arcade/Composio/Nango proxy authenticated calls; we own policy + escalation + execution + audit as one loop.
- Not the human identity provider — Connect is a means to delegated consent, not the product.

**What we do not compete on:** the phrase "agent identity." Okta/Auth0 and Microsoft Entra Agent ID own that fight and have distribution. Our wedge is the bundled loop above, open source, with the consent/policy/escalation model. See the competitive map before repositioning.

Runmesh runs on Cloudflare Workers (Python/FastAPI) with D1 for storage and Queues for dispatch. It is the open-source substrate that combines:

1. **Identity** — an agent is a principal, not a shared API key.
2. **Access** — credentials scoped to an agent, task, resource, and expiry.
3. **Approvals** — a human in the loop when policy requires it.
4. **Execution** — durable HTTP tasks, schedules, and multi-step workflows.
5. **Audit** — every action explainable and (for webhooks) replayable.

### The story we tell

For thirty years we built a discipline around human access — identity, least privilege, approvals, audit. Then a new actor arrived: it doesn't sleep, it can act thousands of times a minute, and today we hand it a long-lived API key with every scope, no expiry, and no record of what it did.

The missing layer is not another tracing dashboard. It is **control**. Runmesh is that layer: your agents get an identity and a leash, and you get the receipt.

### Positioning guardrails (do not violate)

- **Do not** describe Runmesh primarily as "task execution / webhooks / workflow automation." That is the substrate, not the product.
- **Do not** frame it as an "LLM observability" tool. Observability is the *result* of control, not the product. Do not compete with tracing dashboards.
- **Do** lead with agents, identity, grants, approvals, and audit.
- Keep the tone: plain, technical, no hype, no emoji, no "AI-powered."

---

## 2. Domain vocabulary

Use these terms consistently in code, API, and UI. New code should match.

| Term | Meaning | Where it lives |
|------|---------|----------------|
| **Agent** | A non-human principal that requests access and takes actions. Identified by an `agent_id` string. | `tasks.agent_id`, `workflows.agent_id`, `agent_sessions.agent_id`, `connect_grants.agent_id` |
| **Agent session** | One unit of agent activity, optionally tied to a thread, workflow, connect app, or workspace project. | `agent_sessions` table (migration `0015`) |
| **Action / Task** | The execution primitive. One durable unit of work (`action_kind`, `tool_name`, `action_name`). Stored in `tasks`. | `tasks` table; exposed as "Actions" in the UI |
| **Workflow** | A graph of actions with a webhook/cron trigger and Jinja templating between steps. | `workflows`, `workflow_runs`, `workflow_graph.py`, `workflow_runner.py` |
| **Grant** | A scoped authorization for an agent to use a Connect connection. Carries scope, resource filters, expiry, use limits, and approval state. | `connect_grants`; `connect.py` |
| **Scope** | The permission attached to a grant (OAuth-level today; moving to action-level like `github.issue.create`). | `connect_grants.scopes` |
| **Resource filter** | Extra constraint on a grant, e.g. `{ "repo": "org/name", "label": "trusted" }`. | `connect_grants.resource_filters` (migration `0018`) |
| **Approval** | A human decision required before a grant or a task proceeds. | `connect_grants.approval_status`, `tasks.approval_status`, `agentic` grant endpoints |
| **Policy** | (Target) Rules that decide what auto-approves vs. waits for a human, scope caps, spend limits, auto-revoke. **Not built yet.** | — |
| **Connect app** | A third-party app that delegates user identity/access through Runmesh. | `connect_apps`; `/api/v1/connect/apps` |
| **Connect user** | The end user whose identity is anchored (currently by verified email). | `connect_users`; `connect.py` |
| **Connection** | A stored provider credential (GitHub, Google, …) for a Connect user. | `connect_connections` |
| **Workspace project** | A linked project prefix in Runmesh Workspace (cloud file sync). Executions may reference it. | `workspace_projects` |
| **Audit event** | Immutable record of a grant/token/approval/action outcome. | `connect_audit_events` |
| **Thread** | The grouping key for audit. Agent runs open (`th_*`) or inherit one; the serializer treats a run as a trace under its thread, and call-time `policy.decision` rows chain via the decision's run. Events with no thread (mint-time decisions, admin changes) stay honestly unchained. | `agent_runs.thread_id`, `policy_decisions.run_id` (migration `0037`) |

### Approval state machines

**Grant** (`connect_grants.approval_status`, migration `0018`):
```
pending_approval → approved → (expired)
                 → denied
```
Grants are **pending until explicitly approved** (no backward-compat auto-approve).

**Action** (`tasks.approval_status`):
```
not_required | pending | approved | denied
```
Set `not_required` by default; use `pending` when an action must wait on a human.

---

## 3. Current state vs. target

The repositioning is **partially implemented**. Know what already exists before rebuilding it.

### Implemented (verify before touching)

- Schema for the agent envelope: migration `0015_agentic_action_metadata` adds `action_kind`, `action_name`, `agent_id`, `agent_session_id`, `thread_id`, `tool_name`, `actor_user_id`, `approval_status`, `approval_id`, `connect_app_id`, `connect_grant_id`, `connect_session_id`, `workspace_project_id`, `metadata` on `tasks`; similar columns on `workflows`/`workflow_runs`; plus the `agent_sessions` table and indexes.
- Agentic Connect: migration `0018_agentic_connect_grants` adds `created_by_task_id`, `created_by_workflow_run_id`, `agent_id`, `approval_status`, `valid_from`, `valid_until`, `resource_filters` to `connect_grants`, and enriches `connect_audit_events`.
- Resource + use limits: migration `0019_p2_resource_scoping` adds `max_uses`, `use_count`.
- Environment scoping: migration `0020_p4_env_scoping` adds `project_id`, `environment` (`dev|staging|prod`).
- Connect service already exposes: `list_grants_by_agent_id`, `list_grants_by_task_id`, `list_grants_by_workflow_run_id`, `approve_grant`, `deny_grant`, `get_grant_context`, `get_current_grant`, `get_connect_metrics`, `list_audit_events`.
- API routes already exist:
  - `GET /api/v1/connect/grants`
  - `POST /api/v1/connect/grants/{grant_id}/approve`
  - `POST /api/v1/connect/grants/{grant_id}/deny`
  - `GET /api/v1/connect/grants/current`
  - `GET /api/v1/connect/apps/{app_id}/grants`
  - `GET /api/v1/connect/audit`
  - `GET /api/v1/connect/metrics`
  - `GET /api/v1/connect/tokens`
  - `GET /api/v1/tasks/{task_id}/grant_status`
  - `GET/POST/DELETE /api/workspace/projects`
- Landing page + README already tell the control-plane story.

### Not built / gaps

- **Policies** — no rule engine for auto-approval, scope caps, spend limits, or auto-revoke.
- **Agents as first-class entities** — there is no `agents` table or `/api/v1/agents` route; `agent_id` is currently a free-form string on tasks/grants.
- **Dashboard IA** — the app still navigates as a workflow builder (see §6). No control-room home, no dedicated Agents/Grants/Approvals/Policies/Audit screens.
- **Unified audit** — actions (`tasks`) and access (`connect_audit_events`) are separate streams; there is no single "agent → grant → action → result" timeline.
- **Async token issuance** — the P3 backlog item (task pauses in `waiting_for_grant`, resumes on approval) is designed but not implemented.
- **Production readiness** — see the gap table in [`runmesh-main/AGENTS.md`](./runmesh-main/AGENTS.md). Notably: sequential workflow runner, one active run per workflow, poll-based run UI, `print()`-only observability, limited tests.

The authoritative roadmap lives in [`BACKLOG.md`](./BACKLOG.md) (Runmesh Connect P0–P4). Treat the P-numbers there as the source of truth for sequencing.

---

## 4. Architecture

```
runmesh-main/                Cloudflare Worker (Python)
  src/entry.py               FastAPI app + Default() worker entrypoints
  src/routes/*.py            One APIRouter per domain (system, tasks, workflows,
                               webhooks, api_keys, connect_*, workspaces, auth,
                               dashboard); registered in entry.py in file order
  src/services/*.py          Business logic (async functions; Connect is split into
                               connect_* submodules behind the connect.py facade)
  src/db/*.py                ORM / table access (orm.py, connect_orm.py + connect_orm_*
                               submodules, schema.py)
  src/utils/*.py             auth, responses, errors, rate limit, url safety
  migrations/*.sql           D1 migrations (numbered, append-only)
  schema.sql                 Reference schema snapshot
  TASK_API_DOCUMENTATION.md  Full API reference

frontend/                    React 19 + Vite + react-router + zustand
  src/app/router.tsx           Nested routes (createBrowserRouter: RequireAuth → AppShell)
  src/config/                  site.ts branding, nav.tsx sidebar navigation (navGroups)
  src/modules/<feature>/       One folder per domain (agents, grants, audit, policies,
                               connect, runs, workflows, dashboard, settings, workspace,
                               onboarding, auth, landing, workspace-landing):
                               *.page.tsx + colocated components/ + sections/
  src/components/layout/       AppShell / sidebar / header (Outlet-based, shared)
  src/components/ui/           Primitives (radix + tailwind)
  src/components/              Only truly shared primitives (empty-state, logo, …)
  src/lib/stores/              Zustand stores (call src/lib/api.ts)
  src/App.tsx                  Thin wrapper around AppRouter
```

### Worker entrypoints

`Default` in `src/entry.py` implements three handlers:

- `fetch` — the FastAPI HTTP API.
- `queue` — consumers for `runmesh-tasks` and `runmesh-webhooks`.
- `scheduled` — cron `* * * * *`; enqueues due standalone scheduled tasks and starts due scheduled workflows.

> `src/scheduler.py` was removed. **Do not reintroduce a separate scheduler worker** — scheduling lives in `entry.py`'s `scheduled()`.

### Conventions

- **Routing:** routes live in `src/routes/<domain>.py` as `APIRouter`s, registered in `src/entry.py` via `app.include_router(...)` in file order (order matters for matching — keep it). `entry.py` keeps only app creation, middleware, exception handlers, and the `Default` entrypoints. Handlers stay thin: parse params, resolve workspace, delegate to `services/`.
- **Responses:** always use the shared envelope in `src/utils/responses.py`. Do not hand-roll JSON shapes.
- **Auth:** `src/utils/dual_auth.py` — JWT (`Authorization: Bearer`) for the dashboard, API key (`X-API-Key: rk_...`) for integrations. Connect public endpoints use app credentials.
- **DB access:** go through the ORM modules in `src/db/`. New columns/tables require a new numbered migration in `migrations/` **and** an update to `schema.sql`.
- **Naming:** snake_case in Python/DB, camelCase in the frontend types. Keep UI labels aligned with the vocabulary in §2 ("Actions", not "Tasks", in user-facing copy).
- **Shared types** live in `src/utils/types.py` (facade over `types_{helpers,enums,requests,connect}`); import from the facade, not the submodules.
- **No comments unless necessary**; match surrounding style.

### Frontend conventions

- Landing pages use the `--rm-*` CSS tokens and the components in `modules/landing/` (`SectionHeading`, `SectionLabel`, `constants`). Extend those; do not introduce a parallel design system.
- Dashboard routes are wired in `src/app/router.tsx` (nested: `RequireAuth` → `AppShell` via `Outlet`); sidebar items in `src/config/nav.tsx` (`navGroups`).
- Data fetching via zustand stores in `src/lib/stores/` calling `src/lib/api.ts`. New feature UI goes in `src/modules/<feature>/` (`*.page.tsx` + colocated `components/`); only truly shared primitives go in `src/components/`.
- Run `pnpm typecheck` and `pnpm lint` before finishing. (There are pre-existing lint errors in `use-mobile.ts` and `workflow-graph.ts` — do not add new ones.)

---

## 5. How to run

```bash
# Backend (Cloudflare Worker, port 8787)
cd runmesh-main
uv sync --all-groups
cp .dev.vars.example .dev.vars
uv run pywrangler d1 migrations apply runmesh-db --local
uv run pywrangler dev

# Frontend (port 5173)
cd frontend
pnpm install
printf 'VITE_API_URL=http://localhost:8787\n' > .env.local
pnpm dev
```

Queues (create once, before deploying):

```bash
cd runmesh-main
wrangler queues create runmesh-tasks --message-retention-period-secs 86400
wrangler queues create runmesh-webhooks --message-retention-period-secs 86400
```

Deploy:

```bash
cd runmesh-main
uv run pywrangler deploy
uv run pywrangler d1 migrations apply runmesh-db --remote
```

There is no backend test command configured yet (a gap). Frontend verification is `pnpm typecheck` + `pnpm lint` + `pnpm build`.

---

## 6. Application flow — the important change

**Current app** is a workflow builder. Sidebar (`app-shared.tsx`): Product → Overview, Actions, Workflows, Workspace; Access → Connect; System → Settings. The hero objects are tasks/workflows and the user's job is "create and run."

**Target app** is a control room. The hero objects are **Agents** and **Grants**, and the user's job is "decide and watch." The recurring action is an **approval**, not a build.

Primary loop:

```
agent requests access → lands in Approvals queue → human approves/denies
  → action executes durably → appears in the audit trail
```

Target IA:

| Screen | Job |
|--------|-----|
| **Control room** (home) | What needs me now: escalations, running agents, anomalies |
| **Escalations** (`/approvals`) | The exceptions policy could not decide; approve/deny with reason |
| **Agents** (`/agents`, `/agents/:id`) | Directory + profile: access held, activity, kill switch |
| **Grants** (`/grants`) | **Central surface** — consent and scoped access issued on behalf of users |
| **Connect** (`/connect`) | Registered OAuth apps and identity providers |
| **Policies** (`/policies`) | What auto-approves, scope caps, spend limits, auto-revoke rules |
| **Actions / Workflows** | Task and workflow execution + replay |
| **Audit** (`/audit`) | Unified stream: agent → grant → action → result |
| **Settings** | Identity providers, API keys, webhooks |

Key principle: **home is "what needs me," not "create a task."** The Agent page is the profile page; the audit trail is the logs.

### The authority model (resolved)

The primary mode is **A — delegated / embedded**: a product's agent acts on behalf of *its users*. Therefore a human in the operator dashboard is **not** the default approver — at scale that is absurd. Authorization is:

```
approval_actor = policy | end_user | operator
```

- **`policy`** — auto-decide (the default). Standing grants, resource allowlists, spend caps, expiry.
- **`end_user`** — consent/confirmation in the *product's* UI, via Runmesh Connect (`/connect/consent`, grants).
- **`operator`** — a human in the Runmesh dashboard. This is the **exception path** (Mode B: a company's own first-party agents, or out-of-policy delegated actions).

Consequences:

- `connect_grants.approval_status` should default to **auto/policy** when a standing grant exists; `pending_approval` is the rare case.
- The old "Approvals queue" concept is **policy-first, consent-based, escalate-on-exception**. The dashboard surfaces **Escalations** (exceptions) and **Policy**, not a firehose.
- The dashboard's center of gravity is **Grants** (what an agent is allowed to do, on whose behalf, until when), not an approve-everything queue.

Mode A is the beachhead; first-party/internal (Mode B) and enterprise governance are the expansion path on the same primitives.

### The enforcement model (how policy binds an agent we don't manage)

One-line truth: **you cannot enforce policy on an action you never see.** So enforcement is not "better rules" — it is forcing the action through a point where policy decides. Three layers:

1. **Capabilities by default — shrink ambient authority to ~zero.**
   The agent holds nothing durable. Every action needs a capability only Runmesh can mint, and the capability encodes the constraint: one token per `(agent, action, resource, window)`, with `valid_until`, `max_uses`, and `resource_filters`. Policy evaluates **at issuance**, not during the action. Leaked tokens die on their own (short TTL + use counts). This is the cheap/common path.

2. **Inline proxy for the dangerous.**
   For money-movement, destructive, and cross-boundary writes, the agent calls **our** tool endpoint; we check policy against the live request and forward with **our** stored credential. The agent never sees the real secret. This is the only way to observe, hold, and kill an individual action mid-session — and it is also how we compensate for coarse provider scopes (what the provider cannot express, e.g. "only repo X", we enforce at the proxy; where the provider has a fine-grained model, e.g. GitHub Apps installation tokens, we lean on it).

3. **Detective everywhere.**
   Where we cannot be inline we are in detect-and-revoke, not prevent: hash-chained audit, anomaly signals, and revocation that is near-instant because TTLs are short. Assume breach; keep blast radius tiny and visible.

**Layer 1 is live at grant issuance.** `services/policy_engine.py` is a pure
evaluator (first match wins, log-only rules never decide); `services/policies.py`
runs it at issuance via `enforce_grant_issuance` and records every decision in
`policy_decisions`.

- **Full mode** (`POST /api/v1/grants`): allow → auto-approve, escalate/consent →
  `pending_approval`, deny → blocked (403). Unmatched falls to **default deny**
  once the workspace has at least one enabled enforce rule; with none, issuance
  proceeds (policy is off until you turn it on).
- **Restrictive mode** (the consent path, `_ensure_grant`): only an explicit
  enforced deny blocks. The end user's act is the authority there, so policy may
  forbid but never auto-approve.
- **The action identity is server-derived.** At issuance the unit of authority is
  a provider connection, so the action is the provider (`github`). Requests carry
  no action label and cannot self-approve. When the tool-call path lands, the
  action must likewise come from the registered tool catalog — never from the
  wrapped agent's runtime string. That is the rule that keeps this a control
  rather than theater.
- Every enforced decision also emits a `policy.decision` audit event. Oversight
  metrics on the Policies page are computed from `policy_decisions`, not fixtures.

What is already built for this:

| Mechanism | Primitive |
|---|---|
| Policy evaluation at issuance | `policy_engine.evaluate` + `policies.enforce_grant_issuance` |
| Decision ledger | `policy_decisions` (+ `policy.decision` audit) |
| JIT issuance + attenuation | `connect_grants` (`valid_until`, `max_uses`, `resource_filters`, `project_id`/`environment`) |
| Inline observation | tasks/workflows as the execution path; `waiting_for_grant` |
| Human backstop | `approval_required`, `approval_status`, Connect consent |
| Detective layer | `connect_audit_events` (task/workflow/agent context) |

Explicitly missing: **policy evaluation on the tool-call path** (layer 2,
including the rerouted-execute proxy and suspension for approvals) — today policy
governs what authority an agent is *granted*, not each call it makes;
**sender-constrained tokens** (DPoP/key-bound issuance, so stolen tokens can't be
replayed); and **per-provider fine-grained adapters** (the GitHub-Apps
installation-token pattern generalized).

Honest boundary (design around it, don't pretend otherwise): once data leaves, it's gone — an agent can exfiltrate by copy-paste, and a prompt-injected agent misuses *legitimate* authority. The mitigation is the same model: per-action least privilege, plus human gating above a threshold.


---

## 7. Related projects (portfolio context)

- **Warmbox** (`~/Documents/code/go/warmbox`, Go module `runmesh/workspace`) — cloud workspace / execution layer. README currently calls it "Runmesh Workspace," which collides with this project's brand. **Intent:** fold it in as the execution layer (ephemeral agent sandboxes operating on real project files) and rename to remove the collision. Until then, treat it as a separate side project with a WIP status.
- **Weldrr** (`~/Documents/code/javascript/Weldrr`) — AI-assisted SDK/docs generation using agent sandboxes. Shares the "agent execution" thesis; not part of this repo.

Runmesh is a **side project**, not the owner's primary company. Keep changes self-contained, open-source friendly (MIT), and documented. Do not let scope creep turn it into something that can't be maintained on weekends.

---

## 8. Working agreement for agents

1. **Read before you write.** `src/entry.py`, the relevant `services/*.py`, and the migrations.
2. **Preserve the positioning.** If a change makes Runmesh look like a generic task queue again, stop and reconsider.
3. **Schema changes are migrations.** Never edit `schema.sql` alone; add the next numbered file in `migrations/`.
4. **One API envelope.** Use `src/utils/responses.py`.
5. **No new design system.** Extend `landing-page/` tokens and `components/ui/`.
6. **Verify frontend:** `pnpm typecheck && pnpm lint`.
7. **Update this file** when you implement a major piece from §3 or §6, so the next agent starts from truth.
8. **Cloudflare knowledge may be stale.** Fetch current docs (see `runmesh-main/AGENTS.md`) before Workers/D1/Queues changes.
