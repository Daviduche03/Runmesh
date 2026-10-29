/**
 * Frontend contract check: exercises every HTTP path the routed dashboard pages
 * call, and asserts the response shapes their zustand stores depend on.
 *
 * Run against a live server:
 *   bun scripts/frontend-contract.ts http://localhost:8787 <jwt-secret> [db-path]
 */
import { Database } from "bun:sqlite";

const BASE = process.argv[2] ?? "http://localhost:8787";
const SECRET = process.argv[3] ?? process.env.JWT_SECRET ?? "";
const DB = process.argv[4] ?? process.env.DB_PATH ?? "runmesh.db";

process.env.JWT_SECRET = SECRET;
const { signToken } = await import("../src/core/auth/tokens.js");

const RUN = Date.now().toString(36);
const USER_ID = `contract-user-${RUN}`;
const EMAIL = `contract-${RUN}@test.com`;

{
  const sqlite = new Database(DB);
  const now = new Date().toISOString();
  sqlite
    .query("INSERT INTO users (id, name, email, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(USER_ID, "Contract Tester", EMAIL, "github_oauth:no_password", now, now);
  sqlite.close();
}
const TOKEN = await signToken({ id: USER_ID, email: EMAIL }, 3600);

let failures = 0;
let passes = 0;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function api(method: string, path: string, body?: unknown, token = TOKEN) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let data: string | undefined;
  if (body !== undefined) {
    data = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(BASE + path, { method, headers, body: data, redirect: "manual" });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  return { status: res.status, json, text };
}

async function expectOk(label: string, method: string, path: string, body?: unknown) {
  const r = await api(method, path, body);
  assert(r.json?.ok === true, `${method} ${path} -> ${r.status} ${r.text.slice(0, 200)}`);
  return r;
}

/** Assert an object carries every key a frontend store type declares. */
function fields(label: string, row: any, required: string[], optional: string[] = []) {
  const missing = required.filter((k) => !(k in (row ?? {})));
  assert(missing.length === 0, `${label}: missing ${missing.join(", ")} (got ${Object.keys(row ?? {}).join(", ")})`);
  return optional;
}

async function check(label: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    passes++;
    console.log(`PASS  ${label}${detail ? `  -> ${detail}` : ""}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${label}  -> ${err instanceof Error ? err.message : err}`);
  }
}

// --- fixtures -----------------------------------------------------------------
const agent = (await expectOk("create agent", "POST", "/api/v1/agents", { name: `contract-agent-${RUN}` })).json.data;
const apiKey = (await expectOk("create api key", "POST", "/api-keys", { name: `contract-${RUN}`, permissions: ["read"] })).json.data;
const policyRule = (
  await expectOk("create policy rule", "POST", "/api/v1/policies/rules", {
    name: `contract rule ${RUN}`,
    action: "allow",
    scope: "github",
    enabled: true,
    mode: "enforce",
    conditions: [{ field: "action", operator: "is", value: "github" }],
  })
).json.data;
await expectOk("create google policy rule", "POST", "/api/v1/policies/rules", {
  name: `contract google rule ${RUN}`,
  action: "allow",
  scope: "google",
  enabled: true,
  mode: "enforce",
  conditions: [{ field: "action", operator: "is", value: "google" }],
});
await expectOk("create webhook", "POST", "/api/webhooks", {
  name: `contract hook ${RUN}`,
  url: "https://jsonplaceholder.typicode.com/posts",
  events: "task.completed",
});
const task = (await expectOk("create task", "POST", "/api/v1/tasks", { url: "https://jsonplaceholder.typicode.com/posts", payload: { c: 1 } })).json.data;
const workflow = (
  await expectOk("create workflow", "POST", "/api/v1/workflows", {
    name: `contract wf ${RUN}`,
    description: "contract check",
    tasks: [{ url: "https://jsonplaceholder.typicode.com/posts", payload: {} }],
  })
).json.data;
await expectOk("run workflow", "POST", `/api/v1/workflows/${workflow.workflow_id}/run`, {});
const project = (
  await expectOk("create project", "POST", "/api/workspace/projects", {
    prefix: `contract-${RUN}`,
    bucket: "contract-bucket",
  })
).json.data;

const colAgent = (
  await expectOk("resolve agent", "PUT", "/api/v1/agents:resolve", {
    external_key: `contract-col-${RUN}`,
    fingerprint: `fp-${RUN}`,
    name: `Contract Col ${RUN}`,
  })
).json.data;
const run = (await expectOk("start run", "POST", "/api/v1/runs", { agent_id: colAgent.id, input: "{}" })).json.data;
await expectOk("ingest", "POST", "/api/v1/ingest", {
  events: [{ run_id: run.id, kind: "log", name: "step", args: { api_key: "secret" } }],
});

