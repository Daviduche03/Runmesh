import { describe, expect, it } from "vitest";
import { VercelAdapter, vercelAdapter, wrapTools } from "./vercel.js";
import { managedTool } from "../core/managed.js";
import type { RunmeshClient } from "../core/client.js";
import type { TelemetryEvent, ToolLike } from "../core/types.js";

function fakeClient(events: TelemetryEvent[], opts?: { explode?: boolean }) {
  return {
    record: (event: TelemetryEvent) => {
      if (opts?.explode) throw new Error("recorder down");
      events.push(event);
    },
  } as unknown as RunmeshClient;
}

describe("wrapTools", () => {
  it("records call and result, preserves behavior, redacts secrets", async () => {
    const events: TelemetryEvent[] = [];
    const tools = wrapTools(
      {
        greet: {
          description: "hi",
          execute: async (args: { owner: string; api_key: string }) => `hi ${args.owner}`,
        },
        plain: { description: "no execute" },
      },
      { client: fakeClient(events), runId: "run_1" },
    );

    const out = await tools.greet.execute!({ owner: "o", api_key: "sk-1" });
    expect(out).toBe("hi o");
    expect(events.map((e) => e.kind)).toEqual(["tool.call", "tool.result"]);
    expect(events[0]?.args).toEqual({ owner: "o", api_key: "[REDACTED]" });
    expect(events[1]?.result).toEqual({ value: "hi o" });
    expect(typeof events[1]?.durationMs).toBe("number");
    expect((tools.plain as { execute?: unknown }).execute).toBeUndefined();
  });

  it("records errors and rethrows unchanged", async () => {
    const events: TelemetryEvent[] = [];
    const boom = new Error("kaput");
    const tools = wrapTools(
      {
        bad: {
          execute: async (_args: unknown) => {
            throw boom;
          },
        },
      },
      { client: fakeClient(events), runId: "run_1" },
    );
    await expect(tools.bad.execute!({})).rejects.toBe(boom);
    expect(events.map((e) => e.kind)).toEqual(["tool.call", "error"]);
  });

  it("survives recorder failure", async () => {
    const tools = wrapTools(
      { ok: { execute: async (_args: unknown) => 42 } },
      { client: fakeClient([], { explode: true }), runId: "run_1" },
    );
    await expect(tools.ok.execute!({})).resolves.toBe(42);
  });

  it("does not mutate the original map", () => {
    const original = { a: { execute: async (_args: unknown) => 1 } };
    const before = original.a.execute;
    wrapTools(original, { client: fakeClient([]), runId: "run_1" });
    expect(original.a.execute).toBe(before);
  });
});

describe("VercelAdapter", () => {
  it("normalizes framework input to a definition", () => {
    const adapter = new VercelAdapter();
    expect(adapter.framework).toBe("vercel-ai-sdk");
    expect(
      adapter.extractDefinition({
        model: "m",
        systemPrompt: "Be brief.",
        tools: {
          lookup: { description: "looks up", parameters: { type: "object" } },
          v7tool: {
            description: "v7 shape",
            inputSchema: { shape: { city: {}, n: {} } },
          },
          bare: {},
        },
      }),
    ).toEqual({
      framework: "vercel-ai-sdk",
      model: "m",
      systemPrompt: "Be brief.",
      tools: [
        { name: "lookup", kind: "local", description: "looks up", parameters: { type: "object" } },
        {
          name: "v7tool",
          kind: "local",
          description: "v7 shape",
          parameters: { kind: "object", properties: ["city", "n"] },
        },
        { name: "bare", kind: "local" },
      ],
    });
  });

  it("resolves through the shared base flow", async () => {
    const seen: unknown[] = [];
    const client = {
      resolveAgent: async (payload: unknown) => {
        seen.push(payload);
        return { id: "ag_1", version: 2, isNew: false, isNewVersion: true };
      },
    } as unknown as RunmeshClient;
    const out = await vercelAdapter.resolve(
      client,
      { model: "m", tools: {} },
      { externalKey: "atlas", name: "Atlas" },
    );
    expect(out).toEqual({ id: "ag_1", version: 2, isNew: false, isNewVersion: true });
    const payload = seen[0] as Record<string, unknown>;
    expect(payload["framework"]).toBe("vercel-ai-sdk");
    expect(payload["externalKey"]).toBe("atlas");
    expect(payload["fingerprint"]).toMatch(/^fp_[0-9a-f]{16}$/);
  });
});

