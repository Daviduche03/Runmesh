/**
 * Connect credential vault.
 *
 * Format: `v2.` + base64url(iv || tag || ciphertext), where the keystream is
 * HMAC-SHA256 CTR and the tag is Encrypt-then-MAC — byte-compatible with the Python
 * implementation, so rows encrypted by either side decrypt on the other. Legacy
 * prefix-less values (repeating-XOR) decrypt only, and are re-encrypted on next write.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const V2_PREFIX = "v2.";
const IV_LEN = 16;
const TAG_LEN = 32;

/** Mirror Python's `urlsafe_b64decode` strictness: valid alphabet, correct padding. */
const STRICT_BASE64URL = /^[A-Za-z0-9\-_]*={0,2}$/;

function toPaddedBase64Url(raw: Buffer): string {
  return raw.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64UrlStrict(value: string): Buffer {
  if (!STRICT_BASE64URL.test(value)) throw new Error("invalid base64url");
  const stripped = value.replace(/=+$/, "");
  if (stripped.length % 4 === 1) throw new Error("invalid base64url");
  const padded = stripped + "=".repeat((4 - (stripped.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

function vaultKeys(secret: string): { encKey: Buffer; macKey: Buffer } {
  const master = createHash("sha256").update(`connect-vault:${secret}`, "utf8").digest();
  return {
    encKey: createHmac("sha256", master).update("connect-vault/enc", "utf8").digest(),
    macKey: createHmac("sha256", master).update("connect-vault/mac", "utf8").digest(),
  };
}

/** HMAC-CTR keystream: block_i = HMAC(enc_key, iv || counter_be64). */
function keystream(encKey: Buffer, iv: Buffer, length: number): Buffer {
  const blocks: Buffer[] = [];
  let counter = 0;
  while (Buffer.concat(blocks).length < length) {
    const ctr = Buffer.alloc(8);
    ctr.writeBigUInt64BE(BigInt(counter));
    blocks.push(createHmac("sha256", encKey).update(Buffer.concat([iv, ctr])).digest());
    counter += 1;
  }
  return Buffer.concat(blocks).subarray(0, length);
}

function xorWithStream(data: Buffer, stream: Buffer): Buffer {
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i]! ^ stream[i]!;
  return out;
}

export function encryptConnectSecret(plaintext: string, secret: string, iv?: Buffer): string {
  const { encKey, macKey } = vaultKeys(secret);
  const nonce = iv ?? randomBytes(IV_LEN);
  const data = Buffer.from(plaintext, "utf8");
  const ciphertext = xorWithStream(data, keystream(encKey, nonce, data.length));
  const tag = createHmac("sha256", macKey).update(Buffer.concat([nonce, ciphertext])).digest();
  return V2_PREFIX + toPaddedBase64Url(Buffer.concat([nonce, tag, ciphertext]));
}

export function decryptConnectSecret(ciphertext: string | null | undefined, secret: string): string | null {
  if (!ciphertext) return null;
  if (ciphertext.startsWith(V2_PREFIX)) {
    try {
      const raw = decodeBase64UrlStrict(ciphertext.slice(V2_PREFIX.length));
      const iv = raw.subarray(0, IV_LEN);
      const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
      const body = raw.subarray(IV_LEN + TAG_LEN);
      const { encKey, macKey } = vaultKeys(secret);
      const expected = createHmac("sha256", macKey).update(Buffer.concat([iv, body])).digest();
      if (tag.length !== expected.length || !timingSafeEqual(tag, expected)) return null;
      return strictUtf8.decode(xorWithStream(body, keystream(encKey, iv, body.length)));
    } catch {
      return null;
    }
  }
  // Legacy repeating-XOR values (read-only fallback; re-encrypt on next write).
  try {
    const raw = decodeBase64UrlStrict(ciphertext);
    const key = createHash("sha256").update(`connect-vault:${secret}`, "utf8").digest();
    const decoded = Buffer.alloc(raw.length);
    for (let i = 0; i < raw.length; i++) decoded[i] = raw[i]! ^ key[i % key.length]!;
    return strictUtf8.decode(decoded);
  } catch {
    return null;
  }
}

/** Keyed HMAC-SHA256 so stored OTP codes cannot be brute-forced from a DB dump alone. */
export function hashConnectSecret(value: string, key: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}
