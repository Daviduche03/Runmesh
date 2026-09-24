import { describe, expect, it } from "vitest";
import { RunmeshClient } from "../core/client.js";
import { replayRun, type ReplayEvent } from "./index.js";
import type { TelemetryEvent, ToolLike } from "../core/types.js";

/** Live integration test. Skipped unless RUNMESH_ENDPOINT and RUNMESH_JWT are
 *  set, so `pnpm test` stays hermetic. Run it against a dev server:
 *
 *    cd runmesh-main && JWT=$(PYTHONPATH=src uv run --no-sync python ../e2e/acme/dbrunner.py jwt | tail -1)
 *    cd ../packages/agent && RUNMESH_ENDPOINT=http://localhost:8787 RUNMESH_JWT="$JWT" pnpm test:e2e
 *
 *  It exercises the whole loop: record a run over HTTP, replay it with the real
 *  engine (tools stubbed from the recording), diff it, record the replay run,
 *  and read it back. Creates residue in the workspace. */

const endpoint = process.env["RUNMESH_ENDPOINT"];
const jwt = process.env["RUNMESH_JWT"];
const live = describe.skipIf(!endpoint || !jwt);

/** Replays the recorded model responses in order, executing the tool calls
 *  each one requested — a deterministic stand-in for the AI SDK loop. */
function recordedGenerateText(responses: Array<Record<string, unknown>>) {
  let step = 0;
  return async (options: Record<string, unknown>) => {
    const response = responses[Math.min(step, responses.length - 1)] ?? {};
    step += 1;
    const tools = options["tools"] as Record<string, ToolLike>;
    const calls = Array.isArray(response["toolCalls"])
      ? (response["toolCalls"] as Array<Record<string, unknown>>)
      : [];
    for (const call of calls) {
      const name = String(call["toolName"] ?? call["name"] ?? "");
      await tools[name]?.execute?.(call["args"] ?? {});
    }
    return { text: (response["text"] as string | undefined) ?? "", usage: response["usage"] ?? {} };
  };
}

live("replay against a live Runmesh", () => {
  it("reproduces a recorded run, flags a changed one, and records the replay", async () => {
    const client = new RunmeshClient({
      endpoint: endpoint ?? "http://localhost:8787",
      apiKey: jwt ?? "",
      flushIntervalMs: 0,
    });

    const agent = await client.resolveAgent({
      externalKey: "replay-e2e",
      fingerprint: "fp_replay_e2e_v1",
      name: "Replay E2E",
      framework: "vercel-ai-sdk",
      model: "claude-sonnet-4-5",
      systemPrompt: "You look things up.",
      tools: [{ name: "lookup", kind: "local" }],
    });
    const run = await client.startRun({ agentId: agent.id, input: "look up alpha" });

    const emit = (event: Omit<TelemetryEvent, "runId">) => client.record({ runId: run.id, ...event });
    emit({ kind: "model.request", name: "claude-sonnet-4-5", args: { prompt: "look up alpha", tools: ["lookup"] } });
    emit({ kind: "model.response", name: "claude-sonnet-4-5", result: {
      toolCalls: [{ toolName: "lookup", args: { q: "alpha" } }], finishReason: "tool-calls" } });
    emit({ kind: "tool.call", name: "lookup", args: { q: "alpha" } });
    emit({ kind: "tool.result", name: "lookup", result: { answer: 42 } });
    emit({ kind: "model.response", name: "claude-sonnet-4-5", result: {
      text: "alpha is 42", finishReason: "stop" } });
    await client.flush();
    await client.finishRun(run.id, { status: "completed", usage: { tokens: 10 } });

    const detail = await client.getRun(run.id);
    const events = (detail.events ?? []) as unknown as ReplayEvent[];
    const recordedModel = events
      .filter((event) => event.kind === "model.response")
      .map((event) => event.result ?? {});
    const definition = {
      systemPrompt: detail.definition?.system_prompt ?? null,
      model: detail.definition?.model ?? null,
      tools: ["lookup"],
    };

    // Same behavior → identical.
    const same = await replayRun({
      definition,
      events,
      generateText: recordedGenerateText(recordedModel),
      model: "mock",
    });
    expect(same.diff.identical).toBe(true);
    expect(same.diff.comparedSteps).toBeGreaterThan(0);

    // Changed behavior → a reported divergence.
    const changed = await replayRun({
      definition,
      events,
      generateText: recordedGenerateText([
        { toolCalls: [{ toolName: "lookup", args: { q: "beta" } }], finishReason: "tool-calls" },
        { text: "beta is 7", finishReason: "stop" },
      ]),
      model: "mock",
    });
    expect(changed.diff.identical).toBe(false);
    expect(changed.diff.divergences.length).toBeGreaterThan(0);

    // Record the replay run and read back what the UI reads.
    const replay = await client.startReplayRun(run.id);
    for (const event of same.replayedEvents) {
      client.record({
        runId: replay.id,
        kind: event.kind as TelemetryEvent["kind"],
        name: event.name ?? "",
        args: event.args ?? {},
        result: event.result ?? {},
      });
    }
    client.record({
      runId: replay.id,
      kind: "log",
      name: "replay.diff",
      result: same.diff as unknown as Record<string, unknown>,
    });
    await client.flush();
    await client.finishRun(replay.id, { status: "completed" });

    const replayDetail = await client.getRun(replay.id);
    await client.close();

    expect(replayDetail.mode).toBe("replay");
    expect(replayDetail.replay_of_run_id).toBe(run.id);
    const diffEvent = (replayDetail.events ?? []).find(
      (event) => event["kind"] === "log" && event["name"] === "replay.diff",
    );
    expect(diffEvent).toBeTruthy();
    expect((diffEvent?.["result"] as Record<string, unknown>)["identical"]).toBe(true);
  }, 30_000);
});
