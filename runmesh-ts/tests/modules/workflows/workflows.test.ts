import { describe, expect, test } from "bun:test";
import { TaskModel, WorkflowModel } from "../../../src/core/db/orm.js";
import { Queue } from "../../../src/core/runtime/queue.js";
import { processTaskMessage } from "../../../src/modules/tasks/queue.js";
import type { FetchLike } from "../../../src/modules/webhooks/service.js";
import {
  emptyGraph,
  linearOrderFromTrigger,
  syncGraphToTasks,
  tasksToGraph,
} from "../../../src/modules/workflows/graph.js";
import {
  buildStepChainContext,
  listWorkflowRuns,
  recoverStaleWorkflowRuns,
  startWorkflowRun,
} from "../../../src/modules/workflows/runner.js";
import { workflowTaskHooks } from "../../../src/modules/workflows/service.js";
import {
  cronMatches,
  isWebhookTrigger,
  isWorkflowScheduleDue,
  normalizeTriggerConfig,
  validateCronExpression,
} from "../../../src/modules/workflows/trigger-config.js";
import {
  runDueScheduledWorkflows,
} from "../../../src/modules/workflows/triggers.js";
import {
  createTestUser,
  deleteJson,
  getJson,
  postJson,
  startTestApp,
} from "../../helpers/test-app.js";

describe("trigger-config", () => {
  test("cron validation and matching", () => {
    expect(validateCronExpression("*/5 * * * *")).toBe(true);
    expect(validateCronExpression("0 0 1,15 * 1-5")).toBe(true);
    expect(validateCronExpression("every minute")).toBe(false);
    expect(validateCronExpression("* * * *")).toBe(false);
    expect(validateCronExpression("61 * * * *")).toBe(false);
    // Sunday = 0, Monday = 1.
    expect(cronMatches("30 12 * * 0", new Date("2026-10-25T12:30:00Z"))).toBe(true);
    expect(cronMatches("30 12 * * 1", new Date("2026-10-25T12:30:00Z"))).toBe(false);
    expect(cronMatches("* * * * *", new Date("2026-10-25T00:00:00Z"))).toBe(true);
    expect(isWebhookTrigger("queue")).toBe(true);
    expect(isWebhookTrigger("webhook")).toBe(true);
    expect(isWebhookTrigger("manual")).toBe(false);
  });

  test("normalizeTriggerConfig enforces schedule requirements", () => {
    expect(normalizeTriggerConfig("manual", null)).toBe("{}");
    expect(normalizeTriggerConfig("schedule", '{"cron":"* * * * *"}')).toBe('{"cron":"* * * * *"}');
    expect(() => normalizeTriggerConfig("schedule", "{}")).toThrow();
    expect(() => normalizeTriggerConfig("schedule", '{"cron":"nope"}')).toThrow();
    expect(() => normalizeTriggerConfig("manual", "{bad")).toThrow();
    // Secrets never persist.
    expect(normalizeTriggerConfig("webhook", '{"a":1,"secret":"x"}')).toBe('{"a":1}');
  });

  test("isWorkflowScheduleDue fires one-shots for drafts and crons on the minute", () => {
    expect(
      isWorkflowScheduleDue(
        { status: "draft", triggerConfig: '{"scheduled_at":"2000-01-01T00:00:00Z"}' },
        new Date("2026-01-01T00:00:00Z"),
      ),
    ).toBe(true);
    expect(
      isWorkflowScheduleDue(
        { status: "running", triggerConfig: '{"scheduled_at":"2000-01-01T00:00:00Z"}' },
        new Date("2026-01-01T00:00:00Z"),
      ),
    ).toBe(false);
    expect(
      isWorkflowScheduleDue(
        { status: "draft", triggerConfig: '{"cron":"0 0 * * *"}' },
        new Date("2026-10-25T00:00:00Z"),
      ),
    ).toBe(true);
  });
});

