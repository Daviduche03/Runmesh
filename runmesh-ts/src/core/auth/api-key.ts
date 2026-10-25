import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const PERMISSIONS: Record<string, string> = {
  read: "Read access to tasks and data",
  write: "Create and modify tasks",
  delete: "Delete tasks and data",
  admin: "Full administrative access",
  ai: "Access to AI endpoints",
};

export function generateApiKey(): string {
  return `rk_${randomBytes(32).toString("base64url")}`;
}

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

export function verifyApiKey(apiKey: string, keyHash: string): boolean {
  const computed = Buffer.from(hashApiKey(apiKey), "utf8");
  const expected = Buffer.from(keyHash, "utf8");
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}
