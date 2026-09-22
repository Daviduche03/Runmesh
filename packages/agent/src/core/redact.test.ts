import { describe, expect, it } from "vitest";
import { cappedJson, JSON_FIELD_MAX, redactSecretValues } from "./redact.js";

describe("redactSecretValues", () => {
  it("redacts secret-shaped keys, keeps the rest", () => {
    expect(
      redactSecretValues({ api_key: "sk-1", owner: "o", nested: { password: "p", n: 2 } }),
    ).toEqual({ api_key: "[REDACTED]", owner: "o", nested: { password: "[REDACTED]", n: 2 } });
  });

  it("handles authorization headers and tokens", () => {
    expect(redactSecretValues({ Authorization: "Bearer x", token: "t" })).toEqual({
      Authorization: "[REDACTED]",
      token: "[REDACTED]",
    });
  });

  it("caps depth instead of storing deep structures raw", () => {
    let deep: unknown = { v: 1 };
    for (let i = 0; i < 10; i++) deep = { next: deep };
    expect(JSON.stringify(redactSecretValues(deep))).toContain("[TRUNCATED]");
  });

  it("passes through scalars", () => {
    expect(redactSecretValues("x")).toBe("x");
    expect(redactSecretValues(42)).toBe(42);
    expect(redactSecretValues(null)).toBe(null);
  });
});

describe("cappedJson", () => {
  it("flags oversize payloads", () => {
    const big = { blob: "x".repeat(JSON_FIELD_MAX + 1) };
    const out = cappedJson(big);
    expect(out.truncated).toBe(true);
    expect(out.json.length).toBe(JSON_FIELD_MAX);
    expect(cappedJson({ a: 1 }).truncated).toBe(false);
  });
});
