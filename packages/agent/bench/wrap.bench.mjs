/** Overhead benchmark for the wrapper hot path.
 *
 *  Run: pnpm build && node bench/wrap.bench.mjs
 *
 *  What it measures (in-process only — network flush happens off the hot
 *  path by design and is measured separately):
 *   1. bare tool execute (baseline, no wrapper)
 *   2. wrapped execute with a stub recorder (pure interposition cost)
 *   3. wrapped execute with the real client buffer (what ships)
 *   4. definition fingerprinting
 *   5. redaction on small vs large payloads
 *   6. raw record() throughput into the client buffer
 */
import { performance } from "node:perf_hooks";
import {
  RunmeshClient,
  definitionFingerprint,
  redactSecretValues,
  wrapTools,
} from "../dist/index.js";

const WARMUP = 2_000;
const N = 20_000;

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((t, v) => t + v, 0) / samples.length;
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { mean, p50: pick(0.5), p95: pick(0.95) };
}

async function measure(label, fn, iterations = N) {
  for (let i = 0; i < WARMUP; i++) await fn(i);
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn(i);
    samples.push(performance.now() - t0);
  }
  const s = stats(samples);
  console.log(
    `${label}: mean ${(s.mean * 1000).toFixed(1)}µs · p50 ${(s.p50 * 1000).toFixed(1)}µs · p95 ${(s.p95 * 1000).toFixed(1)}µs`,
  );
  return s;
}

const stubRecorder = { record() {} };

const fastTool = {
  lookup: { execute: async (args) => ({ echo: args.q }) },
};

// 1. baseline: direct execute, no wrapper
await measure("bare execute", async (i) => {
  await fastTool.lookup.execute({ q: i });
});

// 2. wrapped with a no-op recorder: pure interposition cost
const stubWrapped = wrapTools(
  { lookup: { execute: fastTool.lookup.execute } },
  { client: stubRecorder, runId: "run_bench" },
);
await measure("wrapped execute (stub recorder)", async (i) => {
  await stubWrapped.lookup.execute({ q: i });
});

// 3. wrapped with the real client buffer (production path, no flush)
const client = new RunmeshClient({
  endpoint: "http://127.0.0.1:9", // unroutable: proves flush never blocks execute
  apiKey: "rk_bench",
  flushIntervalMs: 0,
  batchSize: 1_000_000_000,
  onError: () => {},
});
const liveWrapped = wrapTools(
  { lookup: { execute: fastTool.lookup.execute } },
  { client, runId: "run_bench" },
);
await measure("wrapped execute (real buffer)", async (i) => {
  await liveWrapped.lookup.execute({ q: i, api_key: "sk-test" });
});
await client.close().catch(() => {});

// 4. fingerprint
await measure(
  "definitionFingerprint",
  async () => {
    definitionFingerprint({
      framework: "vercel-ai-sdk",
      model: "m",
      systemPrompt: "Be brief. ".repeat(20),
      tools: [{ name: "a" }, { name: "b" }, { name: "c" }],
    });
  },
  5_000,
);

// 5. redaction
const smallArgs = { owner: "o", api_key: "sk-test", nested: { token: "t", n: 1 } };
const largeResult = { items: Array.from({ length: 200 }, (_, i) => ({ id: i, token: "tok-" + i })) };
await measure("redact small args", async () => redactSecretValues(smallArgs), 5_000);
await measure("redact large result", async () => redactSecretValues(largeResult), 1_000);

// 6. raw record() throughput
const sink = new RunmeshClient({
  endpoint: "http://127.0.0.1:9",
  apiKey: "rk_bench",
  flushIntervalMs: 0,
  batchSize: 1_000_000_000,
  onError: () => {},
});
await measure(
  "client.record()",
  async (i) => {
    sink.record({ runId: "r", kind: "tool.call", name: "t", args: { i } });
  },
  100_000,
);
await sink.close().catch(() => {});
