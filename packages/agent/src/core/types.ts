/** Public types for @runmesh/agent v0. Framework-agnostic by design:
 *  tools are duck-typed to the shape every major TS agent SDK uses. */

export type AgentDefinition = {
  /** Stable caller-provided key. Falls back to fingerprint when omitted. */
  externalKey?: string;
  /** Precomputed definition hash. Computed locally when omitted. */
  fingerprint?: string;
  name?: string;
  framework?: string;
  model?: string;
  systemPrompt?: string;
  tools?: ToolManifestEntry[];
};

export type ToolKind = "local" | "managed";

export type ToolManifestEntry = {
  name: string;
  description?: string;
  parameters?: unknown;
  /** "managed" means Runmesh executes it; anything else is local. */
  kind?: ToolKind;
  provider?: string;
  action?: string;
  method?: string;
  url?: string;
  baseUrl?: string;
  authScheme?: string;
  authHeader?: string;
  authFormat?: string;
  resourceParam?: string;
  schemaHash?: string;
};

/** Server-issued registration for a tool, returned by resolve. */
export type ToolRegistration = {
  name: string;
  ref: string;
  kind: ToolKind;
  provider: string | null;
  action: string;
};

/** Something the server could not register as declared. */
export type ToolWarning = {
  tool: string;
  code: string;
  message: string;
};

export type ResolvedAgent = {
  id: string;
  version: number;
  isNew: boolean;
  isNewVersion: boolean;
  framework?: string | null;
  model?: string | null;
  tools: ToolRegistration[];
  warnings: ToolWarning[];
};

/** Outcome of a managed tool call. Denials are values, not exceptions. */
export type InvokeOutcome =
  | { decision: "allow"; status: number; result: unknown; upstreamError: boolean }
  | { decision: "deny"; reason: string; rule?: string | null }
  | { decision: "escalate"; reason: string; rule?: string | null }
  | { decision: "consent"; provider: string | null; reason: string };

/** Declaration for a managed tool. Without `execute`, Runmesh runs the
 *  declared request (invoke). With `execute`, the dev's code runs and its
 *  outbound calls route through Runmesh via `ctx.fetch` (forward). */
export type ManagedToolSpec = {
  provider: string;
  action?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Endpoint for invoke mode. */
  url?: string;
  /** Origin the forward path is resolved against. */
  baseUrl?: string;
  authScheme?: "none" | "bearer" | "api_key" | "basic";
  authHeader?: string;
  authFormat?: string;
  resourceParam?: string;
  description?: string;
  inputSchema?: unknown;
  /** Forward mode: the dev's own request, routed through Runmesh. */
  execute?: (args: any, ctx: ManagedContext) => Promise<unknown> | unknown;
};

export type ManagedFetchInit = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | boolean>;
};

/** A fetch-like response the dev's tool receives from `ctx.fetch`. */
export type ManagedResponse = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text: string;
  json<T = unknown>(): T;
};

/** What a managed tool's `execute` gets: a routed, credentialed fetch. */
export type ManagedContext = {
  ref: string;
  provider: string | null;
  baseUrl: string | null;
  fetch: (path: string, init?: ManagedFetchInit) => Promise<ManagedResponse>;
};

/** Outcome of a forwarded call. Refusals are values, not exceptions. */
export type ForwardOutcome =
  | { decision: "allow"; status: number; text: string; upstreamError: boolean }
  | { decision: "deny"; reason: string; rule?: string | null }
  | { decision: "escalate"; reason: string; rule?: string | null }
  | { decision: "consent"; provider: string | null; reason: string };

export type RunInfo = {
  id: string;
  agentId: string;
  parentRunId?: string | null;
  status: string;
};

export type RunStatus = "completed" | "failed";

/** Minimal tool shape shared by Vercel AI SDK, OpenAI Agents SDK, and friends. */
export type ToolLike = {
  description?: string;
  parameters?: unknown;
  execute?: (args: any, context?: any) => PromiseLike<any> | any;
  [key: string]: unknown;
};

export type EventKind =
  | "tool.call"
  | "tool.result"
  | "model.request"
  | "model.response"
  | "policy.decision"
  | "error"
  | "log";

export type TelemetryEvent = {
  runId: string;
  kind: EventKind;
  name?: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  durationMs?: number;
};

export type ClientOptions = {
  endpoint: string;
  apiKey: string;
  /** Events per flush. Defaults to 50. */
  batchSize?: number;
  /** Ms between background flushes. Defaults to 2000. Set 0 to disable. */
  flushIntervalMs?: number;
  /** Called with telemetry transport errors. Never throws. Defaults to noop. */
  onError?: (err: unknown) => void;
  /** fetch implementation. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
};
