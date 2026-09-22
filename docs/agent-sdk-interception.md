# Agent SDK Interception Layer

Date: 2026-09-19
Status: Design note. Not decided, not committed. Captured so the reasoning survives.

## The Idea

Instead of forcing developers into a Runmesh SDK and authoring format, wrap the agent
SDK they already use (Vercel AI SDK first) and intercept at the tool boundary. Capture
tool definitions, tool calls, and tool execution as they flow through, and resolve the
things the framework does not: credentials, delegated user consent, and attribution.

Same enforcement goal as Guild. Opposite adoption cost: they own your runtime, we
intercept the one you already run.

## Why The Correction To Guild Still Holds

Guild requires `@guildai/agents-sdk` and `zod`, forbids external imports, and blocks all
egress except their proxy. It works and it carries $44M, but it caps adoption at
greenfield agents written after the decision to adopt, and it leaks badly (no
`Promise.all`, `for await` silently downgraded, async orchestrators that cannot be split
across files, values held across an `await` failing on resume with errors that
type-check and pass tests).

The durable layer in this category is the boundary, not the authoring format. Own the
boundary and you are compatible with every framework. Own the SDK and you are compatible
with one.

## What Vercel AI SDK Already Ships

This is the finding that reshapes the note. As of AI SDK 7, the policy-at-the-tool-
boundary half of the original idea is first-party and open source:

| Surface | What it does |
| --- | --- |
| `toolApproval` callback | Approve, deny, or require approval per tool call. `requires-approval` pauses the run and waits for a human `tool-approval-response`. |
| `@ai-sdk/policy-opa` | OPA/Rego policies plugged into `toolApproval`. Decisions: `allow`, `deny`, `requires-approval`, `not-applicable`. WASM in-process or a live OPA server. Fails closed. |
| `shadow(approval, { enforce })` | Log-only rollout. Reports every decision via `onDecision` while approving everything until enforcement is flipped. |
| `opaCapabilityMiddleware` | Narrows `params.tools` before the model is told the tools exist. Fail-closed. |
| `wrapMcpTools(tools, approval, { default })` | Makes approval total over a discovered MCP surface; uncovered tools default to `user-approval`. |
| Transitive enforcement guidance | Parsing dispatcher tools (bash, HTTP, MCP proxy) down to a logical call so a coarse tool cannot bypass a per-action rule. |

Consequences, stated plainly:

1. **"We enforce policy at the tool boundary" is no longer a wedge.** Vercel ships it,
   and their own docs say the package "sits entirely on top of the public `toolApproval`
   callback." Building a parallel policy engine would be rebuilding `@ai-sdk/policy-opa`.
2. **Suspension is solved.** The open question from the first draft is answered:
   `requires-approval` pauses and resumes. Returning a "pending" tool result is no longer
   the only option.
3. **Log-only mode is validated.** `shadow` is exactly the policy simulator and
   log-only rollout already planned for the Policies page.
4. **An interop decision is now forced.** Our policy UI should almost certainly author
   and compile to Rego rather than run its own evaluator. Interoperate with OPA, do not
   compete with it.

## What Those Surfaces Do Not Cover

Read against the same docs, four things are conspicuously absent:

- **Credentials.** `toolApproval` decides *whether* a call happens. Nothing decides
  *where the secret comes from*. The tool still needs a token. No vaulting, OAuth, token
  issuance, or rotation appears anywhere in this surface.
- **Delegated user consent.** The policy input is `{ tool, args, messages, runtimeContext }`.
  `runtimeContext` carries operator concepts like role. There is no "this end user
  granted this agent access to their GitHub account." Mode A, on-behalf-of an external
  user, is not expressible.
- **Execution location.** Vercel punts explicitly: once a tool is approved it may perform
  side effects beyond its input, and the stated fix is "run untrusted execution in an
  out-of-band sandbox and treat the sandbox as the trust boundary."
- **Cross-framework.** All of this is Vercel's. LangChain, OpenAI Agents SDK, and
  Mastra users get none of it.

That gap is exactly the layer already chosen: credential isolation, delegated consent,
and attribution. Vercel commoditized the decision. The credential is still ours.

## Two Seams, Two Layers

Both seams are in-process:

| Seam | What it sees | What it can do |
| --- | --- | --- |
| `wrapLanguageModel` middleware | Prompts, params, responses, tool definitions | Observe, transform, narrow capabilities |
| Wrapping each tool's `execute` | The side effect and the credential | Gate, inject, reroute, record |

**Interception observes; it does not enforce.** A library in the caller's process can be
bypassed by calling the underlying SDK directly. Interception gives audit, cost, testing,
and observability for free and forever. Real enforcement means the call cannot succeed
any other way.

**Rerouting `execute` enforces.** The developer keeps their tool schema; `execute`
becomes "call Runmesh, get the result." The model sees the same tools. The credential
never enters the process. Policy is checked at the one point the side effect happens.

