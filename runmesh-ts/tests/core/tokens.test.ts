import { describe, expect, test } from "bun:test";
import { signToken, verifyToken, sanitizeRedirect } from "../../src/core/auth/tokens.js";

describe("tokens", () => {
  test("round-trips claims", async () => {
    const token = await signToken({ sub: "user_1", email: "a@example.com" }, 60);
    const claims = await verifyToken(token);
    expect(claims?.sub).toBe("user_1");
    expect(claims?.email).toBe("a@example.com");
    expect(typeof claims?.exp).toBe("number");
    expect(typeof claims?.iat).toBe("number");
  });

  test("rejects a tampered payload", async () => {
    const token = await signToken({ sub: "user_1" }, 60);
    const [header, payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin" })).toString("base64url");
    expect(await verifyToken(`${header}.${forged}.${signature}`)).toBeNull();
    expect(payload).toBeTruthy();
  });

  test("rejects an expired token", async () => {
    const token = await signToken({ sub: "user_1" }, -1);
    expect(await verifyToken(token)).toBeNull();
  });

  test("rejects garbage", async () => {
    expect(await verifyToken("not-a-token")).toBeNull();
    expect(await verifyToken("")).toBeNull();
  });

  test("only allows in-app relative redirect targets", () => {
    expect(sanitizeRedirect("/agents/42")).toBe("/agents/42");
    expect(sanitizeRedirect("https://evil.example")).toBe("");
    expect(sanitizeRedirect("//evil.example")).toBe("");
    expect(sanitizeRedirect("/ok\nSet-Cookie: x")).toBe("");
    expect(sanitizeRedirect("")).toBe("");
  });
});
