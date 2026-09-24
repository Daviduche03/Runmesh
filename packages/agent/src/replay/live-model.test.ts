import { describe, expect, it } from "vitest";
import { generateText, isStepCount, jsonSchema, streamText, tool } from "ai";
import { groq } from "@ai-sdk/groq";
import {
	RunmeshClient,
	replayRun,
	vercelAdapter,
	type ReplayEvent,
	type ToolLike,
} from "../index.js";

/** Live-model integration test. Skipped unless GROQ_API_KEY,
 *  RUNMESH_ENDPOINT, and RUNMESH_JWT are set, so `pnpm test` stays hermetic.
 *
 *    cd runmesh-main
 *    JWT=$(PYTHONPATH=src uv run --no-sync python ../e2e/acme/dbrunner.py jwt | tail -1)
 *    cd ../packages/agent
 *    GROQ_API_KEY=gsk_... RUNMESH_ENDPOINT=http://localhost:8787 RUNMESH_JWT="$JWT" \
 *      pnpm vitest run src/replay/live-model.test.ts
 *
 *  Runs a real model through the adapter (model I/O and tool calls recorded via
 *  the live API), replays the recording deterministically, and then re-runs a
 *  real model to show a live comparison. Creates residue in the workspace. */

const key = process.env["GROQ_API_KEY"];
const endpoint = process.env["RUNMESH_ENDPOINT"];
const jwt = process.env["RUNMESH_JWT"];
const modelId = process.env["RUNMESH_TEST_MODEL"] ?? "qwen/qwen3.8-27b";
const live = describe.skipIf(!key || !endpoint || !jwt);

/** Replays recorded model responses in order, executing the tool calls each
 *  requested — the deterministic stand-in for the AI SDK loop. */
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
			const args = call["args"] ?? call["arguments"] ?? call["input"] ?? {};
			await tools[name]?.execute?.(args);
		}
		return { text: (response["text"] as string | undefined) ?? "" };
	};
}

live("replay with a real model", () => {
	it("records a real model run, replays it deterministically, and re-runs it live", async () => {
		const client = new RunmeshClient({
			endpoint: endpoint ?? "http://localhost:8787",
			apiKey: jwt ?? "",
			flushIntervalMs: 0,
		});

		const lookup = tool({
			description: "Look up a value by key.",
			inputSchema: jsonSchema<{ key: string }>({
				type: "object",
				properties: { key: { type: "string" } },
				required: ["key"],
				additionalProperties: false,
			}),
			execute: async ({ key }: { key: string }) => ({ value: `value-of-${key}` }),
		});
		const tools = { lookup } as unknown as Record<string, ToolLike>;

		// 1. A real model runs through the adapter; everything is recorded.
		let runId = "";
		const liveResult = (await vercelAdapter.runText(client, {
			agent: "live-replay-demo",
			generateText: generateText as unknown as (
				o: Record<string, unknown>,
			) => Promise<Record<string, unknown>>,
			model: groq(modelId),
			system: "You are terse.",
			tools,
			prompt: "Call the lookup tool once with key 'alpha', then reply with the value it returned.",
			onRun: (run) => {
				runId = run.id;
			},
			passthrough: { temperature: 0, stopWhen: isStepCount(4) },
		})) as { text?: string };

		expect(runId).toBeTruthy();
		console.log(`[live] real model ${modelId} replied: ${JSON.stringify(liveResult.text)}`);

		const detail = await client.getRun(runId);
		const events = (detail.events ?? []) as unknown as ReplayEvent[];
		const modelRequests = events.filter((e) => e.kind === "model.request");
		const modelResponses = events.filter((e) => e.kind === "model.response");
		expect(modelRequests.length).toBeGreaterThan(0);
		expect(modelResponses.length).toBeGreaterThan(0);
		expect(events.some((e) => e.kind === "tool.call" && e.name === "lookup")).toBe(true);
		// Ordering: the model response that requested the tool is recorded
		// before the tool call it triggered.
		const firstResponse = events.findIndex((e) => e.kind === "model.response");
		const firstToolCall = events.findIndex((e) => e.kind === "tool.call");
		expect(firstResponse).toBeGreaterThanOrEqual(0);
		expect(firstResponse).toBeLessThan(firstToolCall);

		const definition = {
			systemPrompt: detail.definition?.system_prompt ?? null,
			model: detail.definition?.model ?? null,
			tools: ["lookup"],
		};

		// 2. Deterministic replay of the real recording → identical.
		const replayed = await replayRun({
			definition,
			events,
			generateText: recordedGenerateText(modelResponses.map((e) => e.result ?? {})),
			model: "mock",
		});
		expect(replayed.diff.identical).toBe(true);
		console.log(`[replay] deterministic: identical=${replayed.diff.identical}`);

		// 3. Live re-run with a real model → report the comparison (not asserted;
		//    a real model is not deterministic).
		const liveRerun = await replayRun({
			definition,
			events,
			tools,
			generateText: generateText as unknown as (
				o: Record<string, unknown>,
			) => Promise<Record<string, unknown>>,
			model: groq(modelId),
		});
		console.log(
			`[replay] live re-run: identical=${liveRerun.diff.identical} divergences=${liveRerun.diff.divergences.length}`,
		);

		await client.close();
	}, 90_000);

	it("streams a real model and captures model I/O in order", async () => {
		const client = new RunmeshClient({
			endpoint: endpoint ?? "http://localhost:8787",
			apiKey: jwt ?? "",
			flushIntervalMs: 0,
		});

		const lookup = tool({
			description: "Look up a value by key.",
			inputSchema: jsonSchema<{ key: string }>({
				type: "object",
				properties: { key: { type: "string" } },
				required: ["key"],
				additionalProperties: false,
			}),
			execute: async ({ key }: { key: string }) => ({ value: `value-of-${key}` }),
		});
		const tools = { lookup } as unknown as Record<string, ToolLike>;

		let runId = "";
		const result = (await vercelAdapter.runStream(client, {
			agent: "live-stream-demo",
			streamText: streamText as unknown as (
				o: Record<string, unknown>,
			) => { textStream: AsyncIterable<unknown> },
			model: groq(modelId),
			system: "You are terse.",
			tools,
			prompt: "Call the lookup tool once with key 'alpha', then reply with the value it returned.",
			onRun: (run) => {
				runId = run.id;
			},
			passthrough: { temperature: 0, stopWhen: isStepCount(4) },
		})) as { textStream: AsyncIterable<unknown> };

		let text = "";
		for await (const chunk of result.textStream) text += String(chunk);
		console.log(`[live/stream] real model streamed: ${JSON.stringify(text)}`);

		// The run closes in onFinish; poll briefly for the flushed events.
		let events: ReplayEvent[] = [];
		for (let i = 0; i < 30; i += 1) {
			const detail = await client.getRun(runId);
			events = (detail.events ?? []) as unknown as ReplayEvent[];
			if (events.some((e) => e.kind === "tool.call")) break;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		await client.close();

		expect(text).toBeTruthy();
		expect(events.some((e) => e.kind === "model.request")).toBe(true);
		expect(events.some((e) => e.kind === "model.response")).toBe(true);
		const firstResponse = events.findIndex((e) => e.kind === "model.response");
		const firstToolCall = events.findIndex((e) => e.kind === "tool.call");
		expect(firstResponse).toBeGreaterThanOrEqual(0);
		expect(firstResponse).toBeLessThan(firstToolCall);
	}, 90_000);
});
