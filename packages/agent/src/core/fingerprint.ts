import { createHash } from "node:crypto";
import type { AgentDefinition } from "./types.js";

/**
 * Canonical definition hash. This exact scheme is the identity contract
 * with the backend: same inputs, same fingerprint, same agent version.
 * Format: `fp_` + first 16 hex chars of SHA-256 over canonical JSON of
 * { framework, model, prompt, tools: sorted tool names }.
 */
export function definitionFingerprint(def: Pick<AgentDefinition, "framework" | "model" | "systemPrompt" | "tools">): string {
  const canonical = JSON.stringify({
    framework: def.framework ?? "",
    model: def.model ?? "",
    prompt: def.systemPrompt ?? "",
    tools: sortedToolNames(def.tools ?? []),
  });
  return "fp_" + createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}

function sortedToolNames(tools: NonNullable<AgentDefinition["tools"]>): string[] {
  const names: string[] = [];
  for (const tool of tools) {
    if (tool && typeof tool.name === "string") names.push(tool.name);
  }
  return names.sort();
}
