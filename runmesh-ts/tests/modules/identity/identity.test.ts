import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { apiKeys } from "../../../src/core/db/schema.js";
import {
  createTestUser,
  deleteJson,
  getJson,
  postJson,
  startTestApp,
} from "../../helpers/test-app.js";
import type { TestApp } from "../../helpers/test-app.js";

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp("identity");
});

afterAll(async () => {
  await app.close();
});

describe("agents", () => {
  test("create returns the public shape and never the public key", async () => {
    const user = await createTestUser(app, "agent-owner@example.com");

    const created = await postJson(
      app,
      "/api/v1/agents",
      {
        name: "deploy-bot",
        description: "ships things",
        environment: "prod",
        public_key: "ssh-ed25519 AAAA",
      },
      user.token,
    );

    expect(created.status).toBe(200);
    expect(created.body.message).toBe("Agent created");
    expect(created.body.data.id).toMatch(/^ag_[0-9a-f]{12}$/);
    expect(created.body.data.name).toBe("deploy-bot");
    expect(created.body.data.status).toBe("active");
    expect(created.body.data.environment).toBe("prod");
    expect(created.body.data.version).toBe(1);
    expect(created.body.data.public_key).toBeUndefined();
    expect(created.body.data.key_fingerprint).toMatch(/^[0-9a-f]{64}$/);

    const listed = await getJson(app, "/api/v1/agents", user.token);
    expect(listed.body.data.length).toBe(1);
    expect(listed.body.meta.total).toBe(1);
    expect(listed.body.data[0].id).toBe(created.body.data.id);
  });

  test("validation mirrors the Python messages", async () => {
    const user = await createTestUser(app, "agent-validation@example.com");

    const noName = await postJson(app, "/api/v1/agents", { name: "  " }, user.token);
    expect(noName.status).toBe(400);
    expect(noName.body.error.message).toBe("Agent name is required (1-64 characters)");

    const badEnv = await postJson(
      app,
      "/api/v1/agents",
      { name: "x", environment: "production" },
      user.token,
    );
    expect(badEnv.status).toBe(400);
    expect(badEnv.body.error.message).toBe("Environment must be dev, staging, or prod");

    const longDescription = await postJson(
      app,
      "/api/v1/agents",
      { name: "x", description: "d".repeat(501) },
      user.token,
    );
    expect(longDescription.status).toBe(400);

    const missingParent = await postJson(
      app,
      "/api/v1/agents",
      { name: "x", parent_agent_id: "ag_missing" },
      user.token,
    );
    expect(missingParent.status).toBe(404);
    expect(missingParent.body.error.message).toBe("Parent agent not found");
  });

  test("archiving is idempotent and hides the agent from the list", async () => {
    const user = await createTestUser(app, "agent-archive@example.com");
    const created = await postJson(app, "/api/v1/agents", { name: "temp" }, user.token);
    const agentId = created.body.data.id as string;

    const first = await deleteJson(app, `/api/v1/agents/${agentId}`, user.token);
    expect(first.status).toBe(200);
    expect(first.body.message).toBe("Agent archived");
    expect(first.body.data.status).toBe("archived");

    const second = await deleteJson(app, `/api/v1/agents/${agentId}`, user.token);
    expect(second.status).toBe(200);

    const listed = await getJson(app, "/api/v1/agents", user.token);
    expect(listed.body.data).toEqual([]);
  });

  test("agents are workspace-scoped", async () => {
    const alice = await createTestUser(app, "agent-alice@example.com");
    const bob = await createTestUser(app, "agent-bob@example.com");
    const created = await postJson(app, "/api/v1/agents", { name: "alice-bot" }, alice.token);

    const bobList = await getJson(app, "/api/v1/agents", bob.token);
    expect(bobList.body.data).toEqual([]);

    const bobArchive = await deleteJson(
      app,
      `/api/v1/agents/${created.body.data.id as string}`,
      bob.token,
    );
    expect(bobArchive.status).toBe(404);
  });
});

describe("API keys", () => {
  test("create returns the plaintext key once and stores only its hash", async () => {
    const user = await createTestUser(app, "key-owner@example.com");

    const created = await postJson(
      app,
      "/api-keys",
      { name: "CI", permissions: ["read", "write"] },
      user.token,
    );
    expect(created.status).toBe(200);
    expect(created.body.message).toBe("API key created");
    expect(created.body.data.key).toStartWith("rk_");
    expect(created.body.data.permissions).toEqual(["read", "write"]);
    expect(created.body.data.expires_at).toBeNull();

    const row = app.handle.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, created.body.data.id as string))
      .get();
    expect(row?.keyHash).not.toContain(created.body.data.key as string);
    expect(row?.keyHash.length).toBe(64);
    expect(row?.permissions).toBe('["read","write"]');

    const listed = await getJson(app, "/api-keys", user.token);
    expect(listed.body.data.length).toBe(1);
    expect(listed.body.data[0].key).toBeUndefined();
    expect(listed.body.data[0].permissions).toEqual(["read", "write"]);
    expect(listed.body.data[0].last_used_at).toBeNull();
  });

  test("invalid permissions and expiry are 400s", async () => {
    const user = await createTestUser(app, "key-validation@example.com");

    const badPermission = await postJson(
      app,
      "/api-keys",
      { name: "x", permissions: ["root"] },
      user.token,
    );
    expect(badPermission.status).toBe(400);
    expect(badPermission.body.error.message).toBe("Invalid permission: root");

    const badExpiry = await postJson(
      app,
      "/api-keys",
      { name: "x", expires_at: "not-a-date" },
      user.token,
    );
    expect(badExpiry.status).toBe(400);
    expect(badExpiry.body.error.message).toBe("Invalid expires_at format. Use ISO datetime.");

    const past = await postJson(
      app,
      "/api-keys",
      { name: "x", expires_at: "2000-01-01T00:00:00Z" },
      user.token,
    );
    expect(past.status).toBe(400);
    expect(past.body.error.message).toBe("expires_at must be in the future");
  });

  test("delete deactivates and is scoped to the owner", async () => {
    const user = await createTestUser(app, "key-delete@example.com");
    const other = await createTestUser(app, "key-other@example.com");
    const created = await postJson(app, "/api-keys", { name: "temp" }, user.token);
    const keyId = created.body.data.id as string;

    const foreignDelete = await deleteJson(app, `/api-keys/${keyId}`, other.token);
    expect(foreignDelete.status).toBe(404);
    // The row carries a workspace id, so the membership gate answers first (same as Python).
    expect(foreignDelete.body.error.message).toBe("Workspace not found");

    const removed = await deleteJson(app, `/api-keys/${keyId}`, user.token);
    expect(removed.status).toBe(200);
    expect(removed.body.message).toBe("API key deleted");

    const listed = await getJson(app, "/api-keys", user.token);
    expect(listed.body.data).toEqual([]);
  });

  test("keys are scoped to the workspace", async () => {
    const alice = await createTestUser(app, "key-alice@example.com");
    const bob = await createTestUser(app, "key-bob@example.com");

    await postJson(app, "/api-keys", { name: "alice-key" }, alice.token);

    const bobList = await getJson(app, "/api-keys", bob.token);
    expect(bobList.body.data).toEqual([]);
  });
});
