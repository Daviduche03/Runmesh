/** @runmesh/agent v0 — observe, and route managed tool calls through Runmesh. */
export { RunmeshClient } from "./core/client.js";
export {
  BaseAdapter,
  type NormalizedDefinition,
  type RunContext,
} from "./adapters/base.js";
export {
  VercelAdapter,
  vercelAdapter,
  wrapTools,
  type VercelAgentInput,
  type VercelRunTextConfig,
} from "./adapters/vercel.js";
export { definitionFingerprint } from "./core/fingerprint.js";
export { redactSecretValues, cappedJson, JSON_FIELD_MAX } from "./core/redact.js";
export { managedTool, isManagedTool, invokeKey, type ManagedTool } from "./core/managed.js";
export {
  replayRun,
  diffRuns,
  behaviorSteps,
  normalizeValue,
  collectRecordedToolResults,
  recordedPrompt,
  type DiffResult,
  type DiffDivergence,
  type ReplayConfig,
  type ReplayDefinition,
  type ReplayEvent,
  type ReplayOutcome,
} from "./replay/index.js";
export type {
  AgentDefinition,
  ClientOptions,
  EventKind,
  ForwardOutcome,
  InvokeOutcome,
  ManagedContext,
  ManagedFetchInit,
  ManagedResponse,
  ManagedToolSpec,
  ResolvedAgent,
  RunDetail,
  RunInfo,
  RunStatus,
  TelemetryEvent,
  ToolKind,
  ToolLike,
  ToolManifestEntry,
  ToolRegistration,
  ToolWarning,
} from "./core/types.js";