// connect fixtures live only behind OAuth, so seed them directly
let connectionId = "";
{
  const orm = await import("../src/core/db/orm.js");
  const schema = await import("../src/core/db/schema.js");
  const { ensureWorkspaceApp } = await import("../src/modules/connect/apps.js");
  const { attachProviderIdentity, upsertConnection } = await import("../src/modules/connect/sessions.js");
  const { createDb } = await import("../src/core/db/client.js");
  const handle = createDb(DB);
  const db: any = handle.db;
  const ws = db
    .select()
    .from(schema.workspaces)
    .all()
    .find((w: any) => w.ownerUserId === USER_ID);
  assert(ws, "workspace was not provisioned for the fixture user");
  const userModel = new orm.ConnectUserModel(db);
  const cu = userModel.findByPrimaryEmail(EMAIL) ?? userModel.create({ primaryEmail: EMAIL, primaryEmailVerified: true });
  const capp = ensureWorkspaceApp(db, ws.id, USER_ID);
  if (!new orm.ConnectAppUserModel(db).findByExternalUser(capp.id, `ext-${RUN}`)) {
    new orm.ConnectAppUserModel(db).create({ connectAppId: capp.id, externalUserId: `ext-${RUN}`, connectUserId: cu.id });
  }
  const ident = attachProviderIdentity(db, {
    connectUserId: cu.id,
    provider: "google",
    providerSubject: `sub-${RUN}`,
    email: EMAIL,
    emailVerified: true,
  });
  connectionId = upsertConnection(db, {
    connectUserId: cu.id,
    provider: "google",
    scopes: ["gmail.send"],
    accessToken: "ya29.contract",
    identityId: ident.id,
    accountLabel: EMAIL,
    workspaceId: ws.id,
  });
  handle.close();
}
const createdGrant = (
  await expectOk("create grant", "POST", "/api/v1/grants", {
    connection_id: connectionId,
    scopes: ["gmail.send"],
  })
).json.data;
const grants = (await expectOk("list grants for seeding", "GET", "/api/v1/grants")).json.data;
const grant = grants.find((g: any) => g.id === createdGrant.id);
assert(grant, "no connect grant seeded");

// --- the checks -----------------------------------------------------------------

await check("GET /api/me (auth bootstrap)", async () => {
  const r = await expectOk("me", "GET", "/api/me");
  fields("me", r.json.data, ["id", "email"]);
  return r.json.data.email;
});

await check("GET /api/v1/agents -> BackendAgent[]", async () => {
  const r = await expectOk("agents", "GET", "/api/v1/agents");
  assert(Array.isArray(r.json.data), "data is not an array");
  fields("agent", r.json.data[0], [
    "id", "workspace_id", "name", "description", "status", "parent_agent_id",
    "project_id", "environment", "key_fingerprint", "last_seen_at", "created_at", "updated_at",
  ]);
  return `${r.json.data.length} agents`;
});

await check("GET /api/v1/agents/:id/runs -> BackendRun[]", async () => {
  const r = await expectOk("agent runs", "GET", `/api/v1/agents/${colAgent.id}/runs`);
  fields("run", r.json.data[0], ["id", "agent_id", "status", "event_count", "started_at", "created_at"]);
  return `${r.json.data.length} runs`;
});

await check("GET /api/v1/runs/:id -> BackendRunDetail", async () => {
  const r = await expectOk("run detail", "GET", `/api/v1/runs/${run.id}`);
  fields("run detail", r.json.data, ["id", "agent_id", "status", "usage", "input", "events", "child_runs"]);
  fields("run event", r.json.data.events[0], [
    "id", "kind", "name", "args", "result", "truncated", "duration_ms", "seq", "created_at",
  ]);
  assert(r.json.data.events[0].args.api_key === "[REDACTED]", "ingested secret not redacted");
  return `${r.json.data.events.length} events`;
});

await check("GET /api/v1/tasks -> dashboard row shape + meta", async () => {
  const r = await expectOk("tasks", "GET", "/api/v1/tasks?page=1&limit=50");
  assert(Array.isArray(r.json.data), "data is not an array");
  fields("task row", r.json.data[0], ["id", "endpoint", "status", "scheduled", "duration", "retries"]);
  assert(typeof r.json.meta?.total === "number", "missing meta.total");
  assert(typeof r.json.meta?.page === "number" && typeof r.json.meta?.limit === "number", "missing page/limit meta");
  return `${r.json.data.length}/${r.json.meta.total}`;
});