describe("runText", () => {
  function harness() {
    const calls: { method: string; args: unknown[] }[] = [];
    const events: TelemetryEvent[] = [];
    let resolveCount = 0;
    const client = {
      resolveAgent: async (payload: unknown) => {
        calls.push({ method: "resolveAgent", args: [payload] });
        resolveCount += 1;
        return { id: "ag_1", version: resolveCount, isNew: false, isNewVersion: false };
      },
      startRun: async (input: unknown) => {
        calls.push({ method: "startRun", args: [input] });
        return { id: "run_1", agentId: "ag_1", status: "running" };
      },
      finishRun: async (runId: string, outcome?: unknown) => {
        calls.push({ method: "finishRun", args: [runId, outcome] });
      },
      flush: async () => {
        calls.push({ method: "flush", args: [] });
      },
      record: (event: TelemetryEvent) => {
        events.push(event);
      },
    } as unknown as RunmeshClient;
    return { calls, events, client };
  }

  const tools = {
    lookup: { execute: async (_args: unknown) => ({ ok: true }) },
  };

  it("collapses the lifecycle into one call", async () => {
    const { calls, events, client } = harness();
    const generateText = async (options: Record<string, unknown>) => {
      const wrapped = options["tools"] as typeof tools;
      await wrapped.lookup.execute!({ q: 1 });
      return { text: "done", usage: { tokens: 9 } };
    };
    const out = await vercelAdapter.runText(client, {
      agent: "triage",
      generateText,
      model: "m",
      system: "Be brief.",
      tools,
      prompt: "hi",
      passthrough: { temperature: 0 },
    });
    expect(out).toEqual({ text: "done", usage: { tokens: 9 } });
    expect(calls.map((c) => c.method)).toEqual([
      "resolveAgent",
      "startRun",
      "finishRun",
      "flush",
    ]);
    const finish = calls.find((c) => c.method === "finishRun");
    expect(finish?.args[1]).toEqual({ status: "completed", usage: { tokens: 9 } });
    expect(events.map((e) => e.kind)).toEqual(["tool.call", "tool.result"]);
  });

  it("caches resolve per client and re-resolves on definition change", async () => {
    const { calls, client } = harness();
    const generateText = async () => ({ text: "ok" });
    const base = { agent: "triage", generateText, model: "m", tools, prompt: "hi" };
    await vercelAdapter.runText(client, base);
    await vercelAdapter.runText(client, base);
    expect(calls.filter((c) => c.method === "resolveAgent")).toHaveLength(1);
    await vercelAdapter.runText(client, { ...base, system: "Changed." });
    expect(calls.filter((c) => c.method === "resolveAgent")).toHaveLength(2);
  });

  it("marks failed, flushes, and rethrows the original error", async () => {
    const { calls, events, client } = harness();
    const boom = new Error("model down");
    const generateText = async () => {
      throw boom;
    };
    await expect(
      vercelAdapter.runText(client, {
        agent: "triage",
        generateText,
        model: "m",
        tools,
        prompt: "hi",
      }),
    ).rejects.toBe(boom);
    const finish = calls.find((c) => c.method === "finishRun");
    expect(finish?.args[1]).toEqual({ status: "failed" });
    expect(calls.some((c) => c.method === "flush")).toBe(true);
    expect(events).toHaveLength(0);
  });
});

