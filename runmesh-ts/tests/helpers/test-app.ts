import type { Server } from "node:http";
import { existsSync, rmSync } from "node:fs";
import { createApp } from "../../src/app.js";
import { signToken } from "../../src/core/auth/tokens.js";
import { createDb } from "../../src/core/db/client.js";
import type { DbHandle } from "../../src/core/db/client.js";
import { UserModel } from "../../src/core/db/orm.js";
import type { AppContext } from "../../src/core/http/context.js";
import { Queue } from "../../src/core/runtime/queue.js";
import { applyMigrations } from "../../src/core/runtime/migrate.js";

export interface TestApp {
  base: string;
  handle: DbHandle;
  close: () => Promise<void>;
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

/** A real Express app on an ephemeral port, backed by a throwaway migrated database. */
export async function startTestApp(name: string): Promise<TestApp> {
  const dbPath = `/tmp/opencode/test-${name}.db`;

  const removeDb = (): void => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
    }
  };

  removeDb();
  applyMigrations(dbPath);
  const handle = createDb(dbPath);

  const ctx: AppContext = {
    db: handle.db,
    taskQueue: new Queue(handle.db, "runmesh-tasks"),
    webhookQueue: new Queue(handle.db, "runmesh-webhooks"),
  };

  const app = createApp(ctx);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port assigned");

  return {
    base: `http://127.0.0.1:${address.port}`,
    handle,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      handle.close();
      removeDb();
    },
  };
}

export async function createTestUser(
  app: TestApp,
  email: string,
  name = "Test User",
): Promise<TestUser> {
  const id = new UserModel(app.handle.db).create({ name, email, password: "x" });
  const token = await signToken({ sub: id, email, name }, 60);
  return { id, email, token };
}

export function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getJson(
  app: TestApp,
  path: string,
  token?: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${app.base}${path}`, {
    headers: { ...authHeaders(token), ...headers },
  });
  return { status: response.status, body: await response.json() };
}

export async function postJson(
  app: TestApp,
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${app.base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

export async function deleteJson(
  app: TestApp,
  path: string,
  token?: string,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${app.base}${path}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  return { status: response.status, body: await response.json() };
}