await check("GET /api/v1/tasks?status=Completed (filter honored)", async () => {
  const r = await expectOk("tasks filtered", "GET", "/api/v1/tasks?status=Completed&page=1&limit=50");
  assert(r.json.data.every((t: any) => t.status === "Completed"), "filter returned other statuses");
  return `${r.json.data.length} completed`;
});

await check("GET /api/v1/workflows -> Workflow[]", async () => {
  const r = await expectOk("workflows", "GET", "/api/v1/workflows");
  fields("workflow", r.json.data[0], [
    "id", "name", "description", "trigger", "triggerType", "triggerConfig",
    "endpoint", "status", "lastRun", "runs", "stepCount", "createdAt",
  ]);
  return `${r.json.data.length} workflows`;
});

await check("GET /api/v1/workflows/:id -> detail", async () => {
  const r = await expectOk("workflow", "GET", `/api/v1/workflows/${workflow.workflow_id}`);
  fields("workflow", r.json.data, ["id", "name", "tasks", "status"]);
  return `${r.json.data.tasks?.length ?? 0} steps`;
});

await check("GET /api/v1/workflows/:id/runs", async () => {
  const r = await expectOk("workflow runs", "GET", `/api/v1/workflows/${workflow.workflow_id}/runs`);
  assert(Array.isArray(r.json.data) && r.json.data.length >= 1, "no runs listed");
  fields("workflow run", r.json.data[0], ["id", "status", "startedAt", "triggeredBy"]);
  return `${r.json.data.length} runs`;
});

await check("PUT /api/v1/workflows/:id/graph (builder save)", async () => {
  const graph = {
    nodes: [
      { id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { label: "Trigger", triggerType: "manual" } },
      { id: "n2", type: "http", position: { x: 200, y: 0 }, data: { url: "https://example.com", label: "Step 1", payload: {} } },
    ],
    edges: [{ id: "e1", source: "trigger", target: "n2" }],
  };
  await expectOk("save graph", "PUT", `/api/v1/workflows/${workflow.workflow_id}/graph`, graph);
  const read = await expectOk("read graph", "GET", `/api/v1/workflows/${workflow.workflow_id}`);
  assert(read.json.data.graph?.nodes?.length === 2, "graph not persisted on the workflow payload");
  return "round-tripped";
});

await check("GET /api/v1/connect/audit -> BackendAuditEvent[] + meta", async () => {
  const r = await expectOk("audit", "GET", "/api/v1/connect/audit?limit=100");
  fields("audit event", r.json.data[0], [
    "id", "event_type", "actor", "actor_type", "on_behalf_of", "mode", "type",
    "authority", "outcome", "trace_id", "thread_id", "agent_id", "task_id",
    "workflow_run_id", "result", "denial_reason", "metadata", "created_at",
  ]);
  assert(typeof r.json.meta?.total === "number", "missing meta.total");
  return `${r.json.data.length}/${r.json.meta.total}`;
});

await check("GET /api/v1/connect/audit?event_type=policy.updated (filter)", async () => {
  const r = await expectOk("audit filtered", "GET", "/api/v1/connect/audit?event_type=policy.updated&limit=100");
  assert(r.json.data.every((e: any) => e.event_type === "policy.updated"), "filter leaked other event types");
  return `${r.json.data.length} policy events`;
});

await check("GET /api/v1/connect/providers", async () => {
  const r = await expectOk("providers", "GET", "/api/v1/connect/providers");
  assert(Array.isArray(r.json.data), "data is not an array");
  return `${r.json.data.length} providers`;
});

await check("GET /api/v1/grants -> BackendGrant[] + meta", async () => {
  const r = await expectOk("grants", "GET", "/api/v1/grants");
  fields("grant", r.json.data[0], [
    "id", "agent_id", "connect_user_id", "user", "provider", "account_label", "scopes",
    "resource", "resource_filters", "status", "approval_status", "uses", "max_uses",
    "valid_until", "seconds_until_expiration", "environment", "created_at",
  ]);
  assert(typeof r.json.meta?.total === "number", "missing meta.total");
  return `${r.json.data.length} grants`;
});

await check("grant approval endpoint agrees with policy outcome", async () => {
  // A matching allow rule auto-approves at issuance; the endpoint is then a no-op 409.
  if (grant.approval_status === "approved") return "already approved by policy";
  const r = await api("POST", `/api/v1/connect/grants/${grant.id}/approve`, { reason: "contract" });
  assert(r.json?.ok === true, `${r.status} ${r.text.slice(0, 180)}`);
  assert(r.json.data.approval_status === "approved", `status=${r.json.data.approval_status}`);
  return "approved by operator";
});

