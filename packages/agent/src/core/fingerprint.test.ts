import { describe, expect, it } from "vitest";
import { definitionFingerprint } from "./fingerprint.js";

const base = {
  framework: "vercel-ai-sdk",
  model: "claude-sonnet-4-5",
  systemPrompt: "You triage inbox.",
  tools: [{ name: "b" }, { name: "a" }],
};

describe("definitionFingerprint", () => {
  it("is stable and prefixed", () => {
    const a = definitionFingerprint(base);
    expect(a).toBe(definitionFingerprint(base));
    expect(a).toMatch(/^fp_[0-9a-f]{16}$/);
  });

  it("ignores tool order", () => {
    expect(definitionFingerprint({ ...base, tools: [{ name: "a" }, { name: "b" }] })).toBe(
      definitionFingerprint(base),
    );
  });

  it("changes with prompt, model, or tools", () => {
    expect(definitionFingerprint({ ...base, systemPrompt: "Other." })).not.toBe(
      definitionFingerprint(base),
    );
    expect(definitionFingerprint({ ...base, model: "other" })).not.toBe(
      definitionFingerprint(base),
    );
    expect(definitionFingerprint({ ...base, tools: [{ name: "a" }] })).not.toBe(
      definitionFingerprint(base),
    );
  });
});
