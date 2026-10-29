import type { Request, RequestHandler } from "express";
import createError from "http-errors";
import { hashApiKey } from "../auth/api-key.js";
import { verifyToken } from "../auth/tokens.js";
import type { TokenClaims } from "../auth/tokens.js";
import { ApiKeyModel, UserModel, findMembership } from "../db/orm.js";
import type { AuthUser } from "../http/context.js";
import { parseJsonArray } from "../types/helpers.js";

/** JWT `sub` is the user id; routes read `req.auth.id` regardless of credential type. */
function toAuthUser(claims: TokenClaims): AuthUser {
  return { ...claims, id: String(claims.sub ?? claims.id ?? "") };
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

/**
 * Resolve the caller from `X-API-Key` or a bearer token, in that order.
 * Throws 401/403 — never returns null.
 */
export async function resolveAuthUser(req: Request, requiredPermissions: string[] = []): Promise<AuthUser> {
  const { db } = req.ctx;
  const apiKey = req.headers["x-api-key"];
  const rawKey = Array.isArray(apiKey) ? apiKey[0] : apiKey;

  if (rawKey) {
    if (!rawKey.startsWith("rk_")) throw createError(401, "Invalid API key format");

    const keyModel = new ApiKeyModel(db);
    const key = keyModel.findByKeyHash(hashApiKey(rawKey));
    if (!key) throw createError(401, "Invalid API key");

    if (key.expiresAt) {
      const expiresAt = new Date(key.expiresAt);
      if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
        throw createError(401, "API key expired");
      }
    }

    if (requiredPermissions.length > 0) {
      const permissions = parseJsonArray(key.permissions);
      if (!permissions.includes("admin")) {
        for (const permission of requiredPermissions) {
          if (!permissions.includes(permission)) {
            throw createError(403, `Insufficient permissions: ${permission} required`);
          }
        }
      }
    }

    const user = new UserModel(db).findById(key.userId);
    if (!user) throw createError(401, "User not found");

    keyModel.updateLastUsed(key.id);

    if (key.workspaceId && !findMembership(db, user.id, key.workspaceId)) {
      throw createError(401, "API key is not authorized for this workspace");
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      apiKeyWorkspaceId: key.workspaceId ?? null,
    };
  }

  const token = bearerToken(req);
  if (token) {
    const payload = await verifyToken(token);
    if (!payload) throw createError(401, "Invalid token");
    return toAuthUser(payload);
  }

  throw createError(
    401,
    "Authentication required. Use Authorization: Bearer <token> or X-API-Key header.",
  );
}

/** Middleware requiring any authenticated principal, optionally holding every listed permission. */
export function requireAuth(...permissions: string[]): RequestHandler {
  return async (req, _res, next) => {
    try {
      req.auth = await resolveAuthUser(req, permissions);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Middleware requiring a bearer token specifically (API keys rejected). */
export function requireJwt(): RequestHandler {
  return async (req, _res, next) => {
    try {
      const token = bearerToken(req);
      if (!token) throw createError(401, "Bearer token required");
      const payload = await verifyToken(token);
      if (!payload) throw createError(401, "Invalid token");
      req.auth = toAuthUser(payload);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function currentUser(req: Request): AuthUser {
  if (!req.auth) throw createError(401, "Authentication required");
  return req.auth;
}
