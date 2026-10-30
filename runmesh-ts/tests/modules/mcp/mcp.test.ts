import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { generateApiKey, hashApiKey } from "../../../src/core/auth/api-key.js";
import { ApiKeyModel } from "../../../src/core/db/orm.js";
import { agentRuns, tools } from "../../../src/core/db/schema.js";
import { ensurePersonalWorkspace } from "../../../src/modules/workspace/index.js";
import { createTestUser, startTestApp } from "../../helpers/test-app.js";
import type { TestApp, TestUser } from "../../helpers/test-app.js";

let app: TestApp;

beforeEach(async () => {
  app = await startTestApp("mcp");
});

afterEach(async () => {
  await app.close();
});

interface Fixture {
  user: TestUser;
  workspaceId: string;
  readKey: string;
  writeKey: string;
}

async function setup(email = "mcp@example.com"): Promise<Fixture> {
  const user = await createTestUser(app, email);
  const workspaceId = ensurePersonalWorkspace(app.handle.db, user.id);
  const keys = new ApiKeyModel(app.handle.db);
  const readKey = generateApiKey();
  keys.create({
    keyHash: hashApiKey(readKey),
    name: "mcp-read",
    userId: user.id,
    permissions: JSON.stringify(["read"]),
    isActive: 1,
    workspaceId,
  });
  const writeKey = generateApiKey();
  keys.create({
    keyHash: hashApiKey(writeKey),
    name: "mcp-write",
    userId: user.id,
    permissions: JSON.stringify(["read", "write"]),
    isActive: 1,
    workspaceId,
  });
  return { user, workspaceId, readKey, writeKey };
}

function rpc(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${app.base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function keyHeaders(apiKey: string): Record<string, string> {
  return { "X-API-Key": apiKey };
}

function bearerHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

function rpcJson(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  body: {
    result?: {
      protocolVersion?: string;
      serverInfo?: { name: string };
      capabilities?: { tools: unknown };
      tools?: Array<{ name: string }>;
    };
    error?: { code: number; message: string };
  };
}> {
  return rpc(body, headers).then(async (response) => ({
    status: response.status,
    body: (await response.json()) as {
      result?: {
        protocolVersion?: string;
        serverInfo?: { name: string };
        capabilities?: { tools: unknown };
        tools?: Array<{ name: string }>;
      };
      error?: { code: number; message: string };
    },
  }));
}

async function seedManagedTool(workspaceId: string): Promise<void> {
  const now = new Date().toISOString();
  app.handle.db.insert(tools).values({
    id: "tool_mcp_echo",
    workspaceId,
    name: "echo",
    kind: "managed",
    provider: "test-provider",
    action: "test.echo",
    method: "POST",
    url: "http://127.0.0.1:9/echo",
    authScheme: "none",
    createdAt: now,
    updatedAt: now,
  }).run();
}

describe("mcp server", () => {
  test("rejects an unauthenticated request with 401", async () => {
    const response = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(response.status).toBe(401);
  });

  test("completes the initialize handshake", async () => {
    const fixture = await setup();
    const { status, body } = await rpcJson(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", clientInfo: { name: "codex" } },
      },
      keyHeaders(fixture.readKey),
    );
    expect(status).toBe(200);
    expect(body.result?.protocolVersion).toBe("2025-06-18");
    expect(body.result?.serverInfo?.name).toBe("runmesh");
    expect(body.result?.capabilities?.tools).toBeDefined();
  });

  test("negotiates down an unknown protocol version", async () => {
    const fixture = await setup();
    const { body } = await rpcJson(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } },
      keyHeaders(fixture.readKey),
    );
    expect(body.result?.protocolVersion).toBe("2025-11-25");
  });

  test("lists the two verbs", async () => {
    const fixture = await setup();
    const { body } = await rpcJson(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      keyHeaders(fixture.readKey),
    );
    const names = (body.result?.tools ?? []).map((tool: { name: string }) => tool.name);
    expect(names).toEqual(["runmesh_list_tools", "runmesh_call_tool"]);
  });

  test("answers a notification with 202 and no body", async () => {
    const fixture = await setup();
    const response = await rpc(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      keyHeaders(fixture.readKey),
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  test("reports an unknown method as -32601", async () => {
    const fixture = await setup();
    const { body } = await rpcJson(
      { jsonrpc: "2.0", id: 3, method: "completion/complete", params: {} },
      keyHeaders(fixture.readKey),
    );
    expect(body.error?.code).toBe(-32601);
  });

  test("reports an unknown tool as -32602", async () => {
    const fixture = await setup();
    const { body } = await rpcJson(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "frobnicate", arguments: {} },
      },
      keyHeaders(fixture.writeKey),
    );
    expect(body.error?.code).toBe(-32602);
  });

  test("requires write permission to call a tool", async () => {
    const fixture = await setup();
    await seedManagedTool(fixture.workspaceId);
    const response = await rpc(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "runmesh_call_tool", arguments: { tool_ref: "tool_mcp_echo" } },
      },
      keyHeaders(fixture.readKey),
    );
    expect(response.status).toBe(403);
  });

  test("maps a blocked call onto isError with the run attached", async () => {
    const fixture = await setup();
    await seedManagedTool(fixture.workspaceId);

    const call = {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "runmesh_call_tool",
        arguments: { tool_ref: "tool_mcp_echo", args: {}, session_id: "codex-1" },
      },
    };
    const first = (await (await rpc(call, keyHeaders(fixture.writeKey))).json()) as {
      result: { isError: boolean; content: Array<{ text: string }>; _meta: { run_id: string } };
    };
    expect(first.result.isError).toBe(true);
    expect(first.result.content[0]?.text).toContain("Connect");
    expect(first.result._meta.run_id).toStartWith("run_");

    const second = (await (await rpc({ ...call, id: 7 }, keyHeaders(fixture.writeKey))).json()) as {
      result: { _meta: { run_id: string } };
    };
    expect(second.result._meta.run_id).toBe(first.result._meta.run_id);

    const runs = app.handle.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, first.result._meta.run_id))
      .all();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.threadId).toStartWith("th_hook_");
  });

  test("accepts a Runmesh key as a bearer token", async () => {
    const fixture = await setup();
    const response = await rpc(
      { jsonrpc: "2.0", id: 8, method: "tools/list", params: {} },
      bearerHeaders(fixture.readKey),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { tools: unknown[] } };
    expect(body.result.tools).toHaveLength(2);
  });

  test("rejects a batch containing a call without write permission", async () => {
    const fixture = await setup();
    const response = await rpc(
      [
        { jsonrpc: "2.0", id: 1, method: "ping" },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "runmesh_call_tool", arguments: { tool_ref: "x" } },
        },
      ],
      keyHeaders(fixture.readKey),
    );
    expect(response.status).toBe(403);
  });
});
