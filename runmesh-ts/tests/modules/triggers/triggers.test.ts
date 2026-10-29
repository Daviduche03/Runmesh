import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runDueScheduleTriggers } from "../../../src/modules/triggers/service.js";
import {
  createTestUser,
  getJson,
  postJson,
  startTestApp,
  type TestApp,
  type TestUser,
} from "../../helpers/test-app.js";

const okFetch = async () => new Response("ack", { status: 200 });

async function patchJson(app: TestApp, path: string, body: unknown, token?: string) {
  const response = await fetch(`${app.base}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

let app: TestApp;
let user: TestUser;
let agentId: string;

beforeAll(async () => {
  app = await startTestApp("triggers-sweep");
  user = await createTestUser(app, "triggers-sweep@example.com");
  const created = await postJson(app, "/api/v1/agents", { name: "sweep-agent" }, user.token);
  expect(created.status).toBe(200);
  agentId = created.body.data.id;
});

afterAll(async () => {
  await app.close();
});

describe("runDueScheduleTriggers", () => {
  test("fires a matching every-minute schedule trigger via the sweep", async () => {
    const created = await postJson(
      app,
      "/api/v1/triggers",
      {
        agent_id: agentId,
        type: "schedule",
        name: "every minute",
        config: { cron: "* * * * *" },
        endpoint: "http://127.0.0.1:9/cb",
        endpoint_secret: "s",
      },
      user.token,
    );
    expect(created.status).toBe(200);

    const fired = await runDueScheduleTriggers(app.handle.db, okFetch);
    expect(fired).toBe(1);

    const runs = await getJson(app, `/api/v1/triggers/${created.body.data.id}/runs`, user.token);
    expect(runs.status).toBe(200);
    expect(runs.body.meta.total).toBe(1);
  });

  test("skips disabled and non-matching triggers", async () => {
    const disabled = await postJson(
      app,
      "/api/v1/triggers",
      {
        agent_id: agentId,
        type: "schedule",
        name: "disabled trig",
        config: { cron: "* * * * *" },
        endpoint: "http://127.0.0.1:9/cb",
        endpoint_secret: "s",
      },
      user.token,
    );
    expect(disabled.status).toBe(200);
    const off = await patchJson(app, `/api/v1/triggers/${disabled.body.data.id}`, { enabled: false }, user.token);
    expect(off.status).toBe(200);

    // February 30th never occurs, so this cron can never match.
    const impossible = await postJson(
      app,
      "/api/v1/triggers",
      {
        agent_id: agentId,
        type: "schedule",
        name: "never trig",
        config: { cron: "* * 30 2 *" },
        endpoint: "http://127.0.0.1:9/cb",
        endpoint_secret: "s",
      },
      user.token,
    );
    expect(impossible.status).toBe(200);

    const beforeDisabled = await getJson(app, `/api/v1/triggers/${disabled.body.data.id}/runs`, user.token);
    const beforeImpossible = await getJson(app, `/api/v1/triggers/${impossible.body.data.id}/runs`, user.token);

    await runDueScheduleTriggers(app.handle.db, okFetch);

    const afterDisabled = await getJson(app, `/api/v1/triggers/${disabled.body.data.id}/runs`, user.token);
    const afterImpossible = await getJson(app, `/api/v1/triggers/${impossible.body.data.id}/runs`, user.token);
    expect(afterDisabled.body.meta.total).toBe(beforeDisabled.body.meta.total);
    expect(afterImpossible.body.meta.total).toBe(beforeImpossible.body.meta.total);
  });
});
