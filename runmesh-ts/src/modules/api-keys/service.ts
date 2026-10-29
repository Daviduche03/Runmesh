import createError from "http-errors";
import type { Db } from "../../core/db/client.js";
import { generateApiKey, hashApiKey, PERMISSIONS } from "../../core/auth/api-key.js";
import { ApiKeyModel } from "../../core/db/orm.js";
import { requireRowAccess } from "../workspace/index.js";

export interface CreateApiKeyInput {
  name?: string;
  permissions?: string[];
  expires_at?: string | null;
}

export interface ServiceResult<T> {
  data: T;
  message?: string;
}

export function createApiKey(
  db: Db,
  userId: string,
  workspaceId: string,
  input: CreateApiKeyInput,
): ServiceResult<Record<string, unknown>> {
  const permissions = input.permissions ?? ["read"];
  const validPermissions = Object.keys(PERMISSIONS);
  for (const permission of permissions) {
    if (!validPermissions.includes(permission)) {
      throw createError(400, `Invalid permission: ${permission}`);
    }
  }

  if (input.expires_at) {
    const expiresAt = new Date(input.expires_at);
    if (Number.isNaN(expiresAt.getTime())) {
      throw createError(400, "Invalid expires_at format. Use ISO datetime.");
    }
    if (expiresAt.getTime() <= Date.now()) {
      throw createError(400, "expires_at must be in the future");
    }
  }

  const apiKey = generateApiKey();
  const keyId = new ApiKeyModel(db).create({
    keyHash: hashApiKey(apiKey),
    name: input.name ?? "",
    userId,
    workspaceId,
    permissions: JSON.stringify(permissions),
    expiresAt: input.expires_at || null,
  });

  return {
    data: {
      id: keyId,
      name: input.name ?? "",
      key: apiKey,
      permissions,
      expires_at: input.expires_at ?? null,
    },
    message: "API key created",
  };
}

export function listApiKeys(db: Db, workspaceId: string): Record<string, unknown>[] {
  return new ApiKeyModel(db).findByWorkspaceId(workspaceId).map((key) => ({
    id: key.id,
    name: key.name,
    permissions: parsePermissions(key.permissions),
    created_at: key.createdAt,
    last_used_at: key.lastUsedAt ?? null,
    expires_at: key.expiresAt ?? null,
  }));
}

export function deleteApiKey(
  db: Db,
  userId: string,
  keyId: string,
): ServiceResult<{ id: string }> {
  const model = new ApiKeyModel(db);
  const apiKey = model.findById(keyId);
  requireRowAccess(db, userId, apiKey, { notFoundDetail: "API key not found" });

  if (!model.deactivate(keyId)) throw createError(400, "Failed to delete API key");

  return { data: { id: keyId }, message: "API key deleted" };
}

function parsePermissions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
