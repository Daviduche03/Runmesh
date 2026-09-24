# Record and Replay

Date: 2026-09-24
Status: Decided and being built. Phases 1-2 in progress.
Extends: `docs/agent-sdk-interception.md`, `docs/agent-telemetry-collection.md`.

## Decision

Record-and-replay ships first, before more governance work. It is the acquisition
wedge, not the moat: it earns adoption on read-only agents, with no credentials and
no governance politics, and it is the on-ramp to the credential/consent layer.

## Two things, kept separate

| | Behavior replay | Trace playback |
| --- | --- | --- |
| Question | "Does my agent still behave?" | "What happened, and why?" |
| What runs | The agent loop, re-executed | Nothing; you scrub the recording |
| Where | Caller's process (CLI) or browser | Server + UI |
| Side effects | None (tools stubbed) | None |
| Output | A replay run + a diff | A step-through view |

## The constraint that shapes the design

The backend cannot re-run an arbitrary agent: the loop, local tool bodies, and model
credentials live in the caller's process. For the declarative shape the wrapper
supports (`{model, system, tools, prompt}`), the agent can be **reassembled** from a
version snapshot plus the recorded trace. What is not recoverable:

- local tool `execute` bodies (the dev's code) — tools are **stubbed** from the recording;
- custom orchestration beyond the declarative shape;
- model credentials — deterministic replay mocks the model from the recording; live
  replay needs keys and is deferred;
- un-recorded runtime state. Payloads are size-capped and secrets are redacted, so
  replay is **lossy by construction**. It does not promise byte-determinism.

## Architecture

| Piece | Where |
| --- | --- |
| Versions | `agent_versions` table; `agent_runs.agent_version_id` FK; immutable |
| Recording | `packages/agent` — model I/O capture alongside tool I/O |
| Replay engine | `packages/agent` — isomorphic, `ai` injected, tools stubbed |
| CLI | `runmesh replay <run_id>` in `packages/agent` (Node), for CI |
| UI button | browser runs the same engine; result POSTs back as a replay run |
| Trace playback | `TraceView`, so it works at run and thread granularity |
| Backend | Python: store versions, runs, diffs only |

One engine, two hosts (Node CLI and browser), no second runtime. A JS replay worker
is deferred until live replay, scheduled runs, or heavy runs demand it.

## Versions

`resolve_agent` used to overwrite the definition in place when the fingerprint
changed, losing exactly what replay needs. Definitions are now immutable: each
fingerprint change inserts a new `agent_versions` row. A run is pinned to the version
it executed. The run does **not** also carry a denormalized snapshot — one source of
truth until version retention forces a second.

## Diff semantics

Volatile fields (timestamps, uuids, key order) are normalized always; without that,
every replay fails.

- Default: fail on divergence in tool calls (name + normalized args), decisions
  (allow/deny/escalate), and structured output. Ignore model prose.
- `--strict`: compare everything, including prose (for deterministic same-version runs).

The signal that matters is "did it call a different tool or get a different decision?"
Failing on wording makes CI flaky and gets the check muted.

## Phases

1. ~~Versions (`0042`) + pin runs. Record model I/O.~~ Done.
2. ~~Replay engine in `packages/agent` + `runmesh replay` CLI.~~ Done.
3. ~~Trace playback in `TraceView` (run and thread, one component).~~ Done.
4. ~~Replay runs + diff in the UI.~~ Done — lineage badge and a diff panel in the
   run view. The diff travels as a `replay.diff` log event, so no separate
   `/diff` endpoint is needed.
5. Deferred: server-side policy re-evaluation; live replay; JS replay worker;
   UI-triggered re-run via a user callback. A UI button cannot execute a replay
   because the browser holds neither the model nor the local tool bodies.