describe("managed tools", () => {
  function managedCtx(invoke: (ref: string, args: unknown) => unknown) {
    const events: TelemetryEvent[] = [];
    const client = {
      record: (event: TelemetryEvent) => events.push(event),
      invoke,
    } as unknown as RunmeshClient;
    const registry = new Map([
      ["charge", { name: "charge", ref: "tool_abc123", kind: "managed" as const, provider: "stripe", action: "stripe.charge" }],
    ]);
    return { client, events, ctx: { client, runId: "run_1", registry } };
  }

  it("classifies a managed tool in the definition", () => {
    const adapter = new VercelAdapter();
    const def = adapter.extractDefinition({
      model: "m",
      tools: {
        charge: managedTool({ provider: "stripe", url: "https://api.stripe.test/charge", action: "stripe.charge" }),
        weather: { description: "w", execute: async () => 1 },
      },
    });
    const byName = Object.fromEntries((def.tools ?? []).map((t) => [t.name, t]));
    expect(byName.charge?.kind).toBe("managed");
    expect(byName.charge?.provider).toBe("stripe");
    expect(byName.charge?.url).toBe("https://api.stripe.test/charge");
    expect(byName.weather?.kind).toBe("local");
  });

  it("routes managed execution through invoke and returns the result", async () => {
    const calls: { ref: string; args: unknown }[] = [];
    const { ctx } = managedCtx(async (ref, args) => {
      calls.push({ ref, args });
      return { decision: "allow", status: 200, result: { id: "ch_1" }, upstreamError: false };
    });
    const tools = vercelAdapter.wrapTools<Record<string, ToolLike>>(
      { charge: managedTool({ provider: "stripe", url: "https://x.test" }) },
      ctx,
    );
    await expect(tools.charge!.execute!({ amount: 20 })).resolves.toEqual({ id: "ch_1" });
    expect(calls).toEqual([{ ref: "tool_abc123", args: { amount: 20 } }]);
  });

  it("returns policy denials to the model instead of throwing", async () => {
    const { ctx } = managedCtx(async () => ({ decision: "deny", reason: "No charges", rule: "No charges" }));
    const tools = vercelAdapter.wrapTools<Record<string, ToolLike>>(
      { charge: managedTool({ provider: "stripe", url: "https://x.test" }) },
      ctx,
    );
    await expect(tools.charge!.execute!({})).resolves.toEqual({
      error: "policy_denied",
      reason: "No charges",
      rule: "No charges",
    });
  });

  it("surfaces escalate and consent, and fails closed on transport error", async () => {
    const escalate = managedCtx(async () => ({ decision: "escalate", reason: "needs a human" }));
    const escTools = vercelAdapter.wrapTools<Record<string, ToolLike>>(
      { charge: managedTool({ provider: "stripe", url: "https://x.test" }) },
      escalate.ctx,
    );
    await expect(escTools.charge!.execute!({})).resolves.toEqual({
      error: "policy_escalated",
      reason: "needs a human",
    });

    const boom = managedCtx(async () => {
      throw new Error("backend down");
    });
    const boomTools = vercelAdapter.wrapTools<Record<string, ToolLike>>(
      { charge: managedTool({ provider: "stripe", url: "https://x.test" }) },
      boom.ctx,
    );
    const out = (await boomTools.charge!.execute!({})) as { error: string; message: string };
    expect(out.error).toBe("runmesh_invoke_failed");
    expect(out.message).toContain("backend down");
  });
});

