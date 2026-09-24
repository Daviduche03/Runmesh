# ICP and Demand

Date: 2026-09-24
Status: Working definition, for review. Not committed positioning.
Extends: `docs/agentic-infrastructure-strategy.md`, `AGENTS.md` (authority model).

## The profile in one line

**Teams building or operating an AI agent that takes real actions on behalf of
their end users** — on a bought platform, a custom build, or a hybrid — and who
therefore own the agent but not the third-party systems it acts on.

Runmesh is not competing with Zendesk, Intercom Fin, Sierra, or Decagon. It is
the layer *beneath* the agent: the credential, consent, policy, and audit plane
for the actions the agent takes.

## Who it is

Mode A (delegated / embedded), per `AGENTS.md`: a product's agent acts for *its
users*. The operator is the product team, not the end user and not Runmesh.

Characteristics:

- Owns the agent's loop, tools, and backend; does not own the SaaS it calls.
- An agent takes state-changing actions (refund, cancel, comment, reset, send).
- Actions run **on behalf of a specific end user**, so delegated consent and
  per-user credentials matter.
- Volume is high enough that a human cannot approve each action.
- A wrong action is costly enough that a dispute must be explainable.

**Anti-ICP (deliberately not the first target):**

- Teams that only want read-only RAG/FAQ deflection (no real actions).
- Companies whose agents act only for internal employees (Mode B) — a later
  expansion, on the same primitives.
- Anyone shopping for a support *chatbot* vendor — that is a different market.

## Demand evidence

Directional, not precise. "Hand-rolled support agents" is not measured directly;
these are the closest proxies. Vendor-published numbers are marked (V) and read
as marketing.

| Source | Measures | Signal |
| --- | --- | --- |
| McKinsey, State of AI 2026 (1,719 orgs; May–Jun 2026) | Declined a purchase to build in-house with coding agents | **32%** (tech 41%, healthcare 39%, prof. services/energy 38%); **~47%** of high performers vs 31% of others |
| Retool, Build vs Buy 2026 (817 builders; late 2025) | Replaced ≥1 SaaS tool with a custom build | **35%**; 78% plan more; support is a named category |
| Menlo Ventures (495 US decision-makers) | AI use cases purchased vs built | **76% bought / 24% built** (from 53/47 a year earlier) |
| MIT NANDA (300 deployments) | Success rate | internal builds **~33%**, vendor **~67%** |
| Gartner | Agentic project failure forecast | **>40%** of agentic projects canceled by 2027; only **17%** of orgs have deployed agents (CIO survey 2026) |
| Salesforce, State of Service (Nov 2025) | Service orgs running AI agents | **66%**, up from 39% |
| CB Insights (Jan 2026) | Support-AI vendor concentration | largest vendor **18.8%**; top four <51%; 15 vendors |
| Presenc AI (2026) | Support-AI buying posture | **58%** run multi-vendor; 87% plan to invest this year |
| Wizeb / Evolveamz (2026) (V) | Support build-vs-buy posture | **~47–70% hybrid** (buy platform, build the agent layer) |
| ETR, Macro Views (Summer 2026) | Sustained ROI at scale | build **16%** vs vendor **13%** |
| Gartner / Corporate Compliance Insights | Governance gap | only **~18%** of enterprises have AI governance frameworks |
| McKinsey, State of AI 2026 | Cost pressure | **~1 in 5** orgs already constrain AI use on operating cost |

### What the evidence says

1. **Most AI is still bought (76%), but the build share is real and growing** —
   roughly a third of orgs now build at least something they would have bought.
2. **Pure custom support agents are a minority.** Vendors draw the line at
   ~50K–1M conversations/year, unique workflows, or strategic differentiation;
   below that, buying wins on TCO.
3. **Hybrid is the dominant pattern** — buy the platform, build the agent and
   tooling. That means the agent layer itself is increasingly *the team's own*.
4. **The market is fragmented and unsettled** — no support-AI vendor above 19%,
   most buyers running two vendors. Weak incumbents leave room for a layer.
5. **Governance and cost are the binding constraints**, not model capability —
   exactly the layer Runmesh occupies.

## Why the support-agent archetype

It is the sharpest single scenario because it exercises the entire loop at once:

- **Authorize** — refund ≤ $X auto; a comment needs the customer's consent;
  above the threshold a human decides.
- **Execute** — durable, retried, exactly-once (a refund must not double-run).
- **Record** — the dispute trace: who, on behalf of whom, under what policy,
  with what result.

And it hits the adoption trigger directly: *"the agent worked in a demo, but
production actions are unreliable, hard to observe, or scary to authorize."*

## Buying trigger

The team has an agent in production that acts for users, and cannot answer:

- Which end user authorized this action, and can we prove it?
- How do we scope a credential to one user and one action, and expire it?
- How do we gate an irreversible action without approving everything by hand?
- When a customer disputes it, how do we reconstruct exactly what happened?

## What this means for Runmesh

- The wedge is the **control loop** — authorize, execute, record — with
  credential isolation and delegated consent as the defensible core
  (`docs/agent-sdk-interception.md`).
- The support-agent scenario is a **test target**, not the market definition.
  The market is "teams that own an agent acting for users," which is larger and
  growing faster than the pure-support-custom segment.
- Adoption should meet those teams where they are: an open-source layer that
  works with the model/framework/helpdesk they already run.

## Evidence quality

- **Different questions, different populations.** McKinsey/Retool measure
  "build vs buy" decisions broadly; Menlo measures AI use-case sourcing; MIT/ETR
  measure outcomes. They are not directly comparable and none isolates "support
  agents."
- **Vendor bias.** Support-specific build-vs-buy posts (Twig, Aivastark,
  Evolveamz, Dextralabs, Wizeb) are written to sell platforms; treat their
  numbers as directional.
- **No trend line** for the McKinsey 32% (first year asked).

## Sources

- McKinsey, *State of AI: Global Survey 2026* (Aug 2026).
- Retool, *Build vs. Buy Shift* (Feb 2026); Menlo Ventures enterprise AI survey;
  MIT NANDA; Gartner; Salesforce *State of Service* (Nov 2025).
- CB Insights support-AI market map (Jan 2026); Presenc AI landscape (2026);
  ETR *Macro Views* (Summer 2026).
- Vendor build-vs-buy analyses: Twig, Evolveamz, Aivastark, Dextralabs, Wizeb
  (2026) — directional only.
