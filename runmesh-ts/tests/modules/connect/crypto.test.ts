import { describe, expect, test } from "bun:test";
import { decryptConnectSecret, encryptConnectSecret, hashConnectSecret } from "../../../src/modules/connect/crypto.js";
import {
  isValidEmail,
  listProvidersCatalog,
  normalizeEmail,
  normalizeRequestedScopes,
  parseConnectProvider,
  resolveOauthScopes,
  validateProviderAllowed,
} from "../../../src/modules/connect/providers.js";

describe("connect crypto", () => {
  // Vectors generated with the Python implementation (hashlib/hmac stdlib).
  const SECRET = "test-vault-secret";
  const V2_VECTOR =
    "v2.AAECAwQFBgcICQoLDA0OD_8U0WU9GbUJJUW3uyWNwpFYmw_TLExT5qg_ylzKqm2iur8zZjU1VE3PBR3Hjg==";
  const LEGACY_VECTOR = "YnlYnqbsrdbEn7FVIA==";

  test("decrypts the Python v2 vector and rejects tampering", () => {
    expect(decryptConnectSecret(V2_VECTOR, SECRET)).toBe("hello connect");
    expect(decryptConnectSecret(V2_VECTOR, "wrong-secret")).toBeNull();
    const tampered = `${V2_VECTOR.slice(0, -2)}AA`;
    expect(decryptConnectSecret(tampered, SECRET)).toBeNull();
  });

  test("decrypts legacy repeating-XOR values read-only", () => {
    expect(decryptConnectSecret(LEGACY_VECTOR, SECRET)).toBe("hello connect");
    expect(decryptConnectSecret("!!!not-base64!!!", SECRET)).toBeNull();
    expect(decryptConnectSecret(null, SECRET)).toBeNull();
    expect(decryptConnectSecret("", SECRET)).toBeNull();
  });

  test("encrypts byte-identical padded output for padding-sensitive lengths", () => {
    const iv = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
    expect(encryptConnectSecret("x", SECRET, iv)).toBe(
      "v2.AAECAwQFBgcICQoLDA0ODxxix9MTmeii0yTlI_ySa1y5luNp_imt1ggZMDIxj9iIqg==",
    );
    expect(decryptConnectSecret(encryptConnectSecret("t", SECRET), SECRET)).toBe("t");
  });

  test("roundtrips current-format values", () => {
    const enc = encryptConnectSecret("s3cr3t-token", SECRET);
    expect(enc.startsWith("v2.")).toBe(true);
    expect(decryptConnectSecret(enc, SECRET)).toBe("s3cr3t-token");
    expect(decryptConnectSecret(enc, "wrong-secret")).toBeNull();
  });

  test("hashConnectSecret matches Python HMAC-SHA256", () => {
    expect(hashConnectSecret("code123", "vault-key")).toBe(
      "d73b63aa933d71d5b701ae754157d68fb96b859be68984cebd7652ade4c32419",
    );
  });
});

describe("providers", () => {
  test("parse/validate/normalize scopes", () => {
    expect(parseConnectProvider(" Google ")).toBe("google");
    expect(() => parseConnectProvider("nope")).toThrow();
    expect(() => parseConnectProvider("")).toThrow();
    validateProviderAllowed("google", []);
    validateProviderAllowed("google", ["google"]);
    expect(() => validateProviderAllowed("slack", ["google"])).toThrow();
    // Canonical labels and remote values both accepted, deduped in order.
    expect(
      normalizeRequestedScopes("google", [
        "gmail.send",
        "https://www.googleapis.com/auth/gmail.send",
        "gmail.send",
      ]),
    ).toEqual(["gmail.send"]);
    expect(() => normalizeRequestedScopes("google", ["bogus"])).toThrow();
    expect(resolveOauthScopes("google", "connect", ["gmail.send"])).toEqual([
      "https://www.googleapis.com/auth/gmail.send",
    ]);
    expect(listProvidersCatalog().map((p) => p.id)).toEqual(["google", "slack", "meta", "intercom"]);
  });

  test("email helpers", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(isValidEmail("foo@bar.com")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
  });
});
