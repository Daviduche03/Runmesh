/** Record and replay: diff two recordings, or reassemble an agent from a
 *  version snapshot plus its recording and re-run it with tools stubbed.
 *
 *  Isomorphic and dependency-free by design: `generateText` and the model are
 *  injected, so the same engine runs in the Node CLI and in the browser. The
 *  diff compares behavior — tool calls, decisions, errors — not model prose;
 *  prose drifts for legitimate reasons and would make CI flaky. */

import { redactSecretValues } from "../core/redact.js";
import type { ToolLike } from "../core/types.js";

/** The serialized event shape returned by the run API. */
export type ReplayEvent = {
  seq: number;
  kind: string;
  name?: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  truncated?: boolean;
  durationMs?: number | null;
};

export type ReplayDefinition = {
  version?: number;
  model?: string | null;
  systemPrompt?: string | null;
  tools?: string[];
};

export type DiffDivergence = {
  index: number;
  original: unknown;
  replayed: unknown;
};

export type DiffResult = {
  identical: boolean;
  comparedSteps: number;
  divergences: DiffDivergence[];
};

const VOLATILE_KEYS = new Set([
  "created_at",
  "updated_at",
  "started_at",
  "finished_at",
  "timestamp",
  "request_id",
  "trace_id",
  "etag",
  "expires_at",
  "nonce",
]);

/** Sort object keys and drop volatile fields so comparisons are stable across
 *  runs. Values are otherwise untouched. */
export function normalizeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, depth + 1));
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      if (VOLATILE_KEYS.has(key.toLowerCase())) continue;
      out[key] = normalizeValue(src[key], depth + 1);
    }
    return out;
  }
  return value;
}

function normalizeToolCalls(value: unknown): unknown {
  if (!Array.isArray(value)) return value ?? null;
  return value.map((call) => {
    if (call !== null && typeof call === "object") {
      const c = call as Record<string, unknown>;
      return {
        toolName: c["toolName"] ?? c["name"] ?? null,
        args: normalizeValue(c["args"] ?? c["arguments"] ?? null),
      };
    }
    return call;
  });
}

/** A behavior signature for one event, or null when the event is not a
 *  behavior step. `strict` additionally compares model responses. */
function behaviorStep(event: ReplayEvent, strict: boolean): unknown | null {
  switch (event.kind) {
    case "tool.call":
      return { kind: "tool.call", name: event.name ?? "", args: normalizeValue(event.args ?? {}) };
    case "policy.decision": {
      const r = event.result ?? {};
      return { kind: "policy.decision", decision: r["decision"] ?? event.name ?? "" };
    }
    case "error":
      return { kind: "error", name: event.name ?? "", message: (event.result ?? {})["message"] ?? null };
    case "model.response": {
      if (!strict) return null;
      const r = event.result ?? {};
      return {
        kind: "model.response",
        finishReason: r["finishReason"] ?? null,
        text: r["text"] ?? null,
        toolCalls: normalizeToolCalls(r["toolCalls"]),
      };
    }
    default:
      return null;
  }
}

export function behaviorSteps(events: ReplayEvent[], opts: { strict?: boolean } = {}): unknown[] {
  const strict = opts.strict ?? false;
  const steps: unknown[] = [];
  for (const event of events) {
    const step = behaviorStep(event, strict);
    if (step !== null) steps.push(step);
  }
  return steps;
}

/** Compare two recordings by behavior. Divergences are reported in order,
 *  capped so a wildly different replay does not flood output. */
export function diffRuns(
  original: ReplayEvent[],
  replayed: ReplayEvent[],
  opts: { strict?: boolean; maxDivergences?: number } = {},
): DiffResult {
  const a = behaviorSteps(original, opts);
  const b = behaviorSteps(replayed, opts);
  const max = opts.maxDivergences ?? 20;
  const divergences: DiffDivergence[] = [];
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length && divergences.length < max; i += 1) {
    const av = i < a.length ? a[i] : null;
    const bv = i < b.length ? b[i] : null;
    if (JSON.stringify(av) !== JSON.stringify(bv)) {
      divergences.push({ index: i, original: av, replayed: bv });
    }
  }
  return { identical: divergences.length === 0, comparedSteps: a.length, divergences };
}

/** First recorded result per tool name, used to stub local tools. */
export function collectRecordedToolResults(events: ReplayEvent[]): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const event of events) {
    if (event.kind === "tool.result" && event.name && !map.has(event.name)) {
      map.set(event.name, event.result ?? {});
    }
  }
  return map;
}

/** The prompt from the recorded model request, if any. */
export function recordedPrompt(events: ReplayEvent[]): string {
  for (const event of events) {
    if (event.kind === "model.request") {
      const prompt = (event.args ?? {})["prompt"];
      if (typeof prompt === "string") return prompt;
    }
  }
  return "";
}

export type ReplayConfig<TResult> = {
  definition: ReplayDefinition;
  events: ReplayEvent[];
  /** Overrides the recorded model.request prompt. */
  prompt?: string;
  /** Real tool bodies. Any tool without one is stubbed from the recording. */
  tools?: Record<string, ToolLike>;
  /** Injected framework call, keeping this package dependency-free. */
  generateText: (options: Record<string, unknown>) => Promise<TResult>;
  /** The model to run with: a recorded-response mock, or a live model. */
  model: unknown;
  strict?: boolean;
  passthrough?: Record<string, unknown>;
};

export type ReplayOutcome<TResult> = {
  result: TResult;
  replayedEvents: ReplayEvent[];
  diff: DiffResult;
};

function asRecord(value: unknown): Record<string, unknown> {
  const redacted = redactSecretValues(value);
  return redacted !== null && typeof redacted === "object" && !Array.isArray(redacted)
    ? (redacted as Record<string, unknown>)
    : { value: redacted };
}

/** Reassemble the agent from its version snapshot and recording, re-run it
 *  with tools stubbed from the recording (real bodies win when supplied), and
 *  diff the outcome against the original. Side-effect-free by construction. */
export async function replayRun<TResult>(
  config: ReplayConfig<TResult>,
): Promise<ReplayOutcome<TResult>> {
  const recorded = collectRecordedToolResults(config.events);
  const replayedEvents: ReplayEvent[] = [];
  const names = config.definition.tools?.length
    ? config.definition.tools
    : Object.keys(config.tools ?? {});
  const wrapped: Record<string, ToolLike> = {};
  let seq = 0;
  for (const name of names) {
    const provided = config.tools?.[name];
    const body = provided?.execute;
    wrapped[name] = {
      ...(provided ?? {}),
      execute: async (args: unknown) => {
        replayedEvents.push({ seq: seq++, kind: "tool.call", name, args: asRecord(args) });
        const result =
          typeof body === "function"
            ? await body(args)
            : recorded.has(name)
              ? recorded.get(name)
              : { error: "no_recorded_result", tool: name };
        replayedEvents.push({ seq: seq++, kind: "tool.result", name, result: asRecord(result) });
        return result;
      },
    };
  }
  const result = await config.generateText({
    model: config.model,
    ...(config.definition.systemPrompt != null ? { system: config.definition.systemPrompt } : {}),
    tools: wrapped,
    prompt: config.prompt ?? recordedPrompt(config.events),
    ...(config.passthrough ?? {}),
  });
  return {
    result,
    replayedEvents,
    diff: diffRuns(config.events, replayedEvents, { strict: config.strict ?? false }),
  };
}
