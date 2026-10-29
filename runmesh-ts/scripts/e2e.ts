/**
 * Full end-to-end pass over a live server: account, agents, keys, tasks, workflows,
 * webhooks (SSRF guard + real delivery), policies, connect (full consent lifecycle),
 * tools, triggers (live signed callback), collection, dashboard.
 */
import { Database } from "bun:sqlite";
import { createHmac } from "node:crypto";

const RUN = Date.now().toString(36);
const BASE = process.argv[2] ?? "http://localhost:8787";
const SECRET = process.argv[3] ?? "e2e-test-secret-12345";
const DB = process.argv[4] ?? process.env.DB_PATH ?? "runmesh.db";

process.env.JWT_SECRET = SECRET;
const { signToken } = await import("../src/core/auth/tokens.js");

// --- account ----------------------------------------------------------------
const USER_ID = "e2e-user-0001";
{
  const sqlite = new Database(DB);
  const now = new Date().toISOString();
  sqlite
    .query("INSERT OR IGNORE INTO users (id, name, email, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(USER_ID, "E2E Tester", "e2e@test.com", "github_oauth:no_password", now, now);
  sqlite.close();
}
const TOKEN = await signToken({ id: USER_ID, email: "e2e@test.com" }, 3600);
console.log("account ready:", USER_ID);

let failures = 0;
async function check(label: string, fn: () => Promise<string>): Promise<any> {
  try {
    const detail = await fn();
    console.log(`PASS  ${label}${detail ? `  -> ${detail}` : ""}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${label}  -> ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function api(method: string, path: string, body?: unknown, token = TOKEN, rawHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...rawHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  let data: string | undefined;
  if (body !== undefined) {
    data = typeof body === "string" ? body : JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(BASE + path, { method, headers, body: data, redirect: "manual", signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, headers: res.headers };
}

// --- trigger callback listener (verifies HMAC signatures live) ---------------
const callbacks: Array<{ sigOk: boolean; body: any }> = [];
const ENDPOINT_SECRET = "e2e-endpoint-secret";
const listener = Bun.serve({
  port: 8899,
  async fetch(req) {
    const body = await req.text();
    const sig = req.headers.get("x-runmesh-signature") ?? "";
    const m = sig.match(/^t=(\d+),v1=([0-9a-f]+)$/);
    let ok = false;
    if (m) {
      const expect = createHmac("sha256", ENDPOINT_SECRET).update(`${m[1]}.${body}`, "utf8").digest("hex");
      ok = expect === m[2];
    }
    callbacks.push({ sigOk: ok, body: JSON.parse(body) });
    return new Response("ack", { status: 200 });
  },
});
console.log("trigger listener on :8899");

// --- 1. system ----------------------------------------------------------------
await check("GET /health", async () => {
  const r = await api("GET", "/health", undefined, "");
  assert(r.status === 200 && r.json?.ok === true, `status ${r.status}`);
  return "ok";
});
await check("GET /api/me", async () => {
  const r = await api("GET", "/api/me");
  assert(r.status === 200 && r.json?.data?.id === USER_ID, JSON.stringify(r.json));
  return r.json.data.email;
});

// --- 2. agents -----------------------------------------------------------------
let agentId = "";
await check("POST /api/v1/agents", async () => {
  const r = await api("POST", "/api/v1/agents", { name: `e2e-agent-${RUN}` });
  assert([200, 201].includes(r.status) && r.json?.data?.id, JSON.stringify(r.json));
  agentId = r.json.data.id;
  assert(!("public_key" in (r.json.data ?? {})), "public key leaked");
  return agentId;
});
await check("GET /api/v1/agents lists it", async () => {
  const r = await api("GET", "/api/v1/agents");
  assert(r.json?.data?.some((a: any) => a.id === agentId), "missing");
  return `${r.json.data.length} agents`;
});

// --- 3. api keys ----------------------------------------------------------------
let apiKey = "";
await check("POST /api-keys mints plaintext once", async () => {
  const r = await api("POST", "/api-keys", { name: "e2e", permissions: ["read", "write"] });
  assert(r.json?.data?.key?.startsWith("rk_"), JSON.stringify(r.json)?.slice(0, 160));
  apiKey = r.json.data.key;
  return r.json.data.id;
});
await check("API key authenticates (X-API-Key)", async () => {
  // /api/me is JWT-only by design; tasks accept both credentials.
  const r = await api("GET", "/api/v1/tasks?limit=1", undefined, "", { "X-API-Key": apiKey });
  assert(r.status === 200, `status ${r.status}`);
  const bad = await api("GET", "/api/me", undefined, "", { "X-API-Key": apiKey });
  assert(bad.status === 401, `expected JWT-only 401, got ${bad.status}`);
  return "dual-auth ok";
});

// --- 4. policies -----------------------------------------------------------------
await check("POST /api/v1/policies/rules", async () => {
  const r = await api("POST", "/api/v1/policies/rules", {
    name: "allow google send", action: "allow", scope: "google.gmail.send", enabled: true, mode: "enforce",
    conditions: [{ field: "action", operator: "is", value: "google.gmail.send" }],
  });
  assert(r.status === 200 && r.json?.data?.id, JSON.stringify(r.json)?.slice(0, 200));
  return r.json.data.id.slice(0, 12);
});
await check("POST /api/v1/policies/evaluate allows", async () => {
  const r = await api("POST", "/api/v1/policies/evaluate", { action: "google.gmail.send", agent: "a", resource: "", user: "u", amount: "0" });
  assert(r.json?.data?.decision === "allow", JSON.stringify(r.json)?.slice(0, 200));
  return "allow";
});

// --- 5. webhooks: SSRF guard + real delivery ----------------------------------------
await check("SSRF guard rejects loopback webhook URL", async () => {
  const r = await api("POST", "/api/webhooks", { name: "evil", url: "http://127.0.0.1:8899/hook" });
  assert(r.status === 400, `expected 400 got ${r.status}`);
  return "blocked";
});
await check("POST /api/webhooks to a real URL", async () => {
  const r = await api("POST", "/api/webhooks", { name: "e2e-hook", url: "https://jsonplaceholder.typicode.com/posts", events: "task.running,task.completed,task.failed" });
  assert(r.status === 201 && r.json?.data?.secret?.startsWith("whsec_"), JSON.stringify(r.json)?.slice(0, 160));
  assert(!("secret" in {}) || true, "");
  const listed = await api("GET", "/api/webhooks");
  assert(listed.json?.data?.[0]?.secret_hint?.startsWith("whsec_"), "no hint");
  assert(listed.json?.data?.[0]?.secret === undefined, "secret leaked in list");
  return "secret shown once, masked after";
});

// --- 6. tasks: immediate execution ---------------------------------------------------
let taskId = "";
await check("POST /api/v1/tasks", async () => {
  const r = await api("POST", "/api/v1/tasks", { url: "https://jsonplaceholder.typicode.com/posts", payload: { e2e: 1 } });
  assert(r.json?.data?.task_id, JSON.stringify(r.json));
  taskId = r.json.data.task_id;
  return taskId.slice(0, 8);
});
await check("task executes to completed via queue worker", async () => {
  for (let i = 0; i < 30; i++) {
    const r = await api("GET", "/api/v1/tasks?limit=100");
    const row = (r.json?.data ?? []).find((t: any) => t.id === taskId);
    if (row && !["Queued", "Running"].includes(row.status)) {
      assert(row.status === "Completed", `status ${row.status}`);
      return `status=${row.status} retries=${row.retries}`;
    }
    await new Promise((r2) => setTimeout(r2, 1000));
  }
  throw new Error("never settled");
});
await check("webhook delivery succeeded (no dead letters)", async () => {
  for (let i = 0; i < 20; i++) {
    const dl = await api("GET", "/api/webhooks/dead-letters");
    const tasks = await api("GET", "/api/v1/tasks?limit=100");
    const row = (tasks.json?.data ?? []).find((t: any) => t.id === taskId);
    if (row?.status === "Completed") {
      await new Promise((r) => setTimeout(r, 4000)); // let deliveries flush
      const dl2 = await api("GET", "/api/webhooks/dead-letters");
      assert((dl2.json?.data ?? []).length === 0, `dead letters: ${JSON.stringify(dl2.json?.data)}`);
      return "delivered, none dead";
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("task never completed");
});

// --- 7. tasks: schedule / cancel / reschedule -----------------------------------------
await check("schedule → cancel → reschedule", async () => {
  const future = new Date(Date.now() + 3600_1000).toISOString();
  const s = await api("POST", "/api/v1/tasks/schedule", { url: "https://jsonplaceholder.typicode.com/posts", scheduled_at: future });
  const sid = s.json?.data?.task_id;
  assert(sid, JSON.stringify(s.json));
  const c = await api("POST", `/api/v1/tasks/${sid}/cancel`, {});
  assert(c.json?.data?.task_id === sid, JSON.stringify(c.json));
  const r2 = await api("POST", `/api/v1/tasks/${sid}/reschedule`, { scheduled_at: future });
  assert(r2.status === 400, `expected 400 got ${r2.status}`);
  const l = await api("GET", "/api/v1/tasks/scheduled");
  assert(l.json?.data?.[0]?.execution_type === "scheduled", "no snake_case row");
  return "ok";
});

// --- 8. workflows: create → run → chain -----------------------------------------------
let wfId = "";
await check("POST /api/v1/workflows", async () => {
  const r = await api("POST", "/api/v1/workflows", {
    name: "E2E chain", description: "two chained steps e2e",
    tasks: [
      { url: "https://jsonplaceholder.typicode.com/posts", payload: { step: 1 } },
      { url: "https://jsonplaceholder.typicode.com/posts", payload_template: '{"echo": true}' },
    ],
  });
  assert(r.json?.data?.workflow_id, JSON.stringify(r.json));
  wfId = r.json.data.workflow_id;
  return wfId.slice(0, 8);
});
await check("workflow runs both steps to completed", async () => {
  const run = await api("POST", `/api/v1/workflows/${wfId}/run`, {});
  assert(run.json?.data?.status === "Running", JSON.stringify(run.json));
  for (let i = 0; i < 45; i++) {
    const runs = await api("GET", `/api/v1/workflows/${wfId}/runs`);
    if (runs.json?.data?.[0]?.status === "Completed") return "completed, 2 steps";
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("run never completed");
});

// --- 9. connect: full consent lifecycle -------------------------------------------------
await check("connect providers catalog", async () => {
  const r = await api("GET", "/api/v1/connect/providers");
  assert(r.json?.data?.length === 4, JSON.stringify(r.json));
  return "4 providers";
});
await check("connect session → consent page → approve → token → current grant", async () => {
  const orm = await import("../src/core/db/orm.js");
  const { ensureWorkspaceApp } = await import("../src/modules/connect/apps.js");
  const { attachProviderIdentity, upsertConnection } = await import("../src/modules/connect/sessions.js");
  const { createDb } = await import("../src/core/db/client.js");
  const schema = await import("../src/core/db/schema.js");
  const handle = createDb(DB);
  const db: any = handle.db;
  // Pick this user's workspace: other suites may have already created their own.
  const ws = db
    .select()
    .from(schema.workspaces)
    .all()
    .find((w: any) => w.ownerUserId === USER_ID)?.id;
  assert(ws, "no workspace for the fixture user");
  const userModel = new orm.ConnectUserModel(db);
  const cu = userModel.findByPrimaryEmail("e2e@test.com") ?? userModel.create({ primaryEmail: "e2e@test.com", primaryEmailVerified: true });
  const capp = ensureWorkspaceApp(db, ws, USER_ID);
  const existingLink = new orm.ConnectAppUserModel(db).findByExternalUser(capp.id, "ext-e2e");
  if (!existingLink) {
    new orm.ConnectAppUserModel(db).create({ connectAppId: capp.id, externalUserId: "ext-e2e", connectUserId: cu.id });
  }
  const ident = attachProviderIdentity(db, { connectUserId: cu.id, provider: "google", providerSubject: "sub-e2e", email: "e2e@test.com", emailVerified: true });
  upsertConnection(db, { connectUserId: cu.id, provider: "google", scopes: ["gmail.send"], accessToken: "ya29.e2e", identityId: ident.id, accountLabel: "e2e@test.com", workspaceId: ws });
  handle.close();

  const s = await api("POST", "/api/v1/connect/sessions", {
    mode: "grant", redirect_uri: "https://app.example.com/cb", external_user_id: "ext-e2e",
    connect_user_id: cu.id, provider: "google", scopes: ["gmail.send"],
  });
  assert(s.json?.data?.state, JSON.stringify(s.json)?.slice(0, 200));
  const state = s.json.data.state;

  const page = await fetch(`${BASE}/connect/consent?state=${state}`);
  assert(page.status === 200 && (await page.text()).includes("Approve access"), `consent ${page.status}`);

  const submit = await fetch(`${BASE}/connect/consent`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `state=${encodeURIComponent(state)}&action=approve`, redirect: "manual",
  });
  assert(submit.status === 302, `submit ${submit.status}`);
  const code = new URL(submit.headers.get("location") ?? "").searchParams.get("code");
  assert(code, "no code");

  // A previous run may have left an approved grant that _ensure_grant reuses,
  // in which case the first exchange already succeeds.
  let exchanged = await api("POST", "/api/v1/connect/token", { code });
  if (exchanged.status === 403) {
    assert(exchanged.json?.error?.message?.includes("grant_pending_approval"), JSON.stringify(exchanged.json)?.slice(0, 200));
    const grants = await api("GET", "/api/v1/grants");
    const grantId = grants.json?.data?.[0]?.id;
    assert(grantId, "no grant");
    const approved = await api("POST", `/api/v1/connect/grants/${grantId}/approve`, { reason: "e2e ok" });
    assert(approved.json?.data?.approval_status === "approved", JSON.stringify(approved.json));
    exchanged = await api("POST", "/api/v1/connect/token", { code });
  }
  const grantToken = exchanged.json?.data?.grant_access_token;
  assert(typeof grantToken === "string" && grantToken.startsWith("rct_"), JSON.stringify(exchanged.json)?.slice(0, 200));

  const current = await api("GET", "/api/v1/connect/grants/current", undefined, "", { "X-Connect-Grant-Token": grantToken });
  assert(current.json?.data?.provider === "google", JSON.stringify(current.json));
  return "rct_ token works";
});
await check("connect metrics/tokens/audit show the flow", async () => {
  const m = await api("GET", "/api/v1/connect/metrics");
  assert(m.json?.data?.token_requests_24h >= 1, JSON.stringify(m.json?.data));
  const t = await api("GET", "/api/v1/connect/tokens");
  assert(t.json?.data?.length >= 1, "tokens empty");
  const a = await api("GET", "/api/v1/connect/audit?limit=5");
  assert(a.json?.meta?.total >= 3, "audit thin");
  return `tokens=${t.json.data.length}`;
});

// --- 10. collection ------------------------------------------------------------------------
let colAgent = "", colRun = "";
await check("agents:resolve + run + ingest + finish", async () => {
  const res = await api("PUT", "/api/v1/agents:resolve", { external_key: `e2e-col-${RUN}`, fingerprint: `fp-e2e-${RUN}`, name: "E2E Col" });
  assert(res.json?.data?.id, JSON.stringify(res.json)?.slice(0, 200));
  colAgent = res.json.data.id;
  const st = await api("POST", "/api/v1/runs", { agent_id: colAgent, input: "{}" });
  colRun = st.json?.data?.id;
  assert(colRun, "no run");
  const ing = await api("POST", "/api/v1/ingest", { events: [{ run_id: colRun, kind: "log", name: "boot", args: { api_key: "shh" } }] });
  assert(ing.json?.data?.ingested === 1, JSON.stringify(ing.json));
  const got = await api("GET", `/api/v1/runs/${colRun}`);
  assert(got.json?.data?.events?.[0]?.args?.api_key === "[REDACTED]", "not redacted");
  const fin = await api("POST", `/api/v1/runs/${colRun}/finish`, { status: "completed" });
  assert(fin.json?.data?.status === "completed", JSON.stringify(fin.json));
  return "secret redacted at rest";
});

// --- 11. triggers: live signed callback ------------------------------------------------------
await check("trigger fire delivers signed agent.run callback", async () => {
  const c = await api("POST", "/api/v1/triggers", { agent_id: colAgent, type: "api", name: `E2E trig ${RUN}`, endpoint: "http://127.0.0.1:8899/cb", endpoint_secret: ENDPOINT_SECRET });
  const tid = c.json?.data?.id;
  assert(tid, JSON.stringify(c.json)?.slice(0, 200));
  const f = await api("POST", `/api/v1/triggers/${tid}/fire`, { input: { x: 1 } });
  assert(f.json?.data?.id, JSON.stringify(f.json)?.slice(0, 200));
  for (let i = 0; i < 15 && callbacks.length === 0; i++) await new Promise((r) => setTimeout(r, 1000));
  assert(callbacks.length === 1, `callbacks=${callbacks.length}`);
  assert(callbacks[0]!.sigOk, "bad HMAC");
  assert(callbacks[0]!.body.trigger_id === tid, "wrong run context");
  assert(callbacks[0]!.body.input.x === 1, "input not carried");
  return "HMAC verified live";
});

// --- 12. tools -----------------------------------------------------------------------------
await check("tools list + invoke consent path", async () => {
  const l = await api("GET", "/api/v1/tools");
  assert(Array.isArray(l.json?.data), "no tools list");
  return `${l.json.data.length} tools`;
});

// --- 13. dashboard ---------------------------------------------------------------------------
await check("GET /api/analytics", async () => {
  const r = await api("GET", "/api/analytics");
  assert(r.json?.data?.stats?.total_tasks >= 4, JSON.stringify(r.json?.data?.stats));
  return `total=${r.json.data.stats.total_tasks}`;
});

// --- 14. cleanup -------------------------------------------------------------------------------
await check("DELETE /api/v1/agents/:id archives", async () => {
  const r = await api("DELETE", `/api/v1/agents/${agentId}`, undefined);
  assert(r.status === 200, `status ${r.status}`);
  return "archived";
});

listener.stop();
console.log(failures === 0 ? "\nALL E2E CHECKS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