await check("GET /api/v1/connections -> BackendConnection[]", async () => {
  const r = await expectOk("connections", "GET", "/api/v1/connections");
  fields("connection", r.json.data[0], ["id", "connect_user_id", "user", "provider", "account", "scopes", "status", "created_at"]);
  return `${r.json.data.length} connections`;
});

await check("GET /api/v1/policies/rules -> BackendPolicyRule[]", async () => {
  const r = await expectOk("policy rules", "GET", "/api/v1/policies/rules");
  fields("rule", r.json.data[0], [
    "id", "priority", "name", "description", "enabled", "conditions", "action", "scope",
    "mode", "caps", "reversibility", "decided", "escalated", "approvals", "rejections",
    "medianReviewMs", "rego", "created_at", "updated_at",
  ]);
  return `${r.json.data.length} rules`;
});

await check("GET /api/v1/policies/coverage-gaps", async () => {
  const r = await expectOk("coverage", "GET", "/api/v1/policies/coverage-gaps");
  assert(r.json.data !== undefined, "no data");
  return Array.isArray(r.json.data) ? `${r.json.data.length} gaps` : "object";
});

await check("GET /api/v1/policies/capability-matrix", async () => {
  const r = await expectOk("matrix", "GET", "/api/v1/policies/capability-matrix");
  assert(r.json.data !== undefined, "no data");
  return Array.isArray(r.json.data) ? `${r.json.data.length} rows` : "object";
});

await check("POST /api/v1/policies/evaluate -> EvaluateResult", async () => {
  const r = await expectOk("evaluate", "POST", "/api/v1/policies/evaluate", {
    action: "github",
    agent: agent.id,
    resource: "",
    user: USER_ID,
    amount: "0",
  });
  fields("evaluate", r.json.data, ["decision", "rule", "reason", "steps", "changeHint"]);
  return r.json.data.decision;
});

await check("GET /api-keys -> ApiKey[]", async () => {
  const r = await expectOk("api keys", "GET", "/api-keys");
  fields("api key", r.json.data[0], ["id", "name", "permissions", "created_at", "last_used_at"]);
  assert(!("key" in r.json.data[0]), "plaintext key leaked in list");
  return `${r.json.data.length} keys`;
});

await check("GET /api/webhooks -> never leaks the secret", async () => {
  const r = await expectOk("webhooks", "GET", "/api/webhooks");
  fields("webhook", r.json.data[0], ["id", "name", "url", "events", "status", "secret_hint", "created_at", "updated_at"]);
  assert(r.json.data[0].secret === undefined, "secret leaked in list");
  return `${r.json.data.length} hooks`;
});

await check("GET /api/webhooks/dead-letters -> array", async () => {
  const r = await expectOk("dead letters", "GET", "/api/webhooks/dead-letters");
  assert(Array.isArray(r.json.data), "data is not an array");
  return `${r.json.data.length} dead letters`;
});

await check("GET /api/workspace/projects -> Project[]", async () => {
  const r = await expectOk("projects", "GET", "/api/workspace/projects");
  fields("project", r.json.data[0], ["id", "prefix", "bucket", "local_path", "last_synced_at", "created_at", "updated_at"]);
  return `${r.json.data.length} projects`;
});

await check("GET /api/v1/workspaces (onboarding gate)", async () => {
  const r = await expectOk("workspaces", "GET", "/api/v1/workspaces");
  assert(Array.isArray(r.json.data) && r.json.data.length >= 1, "no workspace for the signed-in user");
  return `${r.json.data.length} workspaces`;
});

await check("GET /api/analytics (dashboard)", async () => {
  const r = await expectOk("analytics", "GET", "/api/analytics");
  assert(r.json.data?.stats, "missing stats");
  fields("stats", r.json.data.stats, ["total_tasks", "active_runs", "completed_today", "failed"]);
  return `total=${r.json.data.stats.total_tasks}`;
});

await check("task page delete path", async () => {
  const created = (await expectOk("create", "POST", "/api/v1/tasks", { url: "https://jsonplaceholder.typicode.com/posts", payload: {} })).json.data;
  await expectOk("delete", "DELETE", `/api/v1/tasks/${created.task_id}`);
  return "deleted";
});

console.log(failures === 0 ? `\nALL ${passes} CONTRACT CHECKS PASSED` : `\n${failures} FAILURES / ${passes} passed`);
process.exit(failures === 0 ? 0 : 1);
