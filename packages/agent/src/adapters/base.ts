import { definitionFingerprint } from "../core/fingerprint.js";
import type { RunmeshClient } from "../core/client.js";
import type {
  AgentDefinition,
  ResolvedAgent,
  ToolLike,
  ToolManifestEntry,
  ToolRegistration,
  ToolWarning,
} from "../core/types.js";

/** Framework-neutral definition. Every adapter normalizes to this. */
export type NormalizedDefinition = {
  framework: string;
  model?: string;
  systemPrompt?: string;
  tools?: ToolManifestEntry[];
};

export type RunContext = {
  client: RunmeshClient;
  runId: string;
  /** Server-issued refs by tool name. Managed tools need this to invoke. */
  registry?: Map<string, ToolRegistration>;
  /** Registration problems reported by the server, surfaced in failures. */
  warnings?: ToolWarning[];
  /** Whose authority a delegated call uses. Server re-verifies. */
  connectUserId?: string;
  /** Override the automatic idempotency key for a managed call. */
  idempotencyKey?: (name: string, args: unknown) => string;
};

/**
 * Contract every supported SDK implements. The mechanics differ per
 * framework (tool shapes, delegation surfaces, model middleware); the
 * pipeline does not: extract a normalized definition, resolve it once,
 * then interpose on execution and report.
 */
export abstract class BaseAdapter<TInput = unknown> {
  /** Stable framework key stored on the agent row, e.g. "vercel-ai-sdk". */
  abstract readonly framework: string;

  /** Extract a normalized definition from framework-native input. */
  abstract extractDefinition(input: TInput): NormalizedDefinition;

  /** Interpose on tool execution. Must preserve shape and behavior:
   *  recording failures are swallowed, original errors rethrow unchanged. */
  abstract wrapTools<T extends Record<string, ToolLike>>(tools: T, ctx: RunContext): T;

  /** Shared resolve flow: normalize, fingerprint, upsert. Subclasses
   *  inherit this; they only define what "the definition" means. */
  async resolve(
    client: RunmeshClient,
    input: TInput,
    opts?: { externalKey?: string; name?: string },
  ): Promise<ResolvedAgent> {
    const def = this.extractDefinition(input);
    const payload: AgentDefinition = {
      framework: def.framework,
      fingerprint: definitionFingerprint(def),
    };
    if (opts?.externalKey !== undefined) payload.externalKey = opts.externalKey;
    if (opts?.name !== undefined) payload.name = opts.name;
    if (def.model !== undefined) payload.model = def.model;
    if (def.systemPrompt !== undefined) payload.systemPrompt = def.systemPrompt;
    if (def.tools !== undefined) payload.tools = def.tools;
    return client.resolveAgent(payload);
  }
}
