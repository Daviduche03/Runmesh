import { randomBytes } from "node:crypto";
import type { Db } from "../../core/db/client.js";
import { ConnectAppModel } from "../../core/db/orm.js";
import type { ConnectAppRow } from "../../core/db/orm.js";
import { hashApiKey } from "../../core/auth/api-key.js";

/**
 * The workspace's singleton OAuth client. Created on first use — there is
 * deliberately no app management UI; the app is auto-provisioned config.
 */
export function ensureWorkspaceApp(
  db: Db,
  workspaceId: string,
  developerUserId: string,
): ConnectAppRow {
  const existing = new ConnectAppModel(db).findByWorkspace(workspaceId);
  if (existing) return existing;
  return new ConnectAppModel(db).create({
    developerUserId,
    name: "Default",
    slug: `ws-${workspaceId.slice(0, 8)}`,
    clientSecretHash: hashApiKey(randomBytes(32).toString("base64url")),
    redirectUris: [],
    allowedProviders: [],
    workspaceId,
  });
}
