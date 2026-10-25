import { config } from "./core/config.js";
import { createDb } from "./core/db/client.js";
import type { AppContext } from "./core/http/context.js";
import { log } from "./core/log.js";
import { applyMigrations } from "./core/runtime/migrate.js";
import { Queue } from "./core/runtime/queue.js";
import {
  TASK_QUEUE_NAME,
  WEBHOOK_QUEUE_NAME,
  startRunner,
} from "./core/runtime/runner.js";
import { createApp } from "./app.js";
import { processWebhookQueueMessage } from "./modules/webhooks/index.js";
import { enqueueDueTasks, processTaskMessage } from "./modules/tasks/index.js";

applyMigrations(config.dbPath);

const handle = createDb(config.dbPath);

const ctx: AppContext = {
  db: handle.db,
  taskQueue: new Queue(handle.db, TASK_QUEUE_NAME),
  webhookQueue: new Queue(handle.db, WEBHOOK_QUEUE_NAME),
};

const app = createApp(ctx);

const runner = startRunner(
  ctx,
  {
    onTask: (payload) =>
      processTaskMessage(ctx.db, ctx.taskQueue, ctx.webhookQueue, fetch, payload),
    onWebhook: (payload) =>
      processWebhookQueueMessage(ctx.db, ctx.webhookQueue, fetch, payload),
    sweepSteps: [
      {
        name: "enqueue_due_tasks",
        run: async () => enqueueDueTasks(ctx.db, ctx.taskQueue),
      },
    ],
  },
  {
    pollIntervalMs: config.queuePollIntervalSeconds * 1000,
    sweepIntervalMs: config.sweepIntervalSeconds * 1000,
  },
);

const server = app.listen(config.port, config.host, () => {
  log("info", "server_listening", {
    host: config.host,
    port: config.port,
    db: config.dbPath,
  });
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "shutdown_started", { signal });
  server.close();
  await runner.stop();
  handle.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
