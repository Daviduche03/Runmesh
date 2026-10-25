/**
 * End-to-end smoke test for a live Runmesh instance (SQLite + DB-backed queue).
 *
 *     bun scripts/smoke.ts http://localhost:8787 <jwt-secret> [path/to/runmesh.db]
 *
 * The server must already be running with its queue workers (`bun src/main.ts`).
 * Proves the scheduler sweep: a task created via /api/v1/tasks/schedule must sit in
 * `queued` until its due time and only then be dispatched.
 */
import { Database } from "bun:sqlite";

const BASE = process.argv[2] ?? "http://localhost:8791";
const SECRET = process.argv[3] ?? "your-long-random-secret";
const DB = process.argv[4] ?? process.env.DB_PATH ?? "runmesh.db";
const TARGET = "https://jsonplaceholder.typicode.com/posts";
const USER_ID = "06cc37a3-f33c-4610-9f52-d0f701be7144";

// The token signer reads the secret from the environment at import time.
process.env.JWT_SECRET = SECRET;
const { signToken } = await import("../src/core/auth/tokens.js");

// Every real login path requires a `users` row; seed the one OAuth would make.
{
  const sqlite = new Database(DB);
  sqlite.exec("PRAGMA foreign_keys=ON");
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  sqlite
    .query(
      "INSERT OR IGNORE INTO users (id, name, email, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(USER_ID, "Smoke Tester", "test@test.com", "github_oauth:no_password", now, now);
  sqlite.close();
}

const TOKEN = await signToken({ id: USER_ID, email: "test@test.com" }, 3600);

const results: Array<[string, boolean]> = [];

function check(label: string, ok: boolean, detail: unknown = ""): void {
  results.push([label, ok]);
  console.log(`${ok ? "PASS  " : "FAIL  "}${label}${detail ? `  -> ${detail}` : ""}`);
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  auth = true,
  timeoutMs = 20_000,
): Promise<{ status: number; payload: any }> {
  const headers: Record<string, string> = {};
  if (auth) headers.Authorization = `Bearer ${TOKEN}`;
  let data: string | undefined;
  if (body !== undefined) {
    data = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(BASE + path, {
    method,
    headers,
    body: data,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = (await response.text()) || "{}";
  try {
    return { status: response.status, payload: JSON.parse(raw) };
  } catch {
    return { status: response.status, payload: {} };
  }
}

function findById(node: unknown, target: string): any {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findById(item, target);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (record.id === target || record.task_id === target) return record;
    for (const value of Object.values(record)) {
      const found = findById(value, target);
      if (found) return found;
    }
  }
  return null;
}

async function taskStatus(taskId: string): Promise<string> {
  const { payload } = await call("GET", "/api/v1/tasks?limit=200");
  return String(findById(payload, taskId)?.status ?? "");
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// --- health (unauthenticated) -------------------------------------------------
{
  const { status, payload } = await call("GET", "/health", undefined, false);
  check("health endpoint returns 200", status === 200, `${status} ${JSON.stringify(payload)}`);
}

// --- agent lifecycle ----------------------------------------------------------
{
  const { status, payload } = await call("GET", "/api/v1/agents");
  check("GET /api/v1/agents with JWT", status === 200, status);
  const before: unknown[] = Array.isArray(payload)
    ? payload
    : (payload?.data ?? payload?.agents ?? []);
  const beforeList = Array.isArray(before) ? before : [];

  const created = await call("POST", "/api/v1/agents", { name: "smoke-vps-agent" });
  const agent = created.payload?.data ?? {};
  const agentId = agent?.id;
  check("create agent", [200, 201].includes(created.status) && Boolean(agentId), `${created.status} ${agentId}`);

  if (agentId) {
    const listed = await call("GET", "/api/v1/agents");
    const items = listed.payload?.data ?? listed.payload?.agents ?? [];
    const ids = (Array.isArray(items) ? items : []).map((a: any) => a?.id);
    check("agent appears in list", ids.includes(agentId), `before=${beforeList.length} after=${ids.length}`);

    const archived = await call("DELETE", `/api/v1/agents/${agentId}`);
    check("DELETE archives agent", archived.status === 200, archived.status);

    const relisted = await call("GET", "/api/v1/agents");
    const reitems = relisted.payload?.data ?? [];
    const reids = (Array.isArray(reitems) ? reitems : []).map((a: any) => a?.id);
    check("archived agent hidden from list", !reids.includes(agentId), `${reids.length} agents`);

    const again = await call("DELETE", `/api/v1/agents/${agentId}`);
    check("DELETE is idempotent", again.status === 200, again.status);

    const unknown = await call("DELETE", "/api/v1/agents/does-not-exist");
    check("DELETE unknown agent is 404", unknown.status === 404, unknown.status);
  }
}

// --- queue execution (immediate) ---------------------------------------------
let queueTaskId = "";
{
  const { status, payload } = await call("POST", "/api/v1/tasks", {
    url: TARGET,
    payload: { smoke: "queue" },
  });
  const task = payload?.data ?? {};
  queueTaskId = task?.id ?? task?.task_id ?? "";
  check("enqueue immediate task", [200, 201].includes(status) && Boolean(queueTaskId), `${status} ${queueTaskId}`);
}

// --- scheduled task: only the sweep may dispatch it --------------------------
let schedTaskId = "";
{
  const dueAt = Date.now() + 12_000;
  const dueIn = new Date(dueAt).toISOString();
  const { status, payload } = await call("POST", "/api/v1/tasks/schedule", {
    url: TARGET,
    payload: { smoke: "scheduled" },
    scheduled_at: dueIn,
  });
  const sched = payload?.data ?? {};
  schedTaskId = sched?.task_id ?? sched?.id ?? "";
  check("schedule task due in 12s", [200, 201].includes(status) && Boolean(schedTaskId), `${status} ${schedTaskId}`);

  await sleep(2000);
  const early = schedTaskId ? (await taskStatus(schedTaskId)).toLowerCase() : null;
  if (Date.now() < dueAt - 3000) {
    check(
      "scheduled task still queued before due time (not dispatched at creation)",
      early === "queued" || early === "",
      early,
    );
  } else {
    console.log("SKIP  early check (ran past the due time)");
  }
}

// The immediate task should run on its own.
{
  let queueFinal = "";
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    queueFinal = queueTaskId ? (await taskStatus(queueTaskId)).toLowerCase() : "";
    if (queueFinal === "completed" || queueFinal === "failed") break;
    await sleep(1000);
  }
  check("queue task executed", queueFinal === "completed", queueFinal);
}

{
  let final = "";
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    final = schedTaskId ? (await taskStatus(schedTaskId)).toLowerCase() : "";
    if (final === "completed" || final === "failed") break;
    await sleep(2000);
  }
  check("SCHEDULED task dispatched by the sweep after due time", final === "completed", final);
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log(`FAILED: ${failed.map(([label]) => label).join(", ")}`);
}
process.exit(failed.length > 0 ? 1 : 0);
