import { definitionFingerprint } from "../core/fingerprint.js";
import { redactSecretValues } from "../core/redact.js";
import { invokeKey, isManagedTool, type ManagedTool } from "../core/managed.js";
import type { RunmeshClient } from "../core/client.js";
import type {
  ForwardOutcome,
  ManagedContext,
  ManagedFetchInit,
  ManagedResponse,
  ResolvedAgent,
  TelemetryEvent,
  ToolLike,
  ToolRegistration,
} from "../core/types.js";
import { BaseAdapter, type NormalizedDefinition, type RunContext } from "./base.js";

const REFUSAL_ERROR: Record<string, string> = {
  deny: "policy_denied",
  consent: "consent_required",
  escalate: "policy_escalated",
};

const REFUSAL_STATUS: Record<string, number> = { deny: 403, consent: 402, escalate: 409 };

function managedMisconfigMessage(
  name: string,
  registration: ToolRegistration | undefined,
  ctx: RunContext,
): string {
  const warning = ctx.warnings?.find((w) => w.tool === name);
  const why = warning
    ? warning.message
    : registration
      ? `The server registered it as "${registration.kind}".`
      : "It was not found in the registry.";
  const hint = ctx.registry
    ? "A managed tool needs a provider and either url (invoke) or baseUrl (forward), and must be resolved before wrapping."
    : "wrapTools was called without a registry — use runText(), or pass the registry returned by resolve().";
  return `Runmesh: managed tool "${name}" cannot be routed. ${why} ${hint}`;
}

/** Turn a forward outcome into a fetch-like response so `res.ok` works. */
function toManagedResponse(outcome: ForwardOutcome): ManagedResponse {
  if (outcome.decision === "allow") {
    const { status, text } = outcome;
    return {
      status,
      ok: status < 400,
      headers: {},
      text,
      json<T = unknown>() {
        return JSON.parse(text) as T;
      },
    };
  }
  const status = REFUSAL_STATUS[outcome.decision] ?? 403;
  const text = JSON.stringify({
    error: REFUSAL_ERROR[outcome.decision] ?? "policy_denied",
    reason: outcome.reason,
  });
  return {
    status,
    ok: false,
    headers: {},
    text,
    json<T = unknown>() {
      return JSON.parse(text) as T;
    },
  };
}

/**
 * v7 tools carry `inputSchema` (older shapes used `parameters`). A Zod
 * object schema is summarized to its property names — stringifying it raw
 * stores hundreds of chars of validator internals. Plain-JSON schemas pass
 * through; anything else is omitted rather than stored as noise.
 */
function summarizeSchema(tool: ToolLike): { parameters?: unknown } {
  const raw =
    (tool as { inputSchema?: unknown }).inputSchema ?? (tool as { parameters?: unknown }).parameters;
  if (raw === undefined) return {};
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const shape = (raw as { shape?: unknown }).shape;
    if (shape !== null && typeof shape === "object" && !Array.isArray(shape)) {
      return { parameters: { kind: "object", properties: Object.keys(shape) } };
    }
    return { parameters: raw };
  }
  return {};
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

/** Framework-native input for Vercel AI SDK agents. */
export type VercelAgentInput = {
  model?: string;
  systemPrompt?: string;
  tools?: Record<string, ToolLike>;
};

export class VercelAdapter extends BaseAdapter<VercelAgentInput> {
  readonly framework = "vercel-ai-sdk";

  extractDefinition(input: VercelAgentInput): NormalizedDefinition {
    const tools = Object.entries(input.tools ?? {}).map(([name, tool]) =>
      isManagedTool(tool)
        ? {
            name,
            kind: "managed" as const,
            provider: tool.provider,
            ...(tool.action !== undefined ? { action: tool.action } : {}),
            ...(tool.method !== undefined ? { method: tool.method } : {}),
            ...(tool.url !== undefined ? { url: tool.url } : {}),
            ...(tool.baseUrl !== undefined ? { baseUrl: tool.baseUrl } : {}),
            ...(tool.authScheme !== undefined ? { authScheme: tool.authScheme } : {}),
            ...(tool.authHeader !== undefined ? { authHeader: tool.authHeader } : {}),
            ...(tool.authFormat !== undefined ? { authFormat: tool.authFormat } : {}),
            ...(tool.resourceParam !== undefined ? { resourceParam: tool.resourceParam } : {}),
            ...(typeof tool.description === "string" ? { description: tool.description } : {}),
          }
        : {
            name,
            kind: "local" as const,
            ...(typeof tool.description === "string" ? { description: tool.description } : {}),
            ...summarizeSchema(tool),
          },
    );
    const def: NormalizedDefinition = { framework: this.framework, tools };
    if (input.model !== undefined) def.model = input.model;
    if (input.systemPrompt !== undefined) def.systemPrompt = input.systemPrompt;
    return def;
  }

