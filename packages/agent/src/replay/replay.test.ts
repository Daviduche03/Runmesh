import { describe, expect, it } from "vitest";
import {
  behaviorSteps,
  diffRuns,
  normalizeValue,
  recordedPrompt,
  replayRun,
  type ReplayEvent,
} from "./index.js";
import type { ToolLike } from "../core/types.js";

const recording: ReplayEvent[] = [
  { seq: 0, kind: "model.request", name: "m", args: { prompt: "hi" } },
  { seq: 1, kind: "tool.call", name: "lookup", args: { q: 1, started_at: "2026-01-01" } },
  { seq: 2, kind: "tool.result", name: "lookup", result: { ok: true } },
  { seq: 3, kind: "model.response", result: { text: "done", finishReason: "stop" } },
];

describe("normalizeValue", () => {
  it("drops volatile keys and sorts the rest", () => {
    expect(normalizeValue({ b: 1, a: 2, created_at: "x", nested: { z: 1, y: 2 } })).toEqual({
      a: 2,
      b: 1,
      nested: { y: 2, z: 1 },
    });
  });
});

describe("behaviorSteps", () => {
  it("compares behavior, not plumbing or prose", () => {
    const steps = behaviorSteps(recording);
    expect(steps).toEqual([{ kind: "tool.call", name: "lookup", args: { q: 1 } }]);
  });

  it("includes model responses only in strict mode", () => {
    const strict = behaviorSteps(recording, { strict: true });
    expect(strict).toHaveLength(2);
    expect(strict[1]).toMatchObject({ kind: "model.response", text: "done" });
  });
});

describe("diffRuns", () => {
  it("is identical against itself", () => {
    expect(diffRuns(recording, recording).identical).toBe(true);
  });

  it("flags a changed tool call", () => {
    const changed = recording.map((e) =>
      e.kind === "tool.call" ? { ...e, args: { q: 2 } } : e,
    );
    const diff = diffRuns(recording, changed);
    expect(diff.identical).toBe(false);
    expect(diff.divergences[0]?.index).toBe(0);
  });
});

describe("recordedPrompt", () => {
  it("reads the prompt from the model request", () => {
    expect(recordedPrompt(recording)).toBe("hi");
    expect(recordedPrompt([])).toBe("");
  });
});

describe("replayRun", () => {
  it("stubs tools from the recording and reproduces the behavior", async () => {
    const generateText = async (options: Record<string, unknown>) => {
      const tools = options["tools"] as Record<string, ToolLike>;
      await tools["lookup"]!.execute!({ q: 1 });
      return { text: "done" };
    };
    const outcome = await replayRun({
      definition: { tools: ["lookup"], systemPrompt: "be brief", model: "m" },
      events: recording,
      generateText,
      model: "mock",
    });
    expect(outcome.diff.identical).toBe(true);
    expect(outcome.diff.comparedSteps).toBe(1);
    expect(outcome.replayedEvents.map((e) => e.kind)).toEqual(["tool.call", "tool.result"]);
  });

  it("prefers a real tool body over the recorded result", async () => {
    const outcome = await replayRun({
      definition: { tools: ["lookup"] },
      events: recording,
      tools: { lookup: { execute: async () => ({ live: true }) } },
      generateText: async (options: Record<string, unknown>) => {
        const tools = options["tools"] as Record<string, ToolLike>;
        await tools["lookup"]!.execute!({ q: 1 });
        return {};
      },
      model: "mock",
    });
    const result = outcome.replayedEvents.find((e) => e.kind === "tool.result");
    expect(result?.result).toEqual({ live: true });
  });

  it("reports divergence when the loop calls a different tool", async () => {
    const generateText = async (options: Record<string, unknown>) => {
      const tools = options["tools"] as Record<string, ToolLike>;
      await tools["other"]!.execute!({});
      return {};
    };
    const outcome = await replayRun({
      definition: { tools: ["lookup", "other"] },
      events: recording,
      generateText,
      model: "mock",
    });
    expect(outcome.diff.identical).toBe(false);
  });
});
