#!/usr/bin/env node
// Time-to-first-token: bare streamText vs @runmesh/agent's runStream.
// Run: RUNMESH_TOKEN=... GROQ_API_KEY=... node bench-stream.mjs
import { streamText } from "ai";
import { groq } from "@ai-sdk/groq";
import { RunmeshClient, vercelAdapter } from "@runmesh/agent";

const API = process.env.RUNMESH_URL ?? "http://localhost:8787";
const TOKEN = process.env.RUNMESH_TOKEN;
const MODEL = process.env.SUPPORT_MODEL ?? "qwen/qwen3.8-27b";
const N = Number(process.env.BENCH_N ?? 6);
const PROMPT = "Reply with one short sentence about the sea.";

if (!TOKEN) throw new Error("RUNMESH_TOKEN required");

const client = new RunmeshClient({ endpoint: API, apiKey: TOKEN, flushIntervalMs: 0 });

async function ttft(run) {
  const t0 = performance.now();
  const result = await run();
  for await (const _chunk of result.textStream) {
    return performance.now() - t0;
  }
  return NaN;
}

const bare = () =>
  ttft(async () =>
    streamText({ model: groq(MODEL), prompt: PROMPT, temperature: 0 }),
  );

const wrapped = () =>
  ttft(async () =>
    vercelAdapter.runStream(client, {
      agent: { externalKey: "bench-stream", name: "Bench Stream" },
      streamText,
      model: groq(MODEL),
      prompt: PROMPT,
      passthrough: { temperature: 0 },
    }),
  );

function stat(name, samples) {
  const s = [...samples].sort((a, b) => a - b);
  console.log(
    `${name.padEnd(10)} min ${s[0].toFixed(0)}  median ${s[Math.floor(s.length / 2)].toFixed(0)}  max ${s.at(-1).toFixed(0)}  ms`,
  );
}

await wrapped(); // warm the resolve cache
const bareSamples = [];
const wrappedSamples = [];
for (let i = 0; i < N; i += 1) {
  bareSamples.push(await bare());
  wrappedSamples.push(await wrapped());
}

console.log(`TTFT over ${N} runs (${MODEL}):`);
stat("bare", bareSamples);
stat("wrapped", wrappedSamples);
const d = wrappedSamples.map((w, i) => w - bareSamples[i]).sort((a, b) => a - b);
stat("delta", d);
await client.close();