  /**
   * One call instead of five statements. Resolves (cached), opens the run,
   * wraps tools, runs `generateText`, finishes with usage, flushes. Thrown
   * agent errors rethrow unchanged after the run is marked failed. The
   * granular primitives stay for custom loops, streaming, and manual status.
   */
  async runText<TResult>(
    client: RunmeshClient,
    config: VercelRunTextConfig<TResult>,
  ): Promise<TResult> {
    const { agent, generateText, model, system, tools, prompt, parentRunId, passthrough } = config;
    const identity = typeof agent === "string" ? { externalKey: agent } : agent;
    const resolved = await resolveCached(
      client,
      this,
      {
        ...(modelIdOf(model) !== undefined ? { model: modelIdOf(model) as string } : {}),
        ...(system !== undefined ? { systemPrompt: system } : {}),
        ...(tools !== undefined ? { tools } : {}),
      },
      identity,
    );
    const run = await client.startRun({
      agentId: resolved.id,
      parentRunId,
      input: prompt,
      ...(config.connectUserId !== undefined ? { connectUserId: config.connectUserId } : {}),
    });
    const registry = new Map((resolved.tools ?? []).map((tool) => [tool.name, tool]));
    const ctx: RunContext = { client, runId: run.id, registry };
    if (config.connectUserId !== undefined) ctx.connectUserId = config.connectUserId;
    if ((resolved.warnings ?? []).length > 0) ctx.warnings = resolved.warnings;
    const wrapped = this.wrapTools(tools ?? {}, ctx);
    try {
      const result = await generateText({
        model,
        ...(system !== undefined ? { system } : {}),
        tools: wrapped,
        prompt,
        ...(passthrough ?? {}),
      });
      await client.finishRun(run.id, { status: "completed", usage: usageOf(result) });
      return result;
    } catch (err) {
      await client.finishRun(run.id, { status: "failed" });
      throw err;
    } finally {
      await client.flush();
    }
  }

  wrapTools<T extends Record<string, ToolLike>>(tools: T, ctx: RunContext): T {
    const wrapped: Record<string, ToolLike> = { ...tools };
    for (const [name, tool] of Object.entries(tools)) {
      const registration = ctx.registry?.get(name);
      const marked = isManagedTool(tool);
      if (marked && registration?.kind !== "managed") {
        // A managed tool that will not route must fail loudly, not silently
        // degrade to a local (uncredentialed, unrouted) call.
        throw new Error(managedMisconfigMessage(name, registration, ctx));
      }
      if (registration?.kind === "managed") {
        const spec = tool as unknown as ManagedTool;
        // Forward mode: the dev's own request, routed through Runmesh.
        // Invoke mode: no local implementation; Runmesh executes the declared call.
        wrapped[name] =
          typeof spec.execute === "function"
            ? { ...tool, execute: VercelAdapter.managedForward(name, spec, ctx) }
            : { ...tool, execute: VercelAdapter.managed(name, ctx) };
        continue;
      }
      const original = tool.execute;
      if (typeof original !== "function") continue;
      wrapped[name] = {
        ...tool,
        execute: VercelAdapter.interpose(name, tool, original, ctx.client, ctx.runId),
      };
    }
    // Same keys, same shapes — only `execute` is added or interposed.
    return wrapped as T;
  }

  /**
   * Managed execution: the call goes to Runmesh, which decides, injects the
   * connection credential, and returns only the result. Denials are returned
   * to the model as a tool result so it can adapt; a transport failure is
   * fail-closed (no side effect) and also surfaced as a result.
   */
  /**
   * Forward mode: the dev's `execute` runs locally, and every request it makes
   * through `ctx.fetch` is routed through Runmesh, which injects the
   * credential. Refusals come back as a fetch-like response (403/402/409) so
   * ordinary `res.ok` handling works.
   */
  private static managedForward(name: string, spec: ManagedTool, ctx: RunContext) {
    return async (args: any) => {
      const registration = ctx.registry?.get(name);
      if (!registration) {
        return { error: "runmesh_unregistered", message: `Tool "${name}" is not registered` };
      }
      const routedFetch = async (path: string, init: ManagedFetchInit = {}) => {
        const method = init.method ?? "GET";
        const mutating = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
        const outcome = await ctx.client.forward(
          registration.ref,
          {
            method,
            path,
            ...(init.headers !== undefined ? { headers: init.headers } : {}),
            ...(init.body !== undefined ? { body: init.body } : {}),
            ...(init.query !== undefined ? { query: init.query } : {}),
          },
          {
            runId: ctx.runId,
            // Only mutating calls get an idempotency key: a replayed GET would
            // return stale data, while a retried POST must not double-execute.
            ...(mutating
              ? {
                  idempotencyKey:
                    ctx.idempotencyKey?.(name, init) ??
                    invokeKey(ctx.runId, name, { method, path, body: init.body }),
                }
              : {}),
            ...(ctx.connectUserId !== undefined ? { connectUserId: ctx.connectUserId } : {}),
          },
        );
        return toManagedResponse(outcome);
      };
      const managedCtx: ManagedContext = {
        ref: registration.ref,
        provider: registration.provider,
        baseUrl: spec.baseUrl ?? null,
        fetch: routedFetch,
      };
      return spec.execute!(args, managedCtx);
    };
  }

