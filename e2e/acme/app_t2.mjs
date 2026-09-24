#!/usr/bin/env node
// Tier-2 probe app: a second Vercel AI SDK agent (distinct external key) with
// hostile-upstream tools. Same @runmesh/agent pipeline as tier-1; the model is
// scripted. T2_AGENT_KEY / T2_CONNECT_USER override identity for isolation legs.
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

const AGENT_KEY = process.env.T2_AGENT_KEY ?? "acme-t2-probe";
const AGENT_NAME = process.env.T2_AGENT_NAME ?? "Acme T2 Probe";
const CONNECT_USER = process.env.T2_CONNECT_USER ?? "cu_demo";
const SYSTEM = "You are Acme's tier-2 probe. Call the requested tool once.";
const MODEL_ID = "acme-mock-t2";

const usage = () => ({
  inputTokens: { total: 4, noCache: 4, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
});

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
            toolCallId: `t2call_${i}_${idx}`,
            toolName: tc.name,
            input: JSON.stringify(tc.input ?? {}),
          })),
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage: usage(),
          response: { id: `t2mock_${i}`, modelId: MODEL_ID },
        };
      }
      const saw = collectResults(prompt);
      return {
        content: [{ type: "text", text: step.text ?? JSON.stringify({ saw }) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: usage(),
        response: { id: `t2mock_${i}`, modelId: MODEL_ID },
      };
    },
  });
}

const tools = {
  t2_send: managedTool({
    provider: "google",
    action: "google.gmail.send",
    url: `${MOCK}/t2/send`,
    method: "POST",
    description: "Tier-2 probe invoke tool.",
    inputSchema: z.object({ to: z.string(), subject: z.string(), body: z.string() }).passthrough(),
  }),
  t2_slow: managedTool({
    provider: "google",
    action: "google.gmail.send",
    url: `${MOCK}/t2/slow`,
    method: "POST",
    description: "Tier-2 slow upstream (timeout leg).",
    inputSchema: z.object({}).passthrough(),
  }),
  t2_big: managedTool({
    provider: "google",
    action: "google.gmail.send",
    url: `${MOCK}/t2/big`,
    method: "POST",
    description: "Tier-2 oversized upstream body.",
    inputSchema: z.object({}).passthrough(),
  }),
  t2_raw: managedTool({
    provider: "google",
    action: "google.gmail.send",
    url: `${MOCK}/t2/raw`,
    method: "POST",
    description: "Tier-2 non-JSON upstream body.",
    inputSchema: z.object({}).passthrough(),
  }),
  t2_fw: managedTool({
    provider: "google",
    action: "google.gmail.send",
    baseUrl: MOCK,
    description: "Tier-2 forward-mode probe.",
    inputSchema: z.object({ path: z.string() }).passthrough(),
    execute: async (args, ctx) => {
      const res = await ctx.fetch(args.path ?? "/t2/send", { method: "POST", body: {} });
      return res.json();
    },
  }),
};

const call = (name, input) => ({ toolCalls: [{ name, input }] });
const ECHO = {};

function scriptFor(name) {
  switch (name) {
    case "probe_resolve":
      return [{ text: "t2-resolved" }];
    case "probe_timeout":
      return [call("t2_slow", {}), ECHO];
    case "probe_big":
      return [call("t2_big", {}), ECHO];
    case "probe_raw":
      return [call("t2_raw", {}), ECHO];
    case "probe_secret":
      return [
        call("t2_send", {
          to: "vip@example.com",
          subject: "keys",
          body: "see attached",
          api_key: "sk-live-T2SECRET-123",
        }),
        ECHO,
      ];
    default:
      throw new Error(`unknown t2 scenario: ${name}`);
  }
}

async function main() {
  const scenario = process.argv[2] ?? "probe_resolve";
  const script = scriptFor(scenario);
  const client = new RunmeshClient({
    endpoint: API,
    apiKey: TOKEN,
    flushIntervalMs: 50,
    onError: (err) => console.error("[t2client]", err),
  });
  try {
    const result = await vercelAdapter.runText(client, {
      agent: { externalKey: AGENT_KEY, name: AGENT_NAME },
      generateText,
      model: scriptedModel(script),
      system: SYSTEM,
      tools,
      prompt: `Acme t2: ${scenario}`,
      connectUserId: CONNECT_USER,
      passthrough: { stopWhen: stepCountIs(script.length) },
    });
    console.log(JSON.stringify({ scenario, text: String(result?.text ?? "") }));
  } catch (err) {
    console.log(JSON.stringify({ scenario, threw: String(err?.message ?? err) }));
  } finally {
    await client.close().catch(() => {});
  }
}

await main();
