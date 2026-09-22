import { describe, expect, it, vi } from "vitest";
import { RunmeshClient } from "./client.js";

type Call = { url: string; init: RequestInit };

function mockFetch(handler: (call: Call) => unknown) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const call = { url, init: init ?? {} };
    calls.push(call);
    return {
      ok: true,
      json: async () => handler(call),
      text: async () => "",
    };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function clientWith(fetchImpl: typeof fetch, errors: unknown[] = []) {
  return new RunmeshClient({
    endpoint: "https://api.example.test",
    apiKey: "rk_test",
    flushIntervalMs: 0,
    fetchImpl,
    onError: (err) => errors.push(err),
  });
}

describe("RunmeshClient", () => {
  it("resolves with a locally computed fingerprint when omitted", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({
      data: { id: "ag_1", version: 1, is_new: true, is_new_version: false },
    }));
    const client = clientWith(fetchImpl);
    const out = await client.resolveAgent({ externalKey: "atlas", model: "m" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/agents:resolve");
    const sent = JSON.parse(String(calls[0]?.init.body));
    expect(sent.external_key).toBe("atlas");
    expect(sent.fingerprint).toMatch(/^fp_[0-9a-f]{16}$/);
    expect(out).toEqual({
      id: "ag_1",
      version: 1,
      isNew: true,
      isNewVersion: false,
      framework: null,
      model: null,
      tools: [],
      warnings: [],
    });
  });

  it("starts and finishes runs", async () => {
    const { calls, fetchImpl } = mockFetch((call) =>
      call.url.endsWith("/runs")
        ? { data: { id: "run_1", agent_id: "ag_1", parent_run_id: null, status: "running" } }
        : { data: {} },
    );
    const client = clientWith(fetchImpl);
    const run = await client.startRun({ agentId: "ag_1", input: "hi" });
    expect(run.id).toBe("run_1");
    await client.finishRun(run.id, { status: "completed", usage: { tokens: 3 } });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.example.test/api/v1/runs",
      "https://api.example.test/api/v1/runs/run_1/finish",
    ]);
    await client.close();
  });

  it("buffers and flushes in batches, swallowing transport errors", async () => {
    let failures = 0;
    const { calls, fetchImpl } = mockFetch(() => {
      failures += 1;
      if (failures === 1) throw new Error("down");
      return { data: {} };
    });
    const errors: unknown[] = [];
    const client = new RunmeshClient({
      endpoint: "https://api.example.test",
      apiKey: "rk_test",
      batchSize: 2,
      flushIntervalMs: 0,
      fetchImpl,
      onError: (err) => errors.push(err),
    });
    client.record({ runId: "run_1", kind: "log", name: "a" });
    expect(calls).toHaveLength(0);
    client.record({ runId: "run_1", kind: "log", name: "b" });
    await new Promise((r) => setTimeout(r, 10));
    expect(errors).toHaveLength(1);
    expect(calls).toHaveLength(1);
    client.record({ runId: "run_1", kind: "log", name: "c" });
    await client.close();
    expect(calls).toHaveLength(2);
    const batch = JSON.parse(String(calls[1]?.init.body));
    expect(batch.events.map((e: { name: string }) => e.name)).toEqual(["c"]);
  });

  it("speaks snake_case on the wire", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({ data: {} }));
    const client = clientWith(fetchImpl);
    client.record({
      runId: "run_1",
      kind: "tool.call",
      name: "t",
      args: { a: 1 },
      durationMs: 5,
    });
    await client.close();
    const event = JSON.parse(String(calls[0]?.init.body)).events[0];
    expect(event).toEqual({
      run_id: "run_1",
      kind: "tool.call",
      name: "t",
      args: { a: 1 },
      result: {},
      duration_ms: 5,
    });
    expect(event).not.toHaveProperty("runId");
    expect(event).not.toHaveProperty("durationMs");
  });
});

describe("invoke wire shape", () => {
  it("posts snake_case and maps decisions", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const client = new RunmeshClient({
      endpoint: "https://api.example.test",
      apiKey: "rk_1",
      flushIntervalMs: 0,
      fetchImpl: (async (url: string, init?: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response(
          JSON.stringify({ ok: true, data: { decision: "allow", status: 200, result: { id: "x" } } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch,
    });
    const out = await client.invoke("tool_abc", { amount: 5 }, { runId: "run_1", idempotencyKey: "idem_1" });
    expect(calls[0]?.url).toBe("https://api.example.test/api/v1/tools/tool_abc/invoke");
    expect(calls[0]?.body).toEqual({
      run_id: "run_1",
      args: { amount: 5 },
      idempotency_key: "idem_1",
      connect_user_id: null,
    });
    expect(out).toEqual({ decision: "allow", status: 200, result: { id: "x" }, upstreamError: false });
  });
});
