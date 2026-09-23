#!/usr/bin/env node
// The "tier-1 customer" app: a real Vercel AI SDK agent wired through
// @runmesh/agent (runText + wrapTools under the hood). The model is a
// scripted mock — no network, no keys — but every tool call goes through
// the real resolve → run → wrap → invoke pipeline against the local backend.
import { generateText, stepCountIs } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { RunmeshClient, vercelAdapter, managedTool } from "@runmesh/agent";

const API = process.env.RUNMESH_URL ?? "http://localhost:8787";
const MOCK = process.env.MOCK_URL ?? "http://localhost:8799";
const TOKEN = process.env.RUNMESH_TOKEN;
if (!TOKEN) {
  console.error("RUNMESH_TOKEN is required");
  process.exit(2);
}

const SYSTEM = "You are Acme's support copilot. Use tools when the ticket needs them.";
const MODEL_ID = "acme-mock-e2e";
const CONNECT_USER = "cu_demo";

const usage = () => ({
  inputTokens: { total: 4, noCache: 4, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
});

/** Everything the model has seen as tool output, in order — the driver
 *  asserts on this, so refusals/consent/scrubbing are proven model-visible. */
function collectResults(prompt) {
  const out = [];
  for (const msg of prompt) {
    if (msg.role !== "tool") continue;
    for (const part of msg.content ?? []) {
      if (part.type !== "tool-result") continue;
      const o = part.output;
      out.push({
        toolName: part.toolName,
        value: o && typeof o === "object" && o.type === "json" ? o.value : o,
      });
    }
  }
  return out;
}

function scriptedModel(steps) {
  let i = 0;
  return new MockLanguageModelV4({
    modelId: MODEL_ID,
    doGenerate: async ({ prompt }) => {
      const step = steps[Math.min(i, steps.length - 1)];
      i += 1;
      if (step.toolCalls) {
        return {
          content: step.toolCalls.map((tc, idx) => ({
            type: "tool-call",
            toolCallId: `call_${i}_${idx}`,
            toolName: tc.name,
            input: JSON.stringify(tc.input ?? {}),
          })),
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage: usage(),
          response: { id: `mock_${i}`, modelId: MODEL_ID },
        };
      }
      const saw = collectResults(prompt);
      return {
        content: [{ type: "text", text: step.text ?? JSON.stringify({ saw }) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: usage(),
        response: { id: `mock_${i}`, modelId: MODEL_ID },
      };
    },
  });
}

const goodTools = {
  gmail_send: managedTool({
    provider: "google",
    action: "google.gmail.send",
    url: `${MOCK}/gmail/send`,
    method: "POST",
    description: "Send an email from the connected Gmail account.",
    inputSchema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
  }),
  gmail_modify: managedTool({
    provider: "google",
    action: "google.gmail.modify",
    url: `${MOCK}/gmail/modify`,
    method: "POST",
    description: "Modify labels on a Gmail message.",
    inputSchema: z.object({ id: z.string(), addLabel: z.string() }),
  }),
  gmail_draft: managedTool({
    provider: "google",
    action: "google.gmail.draft",
    url: `${MOCK}/gmail/draft`,
    method: "POST",
    description: "Create a Gmail draft.",
    inputSchema: z.object({ to: z.string(), body: z.string() }),
  }),
  gmail_labels: managedTool({
    provider: "google",
    action: "google.gmail.labels",
    url: `${MOCK}/gmail/labels`,
    method: "POST",
    description: "List Gmail labels.",
    inputSchema: z.object({}),
  }),
  slack_post: managedTool({
    provider: "slack",
    action: "slack.chat.postMessage",
    url: `${MOCK}/slack/post`,
    method: "POST",
    description: "Post a Slack message.",
    inputSchema: z.object({ channel: z.string(), text: z.string() }),
  }),
  slack_delete: managedTool({
    provider: "slack",
    action: "slack.chat.delete",
    url: `${MOCK}/slack/delete`,
    method: "POST",
    description: "Delete a Slack message.",
    inputSchema: z.object({ channel: z.string(), ts: z.string() }),
  }),
  slack_post_fw: managedTool({
    provider: "slack",
    action: "slack.chat.postMessage",
    baseUrl: MOCK,
    description: "Forward-mode Slack post: the dev's own request, routed.",
    inputSchema: z.object({ channel: z.string(), text: z.string() }),
    execute: async (args, ctx) => {
      const res = await ctx.fetch("/slack/post", {
        method: "POST",
        body: { channel: args.channel, text: args.text },
      });
      return res.json();
    },
  }),
  refund_lookup: {
    description: "Look up a refund for an order (runs in-process).",
    inputSchema: z.object({ orderId: z.string() }),
    execute: async ({ orderId }) => ({
      orderId,
      refund: { amount: 19.99, status: "issued" },
    }),
  },
};

// Declared managed but missing url → server demotes to local + warns →
// wrapTools must fail loudly instead of silently running it uncredentialed.
const badTools = {
  ghost_send: managedTool({
    provider: "google",
    action: "google.ghost",
    description: "Broken declaration: managed, but no url.",
    inputSchema: z.object({ to: z.string() }),
  }),
};

const call = (name, input) => ({ toolCalls: [{ name, input }] });
const ECHO = {}; // default final step: echo everything the model saw

const idemArgs = {
  to: "idem@example.com",
  subject: "Duplicate submit",
  body: "The form was double-clicked.",
};

function scriptFor(name) {
  switch (name) {
    case "resolve":
      return [{ text: "resolved" }];
    case "allow":
      return [
        call("gmail_send", { to: "cara@example.com", subject: "Re: invoice", body: "Invoice attached." }),
        ECHO,
      ];
    case "deny":
      return [call("slack_delete", { channel: "#general", ts: "1710000000.000100" }), ECHO];
    case "escalate":
      return [call("gmail_modify", { id: "msg_9", addLabel: "STARRED" }), ECHO];
    case "policy_consent":
      return [call("gmail_draft", { to: "dan@example.com", body: "Draft reply" }), ECHO];
    case "default_deny":
      return [call("gmail_labels", {}), ECHO];
    case "consent":
    case "resume":
    case "exhausted":
      return [call("slack_post", { channel: "#support", text: "Ticket #42 answered" }), ECHO];
    case "forward":
      return [call("slack_post_fw", { channel: "#support", text: "Forwarded update" }), ECHO];
    case "local":
      return [call("refund_lookup", { orderId: "ord_77" }), ECHO];
    case "idempotent":
      return [call("gmail_send", idemArgs), call("gmail_send", idemArgs), ECHO];
    case "failure":
      return [call("gmail_send", { to: "fail@example.com", subject: "Boom", body: "?" }), ECHO];
    case "misconfig":
      return [call("ghost_send", { to: "nobody@example.com" }), ECHO];
    default:
      throw new Error(`unknown scenario: ${name}`);
  }
}

async function main() {
  const scenario = process.argv[2] ?? "allow";
  const script = scriptFor(scenario);
  const misconfig = scenario === "misconfig";
  const client = new RunmeshClient({
    endpoint: API,
    apiKey: TOKEN,
    flushIntervalMs: 50,
    onError: (err) => console.error("[client]", err),
  });
  try {
    const result = await vercelAdapter.runText(client, {
      agent: misconfig
        ? { externalKey: "acme-misconfig", name: "Acme Misconfig Agent" }
        : { externalKey: "acme-support-copilot", name: "Acme Support Copilot" },
      generateText,
      model: scriptedModel(script),
      system: SYSTEM,
      tools: misconfig ? badTools : goodTools,
      prompt: `Acme e2e: ${scenario}`,
      connectUserId: CONNECT_USER,
      passthrough: { stopWhen: stepCountIs(script.length) },
    });
    console.log(JSON.stringify({ scenario, text: String(result?.text ?? "") }));
  } catch (err) {
    console.log(
      JSON.stringify({ scenario, threw: String(err?.message ?? err) }),
    );
  } finally {
    await client.close().catch(() => {});
  }
}

await main();
