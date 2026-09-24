#!/usr/bin/env node
/** `runmesh replay <runId>` — deterministic record-and-replay for CI.
 *
 *  The agent's loop and model live in the caller's process, so this CLI does
 *  not run the model itself. Pass a module that exports `generateText` and a
 *  `model` (a recorded-response mock, or a live model) and, optionally, real
 *  `tools`. The CLI wires them into the shared, isomorphic replay engine,
 *  records the replay run back to Runmesh, prints the behavior diff, and exits
 *  non-zero on divergence. */

import { pathToFileURL } from "node:url";
import { RunmeshClient } from "../core/client.js";
import {
  replayRun,
  type ReplayDefinition,
  type ReplayEvent,
  type ReplayOutcome,
} from "../replay/index.js";
import type { ToolLike } from "../core/types.js";

export type CliOptions = {
  runId: string;
  endpoint: string;
  apiKey: string;
  workspaceId?: string;
  modulePath?: string;
  strict: boolean;
  record: boolean;
  json: boolean;
  help: boolean;
};

const USAGE = `Usage: runmesh replay <runId> --module <path> [options]

Options:
  --module <path>      Module exporting { generateText, model, tools?, passthrough? }
  --endpoint <url>     Runmesh endpoint (env RUNMESH_ENDPOINT)
  --api-key <key>      API key (env RUNMESH_API_KEY)
  --workspace-id <id>  Workspace scope (env RUNMESH_WORKSPACE_ID)
  --strict             Compare model responses too, not just tool calls/decisions
  --no-record          Do not write the replay run back to Runmesh
  --json               Machine-readable output
  -h, --help           Show this help`;

/** Parse argv (without node/script). Pure, so it is unit-testable. */
export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env): CliOptions {
  const opts: CliOptions = {
    runId: "",
    endpoint: env["RUNMESH_ENDPOINT"] ?? "http://localhost:8787",
    apiKey: env["RUNMESH_API_KEY"] ?? "",
    strict: false,
    record: true,
    json: false,
    help: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "--strict":
        opts.strict = true;
        break;
      case "--no-record":
        opts.record = false;
        break;
      case "--json":
        opts.json = true;
        break;
      case "--module": {
        const value = argv[++i];
        if (value !== undefined) opts.modulePath = value;
        break;
      }
      case "--endpoint":
        opts.endpoint = argv[++i] ?? opts.endpoint;
        break;
      case "--api-key":
        opts.apiKey = argv[++i] ?? opts.apiKey;
        break;
      case "--workspace-id": {
        const value = argv[++i];
        if (value !== undefined) opts.workspaceId = value;
        break;
      }
      default:
        if (arg !== undefined && !arg.startsWith("-")) positional.push(arg);
    }
  }
  opts.runId = positional[0] ?? "";
  if (env["RUNMESH_WORKSPACE_ID"] && !opts.workspaceId) opts.workspaceId = env["RUNMESH_WORKSPACE_ID"];
  return opts;
}

/** The definition version's tool list is stored as manifest entries; accept
 *  either `{ name }` objects or bare strings. */
export function toolNamesOf(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  const names: string[] = [];
  for (const entry of tools) {
    if (typeof entry === "string") names.push(entry);
    else if (entry !== null && typeof entry === "object") {
      const name = (entry as { name?: unknown }).name;
      if (typeof name === "string") names.push(name);
    }
  }
  return names;
}

type ReplayModule = {
  generateText: (options: Record<string, unknown>) => Promise<unknown>;
  model: unknown;
  tools?: Record<string, ToolLike>;
  passthrough?: Record<string, unknown>;
};

function formatDiff(runId: string, replayId: string | null, outcome: ReplayOutcome<unknown>): string {
  const { diff } = outcome;
  const header = `Replay ${replayId ?? "(not recorded)"} of ${runId}`;
  if (diff.identical) return `${header}: identical (${diff.comparedSteps} behavior steps)`;
  const lines = [header + `: DIVERGED (${diff.divergences.length} divergence(s))`];
  for (const d of diff.divergences) {
    lines.push(
      `  #${d.index}  original: ${JSON.stringify(d.original)}\n` +
        `        replayed: ${JSON.stringify(d.replayed)}`,
    );
  }
  return lines.join("\n");
}

export async function runCli(argv: string[], env: Record<string, string | undefined> = process.env): Promise<number> {
  const opts = parseArgs(argv, env);
  if (opts.help || !opts.runId) {
    process.stdout.write(USAGE + "\n");
    return opts.help ? 0 : 2;
  }
  if (!opts.modulePath) {
    process.stderr.write("error: --module <path> is required (it provides generateText + model)\n");
    return 2;
  }
  if (!opts.apiKey) {
    process.stderr.write("error: --api-key or RUNMESH_API_KEY is required\n");
    return 2;
  }

  const client = new RunmeshClient({
    endpoint: opts.endpoint,
    apiKey: opts.apiKey,
    ...(opts.workspaceId !== undefined ? { workspaceId: opts.workspaceId } : {}),
  });

  const run = await client.getRun(opts.runId);
  const events = (run.events ?? []) as unknown as ReplayEvent[];
  const definition: ReplayDefinition = {
    model: run.definition?.model ?? null,
    systemPrompt: run.definition?.system_prompt ?? null,
    tools: toolNamesOf(run.definition?.tools),
  };
  if (run.definition?.version !== undefined) definition.version = run.definition.version;

  const mod = (await import(pathToFileURL(opts.modulePath).href)) as Partial<ReplayModule>;
  if (typeof mod.generateText !== "function" || mod.model === undefined) {
    process.stderr.write(`error: ${opts.modulePath} must export { generateText, model }\n`);
    return 2;
  }

  const replay = opts.record ? await client.startReplayRun(opts.runId) : null;
  const outcome = await replayRun({
    definition,
    events,
    generateText: mod.generateText,
    model: mod.model,
    ...(mod.tools !== undefined ? { tools: mod.tools } : {}),
    ...(mod.passthrough !== undefined ? { passthrough: mod.passthrough } : {}),
    strict: opts.strict,
  });

  if (replay) {
    for (const event of outcome.replayedEvents) {
      client.record({
        runId: replay.id,
        kind: event.kind as never,
        name: event.name ?? "",
        args: event.args ?? {},
        result: event.result ?? {},
        ...(typeof event.durationMs === "number" ? { durationMs: event.durationMs } : {}),
      });
    }
    client.record({
      runId: replay.id,
      kind: "log",
      name: "replay.diff",
      result: outcome.diff as unknown as Record<string, unknown>,
    });
    await client.finishRun(replay.id, {
      status: outcome.diff.identical ? "completed" : "failed",
    });
    await client.close();
  }

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ runId: opts.runId, replayId: replay?.id ?? null, diff: outcome.diff }) + "\n",
    );
  } else {
    process.stdout.write(formatDiff(opts.runId, replay?.id ?? null, outcome) + "\n");
  }
  return outcome.diff.identical ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runCli(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
