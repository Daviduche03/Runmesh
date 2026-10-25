import { describe, expect, test } from "bun:test";
import { isOutboundUrlAllowed, validateOutboundUrl } from "../../src/core/url-security.js";

describe("outbound URL validation", () => {
  test.each([
    ["https://api.github.com/repos"],
    ["http://example.com"],
    ["https://8.8.8.8/path"],
  ])("allows %s", (url) => {
    expect(isOutboundUrlAllowed(url)).toBe(true);
  });

  test.each([
    [""],
    ["ftp://example.com"],
    ["file:///etc/passwd"],
    ["https://localhost/hook"],
    ["https://app.localhost/hook"],
    ["https://metadata.google.internal/x"],
    ["https://user:pass@example.com"],
    ["https://127.0.0.1/x"],
    ["https://10.1.2.3/x"],
    ["https://172.16.0.1/x"],
    ["https://192.168.1.1/x"],
    ["https://169.254.169.254/latest/meta-data"],
    ["https://0.0.0.0/x"],
    ["https://[::1]/x"],
    ["https://[fe80::1]/x"],
    ["https://[fd00::1]/x"],
    ["https://example.internal/x"],
  ])("blocks %s", (url) => {
    expect(isOutboundUrlAllowed(url)).toBe(false);
  });

  test("throws a 400 with the field name", () => {
    try {
      validateOutboundUrl("https://localhost/x", "callback_url");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { status: number }).status).toBe(400);
      expect((err as Error).message).toContain("callback_url");
    }
  });
});
