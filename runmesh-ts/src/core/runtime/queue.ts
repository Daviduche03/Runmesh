/**
 * DB-backed queue. Delays are stored as `available_at` instead of a broker's visibility
 * timeout; claiming a message is a DELETE that wins the row.
 */
import { and, asc, eq, lte } from "drizzle-orm";
import { changedRows } from "../db/client.js";
import type { Db } from "../db/client.js";
import { queueMessages } from "../db/schema.js";

export interface ReceivedMessage {
  body: string;
  attempts: number;
}

const newId = (): string => `qm_${crypto.randomUUID().replace(/-/g, "")}`;

export class Queue {
  constructor(
    private readonly db: Db,
    readonly name: string,
    private readonly maxAttempts = 4,
  ) {}

  send(message: unknown, delaySeconds = 0): void {
    const nowMs = Date.now();
    this.db
      .insert(queueMessages)
      .values({
        id: newId(),
        queue: this.name,
        body: typeof message === "string" ? message : JSON.stringify(message),
        availableAt: new Date(nowMs + Math.max(delaySeconds, 0) * 1000).toISOString(),
        attempts: 0,
        createdAt: new Date(nowMs).toISOString(),
      })
      .run();
  }

  receive(limit = 20): ReceivedMessage[] {
    const nowIso = new Date().toISOString();
    const rows = this.db
      .select({ id: queueMessages.id, body: queueMessages.body, attempts: queueMessages.attempts })
      .from(queueMessages)
      .where(and(eq(queueMessages.queue, this.name), lte(queueMessages.availableAt, nowIso)))
      .orderBy(asc(queueMessages.availableAt))
      .limit(limit)
      .all();

    const claimed: ReceivedMessage[] = [];
    for (const row of rows) {
      // Two workers may select the same row; only the DELETE that still sees a due row wins.
      const deleted = this.db
        .delete(queueMessages)
        .where(and(eq(queueMessages.id, row.id), lte(queueMessages.availableAt, nowIso)))
        .run();
      if (changedRows(deleted) === 1) {
        claimed.push({ body: row.body, attempts: Number(row.attempts ?? 0) });
      }
    }
    return claimed;
  }

  /** Requeue a failed message with backoff. Returns false once attempts are exhausted. */
  retry(body: string, attempts: number): boolean {
    if (attempts >= this.maxAttempts) return false;
    const delaySeconds = Math.min(5 * 2 ** attempts, 300);
    const nowMs = Date.now();
    this.db
      .insert(queueMessages)
      .values({
        id: newId(),
        queue: this.name,
        body,
        availableAt: new Date(nowMs + delaySeconds * 1000).toISOString(),
        attempts: attempts + 1,
        createdAt: new Date(nowMs).toISOString(),
      })
      .run();
    return true;
  }

  size(): number {
    const rows = this.db
      .select({ id: queueMessages.id })
      .from(queueMessages)
      .where(eq(queueMessages.queue, this.name))
      .all();
    return rows.length;
  }
}
