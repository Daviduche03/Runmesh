import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb } from "../../src/core/db/client.js";
import type { DbHandle } from "../../src/core/db/client.js";
import { applyMigrations } from "../../src/core/runtime/migrate.js";
import { Queue } from "../../src/core/runtime/queue.js";

const DB = "/tmp/opencode/test-queue.db";
let handle: DbHandle;

function removeDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(DB + suffix)) rmSync(DB + suffix);
  }
}

describe("Queue", () => {
  beforeEach(() => {
    removeDb();
    applyMigrations(DB);
    handle = createDb(DB);
  });

  afterEach(() => {
    handle.close();
    removeDb();
  });

  test("send then receive claims the message exactly once", () => {
    const queue = new Queue(handle.db, "q-test");
    queue.send({ hello: "world" });

    const first = queue.receive();
    expect(first.length).toBe(1);
    expect(JSON.parse(first[0].body)).toEqual({ hello: "world" });
    expect(first[0].attempts).toBe(0);

    expect(queue.receive().length).toBe(0);
  });

  test("a delayed message is not visible until it falls due", () => {
    const queue = new Queue(handle.db, "q-test");
    queue.send({ later: true }, 60);
    expect(queue.receive().length).toBe(0);
  });

  test("queue names are isolated", () => {
    const a = new Queue(handle.db, "q-a");
    const b = new Queue(handle.db, "q-b");
    a.send({ n: 1 });
    expect(b.receive().length).toBe(0);
    expect(a.receive().length).toBe(1);
  });

  test("retry requeues with backoff and increments attempts", () => {
    const queue = new Queue(handle.db, "q-test");
    queue.send({ n: 1 });
    const [msg] = queue.receive();

    expect(queue.retry(msg.body, msg.attempts)).toBe(true);
    // backoff puts it in the future, so it is not immediately claimable
    expect(queue.receive().length).toBe(0);

    const rows = handle.db.all(sql`SELECT attempts FROM queue_messages`) as Array<{
      attempts: number;
    }>;
    expect(rows[0].attempts).toBe(1);
  });

  test("retry gives up once max attempts are exhausted", () => {
    const queue = new Queue(handle.db, "q-test", 2);
    expect(queue.retry("{}", 1)).toBe(true);
    expect(queue.retry("{}", 2)).toBe(false);
  });

  test("size counts queued messages", () => {
    const queue = new Queue(handle.db, "q-test");
    queue.send({ n: 1 });
    queue.send({ n: 2 });
    expect(queue.size()).toBe(2);
  });
});
