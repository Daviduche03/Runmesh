/**
 * Drive the MCP server on a live instance end to end: handshake, discovery, and a real
 * policy path (a managed tool with no connection must come back as a refusal, not a call).
 *
 * Usage: bun scripts/hooks-replay.ts [baseUrl] [jwtSecret] [dbPath]
 */
import { Database } from "bun:sqlite";

const RUN = Date.now().toString(36);
const BASE = process.argv[2] ?? "http://localhost:8787";
const SECRET = process.argv[3] ?? "hooks-replay-secret-12345";
const DB = process.argv[4] ?? process.env.DB_PATH ?? "runmesh.db";

process.env.JWT_SECRET = SECRET;
const { signToken } = await import("../src/core/auth/tokens.js");

const USER_ID = `hooks-replay-${RUN}`;
{
  const sqlite = new Database(DB);
  const now = new Date().toISOString();
  sqlite
    .query("INSERT OR IGNORE INTO users (id, name, email, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(USER_ID, "Hooks Replay", `hooks-${RUN}@test.com`, "github_oauth:no_password", now, now);
  const ws = sqlite
    .query("SELECT id FROM workspaces WHERE owner_user_id = ?")
    .get(USER_ID) as { id: string } | null;
  if (ws) {
    sqlite
      .query(
        "INSERT OR IGNORE INTO tools (id, workspace_id, name, kind, provider, action, method, url, auth_scheme, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        `tool_replay_${RUN}`,
        ws.id,
        "replay-echo",
        "managed",
        "test-provider",
        "test.echo",
        "POST",
        "http://127.0.0.1:9/echo",
        "none",
        now,
        now,
      );
  }
  sqlite.close();
}
const TOOL_REF = `tool_replay_${RUN}`;
const TOKEN = await signToken({ id: USER_ID, email: `hooks-${RUN}@test.com` }, 3600);

async function rpc(body: unknown, token: string | null = TOKEN) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(40)}${detail}`);
}

// The personal workspace is created lazily on the first authenticated call.
await rpc({ jsonrpc: "2.0", id: 0, method: "ping" });

{
  const sqlite = new Database(DB);
  const ws = sqlite
    .query("SELECT id FROM workspaces WHERE owner_user_id = ?")
    .get(USER_ID) as { id: string } | null;
  if (ws) {
    const now = new Date().toISOString();
    sqlite
      .query(
        "INSERT OR IGNORE INTO tools (id, workspace_id, name, kind, provider, action, method, url, auth_scheme, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        TOOL_REF,
        ws.id,
        "replay-echo",
        "managed",
        "test-provider",
        "test.echo",
        "POST",
        "http://127.0.0.1:9/echo",
        "none",
        now,
        now,
      );
  }
  sqlite.close();
}

const init = await rpc({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", clientInfo: { name: "replay" } },
});
check(
  "initialize handshake",
  init.status === 200 && init.json?.result?.serverInfo?.name === "runmesh",
  init.json?.result?.protocolVersion ?? init.text.slice(0, 80),
);

const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
const names = (list.json?.result?.tools ?? []).map((tool: { name: string }) => tool.name);
check(
  "tool discovery",
  names.includes("runmesh_list_tools") && names.includes("runmesh_call_tool"),
  names.join(", "),
);

const blocked = await rpc({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: {
    name: "runmesh_call_tool",
    arguments: { tool_ref: TOOL_REF, args: {}, session_id: `replay-${RUN}` },
  },
});
check(
  "refusal maps onto isError, not a call",
  blocked.json?.result?.isError === true &&
    typeof blocked.json?.result?.content?.[0]?.text === "string" &&
    blocked.json.result.content[0].text.includes("Connect"),
  blocked.json?.result?.content?.[0]?.text?.slice(0, 80) ?? blocked.text.slice(0, 80),
);

const again = await rpc({
  jsonrpc: "2.0",
  id: 4,
  method: "tools/call",
  params: {
    name: "runmesh_call_tool",
    arguments: { tool_ref: TOOL_REF, args: {}, session_id: `replay-${RUN}` },
  },
});
check(
  "one session shares one run",
  again.json?.result?._meta?.run_id === blocked.json?.result?._meta?.run_id,
  String(again.json?.result?._meta?.run_id ?? "?"),
);

const unknownRef = await rpc({
  jsonrpc: "2.0",
  id: 5,
  method: "tools/call",
  params: { name: "runmesh_call_tool", arguments: { tool_ref: "tool_missing" } },
});
check(
  "unknown tool is a JSON-RPC error",
  unknownRef.json?.error?.code === -32602,
  String(unknownRef.json?.error?.code ?? "?"),
);

const anon = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/list", params: {} }, null);
check("unauthenticated is 401", anon.status === 401, `HTTP ${anon.status}`);

console.log(failures === 0 ? "\nmcp replay clean" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
