import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { createApp } from "../../src/app.js";
import { signToken } from "../../src/core/auth/tokens.js";
import { createDb } from "../../src/core/db/client.js";
import type { DbHandle } from "../../src/core/db/client.js";
import { UserModel } from "../../src/core/db/orm.js";
import type { AppContext } from "../../src/core/http/context.js";
import { Queue } from "../../src/core/runtime/queue.js";
import { applyMigrations } from "../../src/core/runtime/migrate.js";

const DB = "/tmp/opencode/test-app.db";
let handle: DbHandle;
let server: Server;
let base: string;
let token: string;
let userId: string;

function removeDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(DB + suffix)) rmSync(DB + suffix);
  }
}

beforeAll(async () => {
  removeDb();
  applyMigrations(DB);
  handle = createDb(DB);

  const ctx: AppContext = {
    db: handle.db,
    taskQueue: new Queue(handle.db, "runmesh-tasks"),
    webhookQueue: new Queue(handle.db, "runmesh-webhooks"),
  };
  const app = createApp(ctx);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  base = `http://127.0.0.1:${address.port}`;

  userId = new UserModel(handle.db).create({
    name: "Ada",
    email: "ada@example.com",
    password: "x",
    avatarUrl: "https://example.com/ada.png",
  });
  token = await signToken({ sub: userId, email: "ada@example.com" }, 60);
});

afterAll(() => {
  server?.close();
  handle?.close();
  removeDb();
});

describe("HTTP surface", () => {
  test("GET /health returns the success envelope", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { status: "ok" } });
  });

  test("GET / describes the API", async () => {
    const res = await fetch(`${base}/`);
    const body = (await res.json()) as { data: { name: string } };
    expect(body.data.name).toBe("Runmesh API");
  });

  test("unknown routes render a 404 in the error envelope", async () => {
    const res = await fetch(`${base}/api/v1/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: "not_found", message: "Not Found" },
    });
  });

  test("GET /api/me requires a bearer token", async () => {
    const res = await fetch(`${base}/api/me`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
  });

  test("GET /api/me rejects an API key (bearer only)", async () => {
    const res = await fetch(`${base}/api/me`, { headers: { "X-API-Key": "rk_whatever" } });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      "Bearer token required",
    );
  });

  test("GET /api/me rejects a forged token", async () => {
    const res = await fetch(`${base}/api/me`, { headers: { Authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
  });

  test("GET /api/me returns the profile with snake_case wire keys", async () => {
    const res = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(userId);
    expect(body.data.email).toBe("ada@example.com");
    expect(body.data.avatar_url).toBe("https://example.com/ada.png");
    expect(body.data.github_login).toBe("");
  });

  test("malformed JSON is a 422 validation error, not a 500", async () => {
    const res = await fetch(`${base}/api/me`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("validation_error");
  });
});