The defensible composition: our layer plugs into their `toolApproval` as the
credential-and-consent resolver. Their callback asks "is this allowed." We answer
"allowed, and here is a scoped, short-lived credential for the specific end user this is
being taken on behalf of" — or "not allowed, this user has not connected that account."

## Latency, Honestly

WASM-based OPA evaluation in-process is Vercel's own recommended default, so local
decision-making with no network hop is a proven pattern here, not a hope. Local policy
evaluation costs approximately nothing. Credential-bearing calls take one hop, and only
on tool calls, not per token. That is the OPA/Envoy split.

## The Hard Part Is No Longer Interception Or Suspension

Both exist. The remaining hard parts are ours:

1. **Binding a call to the right principal.** Resolving which end user a tool call is
   being made on behalf of, and finding or refusing their connection.
2. **Issuing the credential.** Just-in-time, narrowly scoped, short-lived, revocable,
   audit-stamped, and never held in the caller's process.
3. **The trust boundary.** Vercel names the sandbox as the answer and hands it off. That
   is a product scope, not a footnote.

## Capabilities That Fall Out Of The Same Boundary

Not already covered by Vercel's surface:

- **Record and replay**: capture real tool calls, replay as CI fixtures. Pure developer
  value, no governance politics. Still the best adoption wedge.
- Credential isolation and injection
- Delegated user consent, and the connect flow it triggers on first use
- Idempotency keys and safe retries on tool calls
- Secret and PII redaction on arguments and results
- Cross-framework reach (LangChain, OpenAI Agents SDK, Mastra)

Already Vercel's, do not rebuild: per-tool allow/deny, capability narrowing, log-only
rollout, MCP tool-surface defaults.

## Verdict

**Great as a wedge. Not great as a product. Less differentiated than the first draft
assumed.**

The mechanism is how every LLM observability vendor gets in, and now Vercel ships the
policy layer natively. A wrapper is copyable in a week. So the wrapper is not the
product; it is the delivery truck, and it is a thinner truck than it looked yesterday.

What is defensible is what sits behind the seam: credential isolation and delegated user
consent. Nobody in Vercel's surface does either, and their own docs hand off the trust
boundary. That layer is the idea.

The test: if a competitor ships the identical wrapper tomorrow, what remains true? Only
the credential and consent layer. That is the actual company, and it is the layer
already being built.

## When It Is Great vs Fine

- **Great if** the wrapper plugs into `toolApproval` as the credential and consent
  resolver, with the server-side vault behind it, and stays thin enough to ride Vercel's
  API rather than fork it.
- **Fine if** it becomes a second agent framework, an adapter treadmill, or an attempt
  to replace `@ai-sdk/policy-opa`.

## Risks

- **First-party encroachment is now proven, not hypothetical.** Vercel shipped the policy
  layer once. They could ship credentials next. The dependency is real.
- Adapter treadmill. Target the two stable seams, model middleware and plain `execute`
  wrapping, plus the public `toolApproval` callback.
- TypeScript-only caps the market, though the AI SDK for Python is in beta, which
  softens it.
- MCP may make host-side consent native, narrowing the wrapper's reach. Advantage: teams
  with inline tools never adopt MCP.
- The policy engine decision can be deferred by compiling to Rego, but it cannot be
  deferred forever.

## Positioning

| Compared to | Their role | Our role |
| --- | --- | --- |
| Guild | Owns your runtime, forces their SDK | Intercepts the runtime you already run |
| Vercel AI SDK | Decides whether a call is allowed | Supplies the scoped credential and the user's consent, and records it |
| Langfuse et al. | Observe what happened | Authorize and attribute it |

## Open Questions

1. ~~Does Vercel AI SDK expose a suspend/approval hook?~~ Resolved: yes, `requires-approval`.
2. Does the policy UI compile to Rego and inherit OPA, or run a bespoke evaluator?
3. Does the wrapper ship as an open-source package that calls a hosted vault, or as a
   hosted client from the start?
4. First target: Vercel AI SDK only, or a framework-agnostic `execute` shim from day one?
5. Does record-and-replay ship first, to earn adoption before governance is asked for?

## Source Notes

- Vercel AI SDK policy-based tool approvals, `@ai-sdk/policy-opa`, `shadow`,
  `opaCapabilityMiddleware`, `wrapMcpTools`:
  https://sdk.vercel.ai/docs/agents/policy-tool-approvals
- Vercel AI SDK language model middleware, `wrapLanguageModel`:
  https://sdk.vercel.ai/docs/ai-sdk-core/middleware
- Vercel AI SDK tool approvals (underlying `toolApproval` callback):
  https://sdk.vercel.ai/docs/agents/tool-approvals
- Guild SDK constraints and runtime isolation:
  https://docs.guild.ai/guide/sdk-introduction, https://docs.guild.ai/guide/tasks
- Guild funding and positioning:
  https://www.guild.ai/knowledge/guild-raises-44m-agent-control-plane
- Existing Runmesh strategy this note extends: `docs/agentic-infrastructure-strategy.md`