describe("managed forward (ctx.fetch)", () => {
  function forwardCtx(forward: (ref: string, request: any, opts: any) => unknown) {
    const calls: any[] = [];
    const client = {
      record: () => {},
      forward: async (ref: string, request: any, opts: any) => {
        calls.push({ ref, request, opts });
        return forward(ref, request, opts);
      },
    } as unknown as RunmeshClient;
    const registry = new Map([
      ["list", { name: "list", ref: "tool_x", kind: "managed" as const, provider: "github", action: "github.list" }],
      ["create", { name: "create", ref: "tool_y", kind: "managed" as const, provider: "github", action: "github.create" }],
    ]);
    return { calls, ctx: { client, runId: "run_1", registry } };
  }

  it("classifies a forward tool and carries baseUrl", () => {
    const def = vercelAdapter.extractDefinition({
      tools: { list: managedTool({ provider: "github", baseUrl: "https://api.github.com", execute: async () => 1 }) },
    });
    const entry = (def.tools ?? []).find((t) => t.name === "list")!;
    expect(entry.kind).toBe("managed");
    expect(entry.baseUrl).toBe("https://api.github.com");
  });

  it("routes the dev's fetch through Runmesh and returns a fetch-like response", async () => {
    const { calls, ctx } = forwardCtx(() => ({
      decision: "allow", status: 200, text: '{"ok":true}', upstreamError: false,
    }));
    const tools = vercelAdapter.wrapTools<Record<string, ToolLike>>(
      {
        list: managedTool({
          provider: "github",
          baseUrl: "https://api.github.com",
          execute: async (args: any, c: any) => {
            const res = await c.fetch(`/repos/${args.owner}/x`, { headers: { Accept: "application/json" } });
            return { status: res.status, ok: res.ok, body: res.json() };
          },
        }),
      },
      ctx,
    );
    const out = await tools.list!.execute!({ owner: "org" });
    expect(out).toEqual({ status: 200, ok: true, body: { ok: true } });
    expect(calls[0].ref).toBe("tool_x");
    expect(calls[0].request).toMatchObject({
      method: "GET",
      path: "/repos/org/x",
      headers: { Accept: "application/json" },
    });
    expect(calls[0].opts.idempotencyKey).toBeUndefined();
  });

  it("gives mutating calls an idempotency key", async () => {
    const { calls, ctx } = forwardCtx(() => ({ decision: "allow", status: 201, text: "{}", upstreamError: false }));
    const tools = vercelAdapter.wrapTools<Record<string, ToolLike>>(
      {
        create: managedTool({
          provider: "github",
          baseUrl: "https://api.github.com",
          execute: async (_a: any, c: any) => c.fetch("/repos/org/x/issues", { method: "POST", body: { title: "hi" } }),
        }),
      },
      ctx,
    );
    await tools.create!.execute!({});
    expect(calls[0].request.method).toBe("POST");
    expect(typeof calls[0].opts.idempotencyKey).toBe("string");
  });

  it("turns a refusal into a fetch-like 403", async () => {
    const { ctx } = forwardCtx(() => ({ decision: "deny", reason: "No listing", rule: "No listing" }));
    const tools = vercelAdapter.wrapTools<Record<string, ToolLike>>(
      {
        list: managedTool({
          provider: "github",
          baseUrl: "https://api.github.com",
          execute: async (_a: any, c: any) => {
            const res = await c.fetch("/x");
            return { ok: res.ok, status: res.status, body: res.json() };
          },
        }),
      },
      ctx,
    );
    const out: any = await tools.list!.execute!({});
    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(out.body.error).toBe("policy_denied");
    expect(out.body.reason).toBe("No listing");
  });
});

describe("managed misconfiguration fails loudly", () => {
  it("throws when a managed tool is not in the registry", () => {
    const ctx = { client: fakeClient([]), runId: "run_1", registry: new Map() };
    expect(() =>
      vercelAdapter.wrapTools({ charge: managedTool({ provider: "stripe", url: "https://x.test" }) }, ctx),
    ).toThrow(/not found in the registry/);
  });

  it("includes the server warning when a managed tool was demoted", () => {
    const ctx = {
      client: fakeClient([]),
      runId: "run_1",
      registry: new Map([
        ["charge", { name: "charge", ref: "tool_x", kind: "local" as const, provider: "stripe", action: "stripe.charge" }],
      ]),
      warnings: [
        { tool: "charge", code: "managed_missing_config", message: "Declared managed but missing url or baseUrl; treated as local." },
      ],
    };
    expect(() =>
      vercelAdapter.wrapTools({ charge: managedTool({ provider: "stripe", url: "https://x.test" }) }, ctx),
    ).toThrow(/missing url or baseUrl/);
  });

  it("throws when wrapTools is called without a registry", () => {
    const ctx = { client: fakeClient([]), runId: "run_1" };
    expect(() =>
      vercelAdapter.wrapTools({ charge: managedTool({ provider: "stripe", url: "https://x.test" }) }, ctx),
    ).toThrow(/without a registry/);
  });

  it("leaves local tools alone even with no registry", () => {
    const ctx = { client: fakeClient([]), runId: "run_1" };
    const tools = vercelAdapter.wrapTools<Record<string, ToolLike>>(
      { greet: { execute: async () => 1 } },
      ctx,
    );
    expect(typeof tools.greet!.execute).toBe("function");
  });
});