  private static managed(name: string, ctx: RunContext) {
    return async (args: any) => {
      const registration = ctx.registry?.get(name);
      if (!registration) {
        return { error: "runmesh_unregistered", message: `Tool "${name}" is not registered` };
      }
      try {
        const outcome = await ctx.client.invoke(registration.ref, args, {
          runId: ctx.runId,
          idempotencyKey:
            ctx.idempotencyKey?.(name, args) ?? invokeKey(ctx.runId, name, args),
          ...(ctx.connectUserId !== undefined ? { connectUserId: ctx.connectUserId } : {}),
        });
        if (outcome.decision === "allow") return outcome.result;
        if (outcome.decision === "deny") {
          return { error: "policy_denied", reason: outcome.reason, rule: outcome.rule ?? null };
        }
        if (outcome.decision === "escalate") {
          return { error: "policy_escalated", reason: outcome.reason };
        }
        return {
          error: "consent_required",
          provider: outcome.provider,
          reason: outcome.reason,
        };
      } catch (err) {
        return {
          error: "runmesh_invoke_failed",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    };
  }

  private static interpose(
    name: string,
    tool: ToolLike,
    original: NonNullable<ToolLike["execute"]>,
    client: RunmeshClient,
    runId: string,
  ) {
    // Recording must never break execution, even against a throwing recorder.
    const safeRecord = (event: TelemetryEvent) => {
      try {
        client.record(event);
      } catch {
        // Swallowed by contract.
      }
    };
    return async (args: any, context?: any) => {
      const started = Date.now();
      safeRecord({
        runId,
        kind: "tool.call",
        name,
        args: toRecord(redactSecretValues(args)),
      });
      try {
        const result = await original.call(tool, args, context);
        safeRecord({
          runId,
          kind: "tool.result",
          name,
          result: toRecord(redactSecretValues(result)),
          durationMs: Date.now() - started,
        });
        return result;
      } catch (err) {
        safeRecord({
          runId,
          kind: "error",
          name,
          result: { message: err instanceof Error ? err.message : String(err) },
          durationMs: Date.now() - started,
        });
        throw err;
      }
    };
  }
}

/** Resolve cache, per client so backends never cross. Keyed by fingerprint
 *  alone: an identical definition skips the network, while any definition
 *  change misses and re-resolves (which is what opens a new version). */
const resolveCache = new WeakMap<RunmeshClient, Map<string, ResolvedAgent>>();

async function resolveCached(
  client: RunmeshClient,
  adapter: VercelAdapter,
  input: VercelAgentInput,
  opts?: { externalKey?: string; name?: string },
): Promise<ResolvedAgent> {
  const def = adapter.extractDefinition(input);
  const key = definitionFingerprint(def);
  let table = resolveCache.get(client);
  if (!table) {
    table = new Map();
    resolveCache.set(client, table);
  }
  const hit = table.get(key);
  if (hit) return hit;
  const resolved = await adapter.resolve(client, input, opts);
  table.set(key, resolved);
  return resolved;
}

export type VercelRunTextConfig<TResult> = {
  /** Agent key, or full identity for first contact. */
  agent: string | { key?: string; name?: string };
  /** The framework's `generateText`, injected to keep this package dependency-free. */
  generateText: (options: Record<string, unknown>) => Promise<TResult>;
  model: unknown;
  system?: string;
  tools?: Record<string, ToolLike>;
  prompt: string;
  parentRunId?: string;
  /** Whose authority a delegated managed call uses. */
  connectUserId?: string;
  /** Forwarded untouched: stopWhen, temperature, providerOptions, … */
  passthrough?: Record<string, unknown>;
};

function modelIdOf(model: unknown): string | undefined {
  if (typeof model === "string") return model;
  if (model !== null && typeof model === "object") {
    const id = (model as { modelId?: unknown }).modelId;
    if (typeof id === "string") return id;
  }
  return undefined;
}

function usageOf(result: unknown): Record<string, unknown> | undefined {
  if (result !== null && typeof result === "object" && "usage" in result) {
    const usage = (result as { usage?: unknown }).usage;
    if (usage !== null && typeof usage === "object" && !Array.isArray(usage)) {
      return usage as Record<string, unknown>;
    }
  }
  return undefined;
}

export const vercelAdapter = new VercelAdapter();

/** Convenience for the common case; equivalent to `vercelAdapter.wrapTools`. */
export function wrapTools<T extends Record<string, ToolLike>>(tools: T, ctx: RunContext): T {
  return vercelAdapter.wrapTools(tools, ctx);
}
