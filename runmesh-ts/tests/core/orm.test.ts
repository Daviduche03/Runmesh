import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { createDb } from "../../src/core/db/client.js";
import type { DbHandle } from "../../src/core/db/client.js";
import {
  ApiKeyModel,
  TaskModel,
  UserModel,
  WebhookModel,
  WorkflowModel,
  WorkflowRunModel,
  findMembership,
} from "../../src/core/db/orm.js";
import { workspaces } from "../../src/core/db/schema.js";
import { applyMigrations } from "../../src/core/runtime/migrate.js";

const DB = "/tmp/opencode/test-orm.db";
let handle: DbHandle;

function removeDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(DB + suffix)) rmSync(DB + suffix);
  }
}

function makeUser(email = "person@example.com"): string {
  return new UserModel(handle.db).create({ name: "Person", email, password: "hash" });
}

function makeWorkspace(ownerUserId: string): string {
  const id = `ws_${crypto.randomUUID()}`;
  const ts = new Date().toISOString();
  handle.db
    .insert(workspaces)
    .values({ id, name: "Test workspace", ownerUserId, createdAt: ts, updatedAt: ts })
    .run();
  return id;
}

describe("models", () => {
  beforeEach(() => {
    removeDb();
    applyMigrations(DB);
    handle = createDb(DB);
  });

  afterEach(() => {
    handle.close();
    removeDb();
  });

  test("user create + lookups, email is case-insensitive", () => {
    const id = makeUser("mixed@example.com");
    const users = new UserModel(handle.db);
    expect(users.findById(id)?.email).toBe("mixed@example.com");
    expect(users.findByEmail("MIXED@Example.com")?.id).toBe(id);
    expect(users.findByEmail("nobody@example.com")).toBeNull();
  });

  test("task lifecycle updates timestamps and retry counters", () => {
    const userId = makeUser();
    const tasks = new TaskModel(handle.db);
    const id = tasks.create({
      type: "http",
      payload: "{}",
      url: "https://example.com",
      status: "pending",
      scheduledAt: new Date().toISOString(),
      executionType: "queue",
      userId,
    });

    expect(tasks.findById(id)?.status).toBe("pending");
    expect(tasks.findById(id)?.idempotencyKey).toBeTruthy();

    tasks.updateStatus(id, "queued");
    expect(tasks.findById(id)?.status).toBe("queued");

    tasks.incrementRetries(id, "failed");
    expect(tasks.findById(id)?.retries).toBe(1);

    tasks.completeExecution(id, "completed", "body", 200);
    expect(tasks.findById(id)?.responseStatus).toBe(200);

    expect(tasks.deleteTask(id)).toBe(1);
    expect(tasks.findById(id)).toBeNull();
  });

  test("findByIdempotencyKey is scoped to the workspace", () => {
    const userId = makeUser();
    const workspaceId = makeWorkspace(userId);
    const otherWorkspaceId = makeWorkspace(makeUser("other@example.com"));
    const tasks = new TaskModel(handle.db);
    const id = tasks.create({
      type: "http",
      payload: "{}",
      url: "https://example.com",
      status: "pending",
      scheduledAt: new Date().toISOString(),
      executionType: "queue",
      userId,
      workspaceId,
      idempotencyKey: "key-1",
    });

    expect(tasks.findByIdempotencyKey(workspaceId, "key-1")?.id).toBe(id);
    expect(tasks.findByIdempotencyKey(otherWorkspaceId, "key-1")).toBeNull();
  });

  test("workflow and run helpers", () => {
    const userId = makeUser();
    const workspaceId = makeWorkspace(userId);
    const workflows = new WorkflowModel(handle.db);
    const workflowId = workflows.create({ name: "Flow", userId, workspaceId });

    expect(workflows.findById(workflowId)?.name).toBe("Flow");
    expect(workflows.list(workspaceId).length).toBe(1);

    const runs = new WorkflowRunModel(handle.db);
    const runId = runs.create({
      workflowId,
      userId,
      startedAt: new Date().toISOString(),
      status: "running",
    });

    expect(runs.findActiveForWorkflow(workflowId)?.id).toBe(runId);
    expect(runs.listRunning().length).toBe(1);
    expect(runs.deleteByWorkflowId(workflowId)).toBe(1);
  });

  test("api keys: only active keys resolve, deactivate hides them", () => {
    const userId = makeUser();
    const keys = new ApiKeyModel(handle.db);
    const keyId = keys.create({
      keyHash: "abc",
      name: "default",
      userId,
      permissions: '["read"]',
    });

    expect(keys.findByKeyHash("abc")?.id).toBe(keyId);
    expect(keys.findByUserId(userId).length).toBe(1);

    keys.updateLastUsed(keyId);
    expect(keys.findById(keyId)?.lastUsedAt).toBeTruthy();

    keys.deactivate(keyId);
    expect(keys.findByKeyHash("abc")).toBeNull();
  });

  test("webhooks filter by status", () => {
    const userId = makeUser();
    const webhooks = new WebhookModel(handle.db);
    webhooks.create({
      name: "hook",
      url: "https://example.com/hook",
      secret: "s",
      userId,
      status: "active",
    });
    webhooks.create({
      name: "off",
      url: "https://example.com/off",
      secret: "s",
      userId,
      status: "paused",
    });

    expect(webhooks.findByUserId(userId).length).toBe(2);
    expect(webhooks.findActiveByUserId(userId).length).toBe(1);
  });

  test("findMembership returns null when the user is not a member", () => {
    const userId = makeUser();
    expect(findMembership(handle.db, userId, "ws_missing")).toBeNull();
    expect(findMembership(handle.db, userId, "")).toBeNull();
  });
});
