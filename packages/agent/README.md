# @runmesh/agent

Observe-only telemetry for agent SDKs. Wrap the tools you already have; get a
run record, tool I/O capture, and a versioned agent directory without changing
what your agent does.

v0 observes only. It does not enforce, gate, or reroute execution.

## Install

```sh
pnpm add @runmesh/agent
```

Node 18+. Zero runtime dependencies.

## Use

One call — the same line count as the raw SDK:

```ts
import { generateText } from "ai";
import { RunmeshClient, vercelAdapter } from "@runmesh/agent";

const client = new RunmeshClient({
  endpoint: "https://your-runmesh-domain",
  apiKey: process.env.RUNMESH_API_KEY!,
});

const result = await vercelAdapter.runText(client, {
  agent: "triage",
  generateText, // injected: this package stays dependency-free
  model,
  system: "You triage the inbox.",
  tools: { github_issues_get },
  prompt: "Summarize issue 42.",
  passthrough: { stopWhen: stepCountIs(5) },
});
```

That one call resolves (cached by definition fingerprint, so no roundtrip
when nothing changed), opens the run, wraps tools, runs `generateText`,
finishes with usage, and flushes. Thrown errors mark the run failed and
rethrow unchanged. Pass `parentRunId` for subagent linkage.

Granular primitives, for custom loops, streaming, and manual status:

// Resolve once per deploy. Same definition twice returns the same agent;
// a changed definition opens a new version, never a fork.
const agent = await vercelAdapter.resolve(
  client,
  {
    model: "claude-sonnet-4-5",
    systemPrompt: "You triage the inbox.",
    tools: { github_issues_get },
  },
  { externalKey: "triage" },
);

const run = await client.startRun({ agentId: agent.id, input: "triage inbox" });

// Same shape in, same shape out. Every execution is recorded with redacted
// arguments, the result, and duration. Recording failures are swallowed;
// original errors rethrow unchanged.
const tools = vercelAdapter.wrapTools({ github_issues_get }, { client, runId: run.id });

// ... your agent loop runs here, calling tools as normal ...

await client.finishRun(run.id, { status: "completed", usage: { tokens: 1200 } });
await client.close(); // flush and stop the background timer
```

Subagents: start the child run with `parentRunId` set to the parent run id.
Identity convention is a path (`atlas/researcher-01`): a stable key per role
plus a run-scoped instance, mirroring OpenTelemetry trace-to-span naming.

## Contract

- `resolveAgent`, `startRun`, `finishRun` throw on transport failure, so a dead
  pipeline is loud at setup.
- `record`, `flush`, and every wrapped `execute` never throw for telemetry
  reasons. Telemetry must not break the agent.
- Fingerprints are `fp_` + 16 hex chars of SHA-256 over the canonical
  definition (framework, model, prompt, sorted tool names). Compute it locally
  or let `resolveAgent` do it when `fingerprint` is omitted.
- Payloads cap at 8KB with a `truncated` flag. Values under secret-shaped keys
  (`api_key`, `secret`, `token`, `password`, `authorization`, …) are stored as
  `[REDACTED]`, client-side and server-side.
- Events batch (default 50, background flush every 2s) and drop on persistent
  transport failure, surfaced via `onError`. Telemetry is at-most-once by
  design; sequence numbers stay dense per run server-side.

## Structure

Mirrors the frontend: framework-agnostic primitives in `core/`, one module
per supported SDK in `adapters/`. A single `wrapTools` cannot cover every
SDK — tool shapes, delegation surfaces, and model middleware all differ —
so each SDK gets an adapter behind a shared contract:

```ts
import { BaseAdapter } from "@runmesh/agent";

class OpenAIAdapter extends BaseAdapter<OpenAIInput> {
  readonly framework = "openai-agents";
  extractDefinition(input) { /* normalize to { framework, model, systemPrompt, tools } */ }
  wrapTools(tools, ctx) { /* interpose, preserve shape and behavior */ }
  // resolve() is inherited: normalize, fingerprint, upsert.
}
```

`wrapTools` at the package root remains as the Vercel convenience. The next
adapter (OpenAI Agents SDK) adds `adapters/openai.ts` and nothing else moves.

## Performance

Measured with `pnpm bench` (Node 24, Apple Silicon, 20k iterations —
in-process only; network flush happens off the hot path by design):

| Operation | Mean | p95 |
| --- | --- | --- |
| Bare tool execute (no wrapper) | 0.4µs | 0.3µs |
| Wrapped execute (production path) | 1.2µs | 1.8µs |
| Definition fingerprint | 2.6µs | 3.6µs |
| Redact small args | 1.4µs | 1.3µs |
| Redact large result (200 items) | 30–115µs | 30–323µs |
| `client.record()` buffer push | 0.4µs | 0.2µs |

The wrapper adds roughly **1µs per tool call** — about a thousand times below
anything observable next to real tool work (milliseconds to seconds). The one
cost that scales is redaction, which walks the payload: ~0.1ms for a large
result, still noise against network I/O. Flush is fire-and-forget by
construction; the suite proves `execute` completes even with the endpoint
unroutable.

## What v0 does not do

Enforcement, policy gating, credential injection, model-call capture, replay
mode, or browser runtimes (`node:crypto`, `setInterval.unref`). Those are
phases 2-3; this package is the capture half they stand on.
