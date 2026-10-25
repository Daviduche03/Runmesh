/**
 * Background workers: two queue consumers plus the scheduler sweep.
 *
 * Handlers are injected at the composition root (`main.ts`) so this module never imports a
 * feature module — the same reason the sweep steps are a list rather than hardcoded calls.
 */
import type { AppContext } from "../http/context.js";
import { log } from "../log.js";
import { sleep } from "../types/helpers.js";
import type { Queue } from "./queue.js";

export const TASK_QUEUE_NAME = "runmesh-tasks";
export const WEBHOOK_QUEUE_NAME = "runmesh-webhooks";

export interface RunnerHandlers {
  onTask?: (payload: Record<string, unknown>) => Promise<void>;
  onWebhook?: (payload: Record<string, unknown>) => Promise<void>;
  sweepSteps?: Array<{ name: string; run: () => Promise<number | void> }>;
}

export interface RunnerOptions {
  pollIntervalMs?: number;
  sweepIntervalMs?: number;
}

export interface Runner {
  stop: () => Promise<void>;
}

interface WorkerState {
  running: boolean;
}

async function drainQueue(
  queue: Queue,
  handler: ((payload: Record<string, unknown>) => Promise<void>) | undefined,
  pollIntervalMs: number,
  state: WorkerState,
): Promise<void> {
  if (!handler) return;

  while (state.running) {
    let worked = false;
    try {
      for (const item of queue.receive(10)) {
        worked = true;
        try {
          await handler(JSON.parse(item.body) as Record<string, unknown>);
        } catch (err) {
          log("error", "queue_message_failed", {
            queue: queue.name,
            attempts: item.attempts,
            error: err instanceof Error ? err.message : String(err),
          });
          if (!queue.retry(item.body, item.attempts)) {
            log("error", "queue_message_exhausted", { queue: queue.name });
          }
        }
      }
    } catch (err) {
      log("error", "queue_worker_error", {
        queue: queue.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (!worked) await sleep(pollIntervalMs);
  }
}

async function sweep(
  handlers: RunnerHandlers,
): Promise<void> {
  for (const step of handlers.sweepSteps ?? []) {
    try {
      const count = await step.run();
      if (count) log("info", "sweep_step", { step: step.name, count });
    } catch (err) {
      log("error", "sweep_step_failed", {
        step: step.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function schedulerLoop(
  handlers: RunnerHandlers,
  intervalMs: number,
  state: WorkerState,
): Promise<void> {
  while (state.running) {
    try {
      await sweep(handlers);
    } catch (err) {
      log("error", "sweep_failed", { error: err instanceof Error ? err.message : String(err) });
    }
    await sleep(intervalMs);
  }
}

export function startRunner(
  ctx: AppContext,
  handlers: RunnerHandlers = {},
  options: RunnerOptions = {},
): Runner {
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const sweepIntervalMs = options.sweepIntervalMs ?? 5000;
  const state: WorkerState = { running: true };

  const workers = [
    drainQueue(ctx.taskQueue, handlers.onTask, pollIntervalMs, state),
    drainQueue(ctx.webhookQueue, handlers.onWebhook, pollIntervalMs, state),
    schedulerLoop(handlers, sweepIntervalMs, state),
  ];

  return {
    stop: async () => {
      state.running = false;
      await Promise.allSettled(workers);
    },
  };
}
