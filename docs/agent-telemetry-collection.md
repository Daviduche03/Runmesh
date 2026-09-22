# Agent Telemetry Collection

Date: 2026-09-19
Status: Design note. Phase 1 is being built; phases 2-3 are scoped, not started.

## The Idea

Agents are registered by observation, not by form. A thin wrapper around the agent
SDK the team already uses (Vercel AI SDK first) reports what it sees: agent
definitions, run lifecycle, and tool I/O. The directory builds itself from traffic,
so it cannot drift from reality the way a manually maintained registry does.

This is the APM model applied to agents. Nobody fills in a form to register a
service with Datadog; the agent directory should work the same way.

## Identity

Two halves, both required:

- **Explicit id.** Accepted from wrapper config (`agentId`, `name`). Stable, but devs
  will skip it and collide on it. Never the only key.
- **Fingerprint.** Hash of framework + model + system prompt + tool names. Zero-config,
  but churns on every prompt edit.

Resolution: explicit id wins when present, fingerprint otherwise. A fingerprint change
on a known id is a **new version of the same agent**, not a new agent. Prompt edits
become version history for free, which is the "agents as versioned artifacts" story
without asking anyone to declare versions.

## Subagents

Identity is a **path**, not a concatenated string: `atlas/researcher-01`. Paths compose
to arbitrary depth and query by prefix.

Each level carries two parts:

- a stable **key** (the subagent's role or name — identity across runs, answers "how
  does researcher behave over time")
- a run-scoped **instance** id (this specific invocation — identity within a trace)

This mirrors OpenTelemetry's trace-to-span hierarchy. Adopt OTel naming rather than
inventing. The backend already stores the tree: `agents.parent_agent_id` exists, and
runs carry an optional parent run.

## What Gets Collected

Two different things, stored separately:

**Definition** — a versioned artifact, deduplicated by hash. Framework, model plus
parameters, system prompt (full text stored once per version), tool schemas, SDK
version, provider. New hash means new version.

**Recording** — belongs to the run. Input, each tool call (name, arguments, result,
timing), each model response, token usage, errors, policy decisions. Durations are
real; anything synthesized is labeled as such.

Replay is defined as definition-at-version-N plus recording with tools stubbed. That
answers "does it still behave," not byte-identical reproduction. Do not promise
determinism beyond that.

## API

Three endpoints, batch-friendly. All workspace-scoped, all authenticated as today.

| Endpoint | Job |
| --- | --- |
| `PUT /api/v1/agents:resolve` | Upsert by workspace plus external key or fingerprint. Returns the canonical id, and whether the fingerprint opened a new version. |
| `POST /api/v1/runs`, `POST /api/v1/runs/:id/finish` | Run lifecycle. Start takes the agent id, an optional parent run for subagents, and an input reference. |
| `POST /api/v1/ingest` | Batched events: tool calls, model I/O, policy decisions. Non-blocking by contract; the wrapper buffers and flushes. |

## SDK Shape

One `BaseAdapter` contract, one module per SDK (`packages/agent/src/adapters/`,
mirroring the frontend's `src/modules/`; shared primitives in `src/core/` like
`src/lib/`). A single wrap function cannot cover every SDK — tool shapes,
delegation surfaces, and model middleware all differ — so each SDK implements
`extractDefinition` plus `wrapTools` and inherits the shared resolve flow.
Vercel ships first; OpenAI Agents SDK is next. Behavior, per adapter:

- captures the definition once per version, never per run
- streams run events in batches, never blocks the agent loop on network
- truncates tool results at a fixed cap, samples when configured, redacts before send

The wrapper is a delivery truck. The credential, policy, and consent layer behind the
ingest endpoint is the product.

## Risks, Stated Plainly

- **PII and secrets.** Prompts, arguments, and results routinely contain both.
  Collect-everything-by-default makes this layer radioactive. Redaction, truncation,
  per-tool opt-out, and retention limits are day-one requirements, not polish.
- **Volume.** Tool results can be megabytes. Caps and sampling from the start.
- **Coverage gaps.** Client-side tools, approvals outside the wrapper, direct provider
  calls — all invisible. The wrapper sees what flows through it, nothing more.
  Document the boundary.
- **Replay fidelity is bounded.** Stated above; do not oversell it.
- **Adapter treadmill.** One framework at a time, starting with Vercel AI SDK. Each new
  SDK surfaces delegation differently and needs its own adapter.

## Phases

1. **Directory and audit.** Definition capture, run start and finish, tool calls with
   arguments, results, and timing. The agents directory and the run record for free.
2. **Replay.** Full I/O capture with redaction, plus stubbed re-execution.
3. **Trees and cost.** Subagent path identity across runs, usage rollups, spend
   attribution.

## Decisions

1. Wrapper location: a `packages/` directory in this repo. The next build creates it
   with the TS wrapper, its own package.json, and its build setup.
2. Prompt storage: both. Full `system_prompt` text per version plus `fingerprint` as
   the lookup key and change tripwire. Already how phase 1 works.
3. Redaction: the built-in pattern list ships now (`api_key`, `secret`, `token`,
   `password`, `authorization`, and kin — values stored as `[REDACTED]`). Per-workspace
   custom patterns land in phase 2.
4. Sampling: store everything for now; volumes are tiny. Controls arrive when volume
   justifies them — wrapper config first, workspace default later.

## Open Questions

None. All four resolved 2026-09-19.

## Source Notes

- The wrapper-vs-framework argument this note implements:
  `docs/agent-sdk-interception.md`
- Existing Runmesh strategy this note extends:
  `docs/agentic-infrastructure-strategy.md`
- Backend authority model the recordings feed:
  `AGENTS.md` (authority, enforcement, audit sections)