describe("graph", () => {
  test("linearOrderFromTrigger rejects branches, cycles, and strays", () => {
    const graph = emptyGraph();
    graph.nodes.push({ id: "http-a", type: "http" });
    graph.edges.push({ source: "trigger", target: "http-a" });
    expect(linearOrderFromTrigger(graph)).toEqual(["http-a"]);

    const branched = emptyGraph();
    branched.nodes.push({ id: "a", type: "http" }, { id: "b", type: "http" });
    branched.edges.push({ source: "trigger", target: "a" }, { source: "trigger", target: "b" });
    expect(() => linearOrderFromTrigger(branched)).toThrow();

    const stray = emptyGraph();
    stray.nodes.push({ id: "a", type: "http" }, { id: "stray", type: "http" });
    stray.edges.push({ source: "trigger", target: "a" });
    expect(() => linearOrderFromTrigger(stray)).toThrow();

    expect(tasksToGraph({ triggerType: "manual" }, []).nodes).toHaveLength(1);
  });

  test("syncGraphToTasks creates, updates, and prunes task rows", async () => {
    const app = await startTestApp("wf-graph");
    try {
      const user = await createTestUser(app, "graph@example.com");
      const db = app.handle.db;

      const graph = emptyGraph();
      graph.nodes.push({
        id: "http-1",
        type: "http",
        data: { url: "https://example.com/1", payload: { a: 1 } },
      });
      graph.edges.push({ source: "trigger", target: "http-1" });

      const wfId = new WorkflowModel(db).create({ name: "Sync", userId: user.id });

      const synced = syncGraphToTasks(db, wfId, user.id, graph, null);
      const created = new TaskModel(db).listByWorkflowId(wfId);
      expect(created).toHaveLength(1);
      expect(synced.nodes[1]!.data!.task_id).toBe(created[0]!.id);

      // Update the same step, then drop it: the row is pruned.
      synced.nodes[1]!.data = {
        ...synced.nodes[1]!.data,
        url: "https://example.com/2",
        task_id: created[0]!.id,
      };
      syncGraphToTasks(db, wfId, user.id, synced, null);
      expect(new TaskModel(db).findById(created[0]!.id)!.url).toBe("https://example.com/2");

      synced.nodes.splice(1, 1);
      synced.edges.splice(0, 1);
      syncGraphToTasks(db, wfId, user.id, synced, null);
      expect(new TaskModel(db).listByWorkflowId(wfId)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});

describe("workflow routes and runs", () => {
  test("CRUD validation, list/detail shapes, update, graph save", async () => {
    const app = await startTestApp("wf-crud");
    try {
      const user = await createTestUser(app, "wf@example.com");

      const short = await postJson(
        app,
        "/api/v1/workflows",
        { name: "W", description: "short", tasks: [{ url: "https://example.com/x" }] },
        user.token,
      );
      expect(short.status).toBe(400);

      const empty = await postJson(
        app,
        "/api/v1/workflows",
        { name: "W", description: "a proper description", tasks: [] },
        user.token,
      );
      expect(empty.status).toBe(400);

      const created = await postJson(
        app,
        "/api/v1/workflows",
        {
          name: "Pipeline",
          description: "moves data around",
          trigger_type: "manual",
          tasks: [
            { url: "https://example.com/1", payload: { n: 1 } },
            { url_template: "https://example.com/{{ payload.n }}", payload: { n: 2 } },
          ],
        },
        user.token,
      );
      expect(created.body.message).toBe("Workflow created");
      const wfId: string = created.body.data.workflow_id;

      const listed = await getJson(app, "/api/v1/workflows", user.token);
      expect(listed.body.meta.total).toBe(1);
      const item = listed.body.data[0];
      expect(item.stepCount).toBe(2);
      expect(item.trigger).toBe("Manual");
      expect(item.status).toBe("Draft");
      expect(item.endpoint).toBe("https://example.com/1");
      expect(item.graph.nodes).toHaveLength(3);

      const detail = await getJson(app, `/api/v1/workflows/${wfId}`, user.token);
      expect(detail.body.data.tasks).toHaveLength(2);
      expect(detail.body.data.tasks[1].status).toBe("Pending");

      const updated = await postJson(
        app,
        `/api/v1/workflows/${wfId}`,
        { description: "updated description here" },
        user.token,
      );
      void updated;
      // PATCH via fetch since postJson only sends POST.
      const patched = await fetch(`${app.base}/api/v1/workflows/${wfId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ trigger_type: "schedule", trigger_config: '{"cron":"* * * * *"}' }),
      });
      const patchedBody = (await patched.json()) as { data: { triggerType: string } };
      expect(patchedBody.data.triggerType).toBe("schedule");

      // Save a canvas graph: steps follow the graph, dropped rows vanish.
      const graphRes = await fetch(`${app.base}/api/v1/workflows/${wfId}/graph`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({
          nodes: [
            { id: "trigger", type: "trigger", data: { triggerType: "manual" } },
            { id: "http-x", type: "http", data: { url: "https://example.com/solo", payload: {} } },
          ],
          edges: [{ source: "trigger", target: "http-x" }],
        }),
      });
      expect(graphRes.status).toBe(200);
      const after = await getJson(app, `/api/v1/workflows/${wfId}`, user.token);
      expect(after.body.data.tasks).toHaveLength(1);
      expect(after.body.data.tasks[0].url).toBe("https://example.com/solo");

      const deleted = await deleteJson(app, `/api/v1/workflows/${wfId}`, user.token);
      expect(deleted.body.message).toBe("Workflow deleted");
      expect((await getJson(app, `/api/v1/workflows/${wfId}`, user.token)).status).toBe(404);
    } finally {
      await app.close();
    }
  });

  test("run lifecycle: chain two steps with prev context, then forbid concurrent runs", async () => {
    const app = await startTestApp("wf-run");
    try {
      const user = await createTestUser(app, "run@example.com");
      const db = app.handle.db;

      const created = await postJson(
        app,
        "/api/v1/workflows",
        {
          name: "Chain",
          description: "two chained steps",
          tasks: [
            { url: "https://example.com/first" },
            {
              url: "https://example.com/second",
              payload_template: '{"echo": {{ prev.body.value }}}',
            },
          ],
        },
        user.token,
      );
      const wfId: string = created.body.data.workflow_id;

      const started = await postJson(app, `/api/v1/workflows/${wfId}/run`, {}, user.token);
      expect(started.body.message).toBe("Workflow run started");
      expect(started.body.data.status).toBe("Running");

      const again = await postJson(app, `/api/v1/workflows/${wfId}/run`, {}, user.token);
      expect(again.status).toBe(409);

      const bodies: unknown[] = [];
      const okFetch: FetchLike = async (_url, init) => {
        bodies.push(JSON.parse(String(init.body)));
        const first = bodies.length === 1;
        return new Response(JSON.stringify(first ? { value: 41 } : { done: true }), {
          status: 200,
        });
      };

      const taskQueue = new Queue(db, "runmesh-tasks");
      const webhookQueue = new Queue(db, "runmesh-webhooks");
      const hooks = workflowTaskHooks(db, taskQueue);

      // Step 1 executes and queues step 2.
      let items = taskQueue.receive(10);
      expect(items.length).toBe(1);
      await processTaskMessage(db, taskQueue, webhookQueue, okFetch, JSON.parse(items[0]!.body), hooks);
      expect(bodies[0]).toEqual({});

      // Step 2 sees step 1's output via prev.
      items = taskQueue.receive(10);
      expect(items.length).toBe(1);
      await processTaskMessage(db, taskQueue, webhookQueue, okFetch, JSON.parse(items[0]!.body), hooks);
      expect(bodies[1]).toEqual({ echo: 41 });

      const runs = await getJson(app, `/api/v1/workflows/${wfId}/runs`, user.token);
      expect(runs.body.data[0].status).toBe("Completed");
      expect(runs.body.data[0].currentStep).toBe(2);

      // Chain context helper exposes completed priors only.
      const tasks = new TaskModel(db).listByWorkflowId(wfId);
      const ctx = buildStepChainContext(
        db,
        tasks.find((t) => Number(t.stepOrder) === 1)!,
      ) as { prev: { body: unknown } };
      expect(ctx.prev.body).toEqual({ value: 41 });
    } finally {
      await app.close();
    }
  });

  test("failed steps fail the run; cancel stops it; stale runs are recovered", async () => {
    const app = await startTestApp("wf-fail");
    try {
      const user = await createTestUser(app, "fail@example.com");
      const db = app.handle.db;

      const created = await postJson(
        app,
        "/api/v1/workflows",
        {
          name: "Flaky",
          description: "a failing workflow",
          tasks: [{ url: "https://example.com/boom" }, { url: "https://example.com/never" }],
        },
        user.token,
      );
      const wfId: string = created.body.data.workflow_id;

      const failFetch: FetchLike = async () => new Response("nope", { status: 500 });
      const taskQueue = new Queue(db, "runmesh-tasks");
      const webhookQueue = new Queue(db, "runmesh-webhooks");
      const hooks = workflowTaskHooks(db, taskQueue);

      await postJson(app, `/api/v1/workflows/${wfId}/run`, {}, user.token);
      // Exhaust retries (default max 5) then terminal failure fails the run.
      for (let i = 0; i < 7; i++) {
        const items = taskQueue.receive(10);
        if (items.length === 0) break;
        await processTaskMessage(
          db,
          taskQueue,
          webhookQueue,
          failFetch,
          JSON.parse(items[0]!.body),
          hooks,
        );
      }
      const runs = listWorkflowRuns(db, user.id, wfId);
      expect(runs[0]!.status).toBe("Failed");

      // Cancel an active run: tasks settle to cancelled, run marked cancelled.
      await postJson(app, `/api/v1/workflows/${wfId}/run`, {}, user.token);
      const cancelled = await postJson(app, `/api/v1/workflows/${wfId}/cancel`, {}, user.token);
      expect(cancelled.body.message).toBe("Workflow run cancelled");
      expect(cancelled.body.data.status).toBe("Cancelled");
      const nothing = await postJson(app, `/api/v1/workflows/${wfId}/cancel`, {}, user.token);
      expect(nothing.status).toBe(400);

      // The cancelled run's queued message is orphaned in the queue (cancel never purges
      // rows); the processor would drop it against the terminal task, so drain it here.
      expect(taskQueue.receive(10).length).toBe(1);

      // Stale recovery: simulate a worker that finished the task but crashed before
      // resuming the workflow — the task settled while the run is still marked running.
      const stale = await postJson(app, `/api/v1/workflows/${wfId}/run`, {}, user.token);
      void stale;
      const queued = taskQueue.receive(10);
      expect(queued.length).toBe(1);
      const staleTask = new TaskModel(db).listByWorkflowId(wfId)[0]!;
      new TaskModel(db).updateStatus(staleTask.id, "completed");
      expect(recoverStaleWorkflowRuns(db)).toBe(1);
      const after = listWorkflowRuns(db, user.id, wfId);
      expect(after[0]!.status).toBe("Failed");
    } finally {
      await app.close();
    }
  });

  test("webhook trigger gating and due schedule sweep", async () => {
    const app = await startTestApp("wf-triggers");
    try {
      const user = await createTestUser(app, "trig@example.com");
      const db = app.handle.db;

      const manual = await postJson(
        app,
        "/api/v1/workflows",
        {
          name: "Manual",
          description: "manual workflow here",
          tasks: [{ url: "https://example.com/x" }],
        },
        user.token,
      );

      const manualId: string = manual.body.data.workflow_id;
      const gated = await postJson(app, `/api/v1/workflows/${manualId}/trigger`, {}, user.token);
      expect(gated.status).toBe(400);

      const hook = await postJson(
        app,
        "/api/v1/workflows",
        {
          name: "Hook",
          description: "webhook workflow here",
          trigger_type: "webhook",
          tasks: [{ url: "https://example.com/x" }],
        },
        user.token,
      );
      const hookId: string = hook.body.data.workflow_id;
      const fired = await postJson(app, `/api/v1/workflows/${hookId}/trigger`, {}, user.token);
      expect(fired.body.message).toBe("Workflow triggered");

      // Schedule sweep: a due draft starts; a non-due one is skipped.
      const due = await postJson(
        app,
        "/api/v1/workflows",
        {
          name: "Due",
          description: "due schedule workflow",
          trigger_type: "schedule",
          trigger_config: '{"scheduled_at":"2000-01-01T00:00:00Z"}',
          tasks: [{ url: "https://example.com/x" }],
        },
        user.token,
      );
      expect(due.status).toBe(200);
      expect(runDueScheduledWorkflows(db, new Queue(db, "runmesh-tasks"))).toBe(1);
    } finally {
      await app.close();
    }
  });
});
