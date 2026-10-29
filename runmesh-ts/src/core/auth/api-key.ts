import { createHash, randomBytes } from "node:crypto";

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
