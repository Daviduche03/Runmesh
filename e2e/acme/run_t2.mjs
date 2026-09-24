#!/usr/bin/env node
// Driver for the Acme tier-2 adversarial E2E. Same contract as tier-1
// (mock upstream only, no new SDK API, KEEP residue on failure, exact
// baseline cleanup on success) but every leg is hostile: races, revocation
// mid-flight, secret-shaped args, hostile upstreams, forward abuse,
// cross-principal isolation, audit at volume, and policy flips.
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const RM = path.join(ROOT, "runmesh-main");
const API = process.env.RUNMESH_URL ?? "http://localhost:8787";
const MOCK = process.env.MOCK_URL ?? "http://localhost:8799";
const WS = "ws_2c2d5a5148e64b5cb6898b7b8772dd31";
const WS2 = "ws_t2_isolation";
const CONN_G = "conn_e2e_google";
const TOKEN_G = "acme_gmail_token_e2e_secret_1";
const CONN_OTHER = "conn_t2_other";
const CU_OTHER = "cu_t2_other";
const TOKEN_OTHER = "acme_t2_other_secret_9";
const U_T2 = "u_t2_builder";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`[PASS] ${name}`);
  } else {
    failures += 1;
    console.log(`[FAIL] ${name} ${detail}`);
  }
}

function dbrunner(...args) {
  const proc = spawnSync("uv", ["run", "python", path.join(HERE, "dbrunner.py"), ...args], {
    cwd: RM,
    env: { ...process.env, PYTHONPATH: "src" },
    encoding: "utf8",
  });
  if (proc.status !== 0) {
    throw new Error(`dbrunner ${args[0]} failed: ${proc.stderr || proc.stdout}`);
  }
  return (proc.stdout || "").trim();
}

const sql = (stmt) => JSON.parse(dbrunner("sql", stmt));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, init = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      await sleep(200);
    }
  }
  throw lastErr;
}

async function apiAs(pathname, token, init = {}) {
  const res = await fetchJson(`${API}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}
const api = (pathname, init = {}) => apiAs(pathname, JWT, init);

async function mock(pathname, init = {}) {
  const res = await fetchJson(`${MOCK}${pathname}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function runAppT2(scenario, extraEnv = {}) {
  const proc = spawnSync("node", [path.join(HERE, "app_t2.mjs"), scenario], {
    cwd: HERE,
    encoding: "utf8",
    env: { ...process.env, RUNMESH_URL: API, MOCK_URL: MOCK, RUNMESH_TOKEN: JWT, ...extraEnv },
    maxBuffer: 8 * 1024 * 1024,
  });
  const lines = (proc.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  let out;
  try {
    out = JSON.parse(last);
  } catch {
    out = { scenario, parseError: true, stdout: proc.stdout, stderr: proc.stderr, status: proc.status };
  }
  if (proc.stderr) process.stderr.write(`  [appt2:${scenario}] ${proc.stderr.trim()}\n`);
  return out;
}

async function waitFor(url, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

function saw(out) {
  try {
    return JSON.parse(out.text ?? "{}").saw ?? [];
  } catch {
    return [];
  }
}
const firstSaw = (out) => saw(out)[0]?.value ?? {};

let JWT = "";
let JWT2 = "";
let mockProc = null;
let t0 = "";
let baseline = null;
let agentId = "";
let refs = {};
let googleGrantId = "";
let allowRuleId = "";

async function useCount(connectionId) {
  const rows = sql(`SELECT use_count, max_uses FROM connect_grants WHERE connection_id='${connectionId}' AND workspace_id='${WS}'`);
  return rows.length ? { uses: Number(rows[0].use_count), max: rows[0].max_uses == null ? null : Number(rows[0].max_uses) } : { uses: 0, max: null };
}

async function toolRef(name, ws = WS) {
  const rows = sql(`SELECT id FROM tools WHERE name='${name}' AND workspace_id='${ws}'`);
  if (!rows.length) throw new Error(`tool ref missing: ${name} in ${ws}`);
  return rows[0].id;
}

async function startRun(input, token = JWT) {
  const res = await apiAs("/api/v1/runs", token, {
    method: "POST",
    body: JSON.stringify({ agent_id: agentId, input, connect_user_id: "cu_demo" }),
  });
  const id = res.body?.data?.id;
  if (!id) throw new Error(`startRun failed: ${JSON.stringify(res.body)}`);
  return id;
}

async function invoke(ref, runId, args, key, token = JWT, cu = undefined) {
  return apiAs(`/api/v1/tools/${ref}/invoke`, token, {
    method: "POST",
    body: JSON.stringify({
      run_id: runId,
      args,
      ...(key ? { idempotency_key: key } : {}),
      ...(cu ? { connect_user_id: cu } : {}),
    }),
  });
}

async function main() {
  baseline = JSON.parse(dbrunner("counts"));
  t0 = dbrunner("t0");
  console.log("baseline:", JSON.stringify(baseline));

  if (!(await waitFor(`${API}/health`))) throw new Error("backend down");
  check("backend healthy", true);
  mockProc = spawn("node", [path.join(HERE, "mock-upstream.mjs")], { stdio: "pipe" });
  mockProc.stderr.on("data", (d) => process.stderr.write(`[mock] ${d}`));
  check("mock upstream up", await waitFor(`${MOCK}/_hits`));

  dbrunner("seed");
  JWT = dbrunner("jwt");

  // ——— fixture: t2 probe agent + tools ———
  await mock("/_reset", { method: "POST" });
  let out = runAppT2("probe_resolve");
  check("t2 probe resolved", out.text === "t2-resolved" && !out.threw, JSON.stringify(out));
  agentId = sql(`SELECT id FROM agents WHERE external_key='acme-t2-probe' AND workspace_id='${WS}'`)[0]?.id ?? "";
  check("t2 agent registered", Boolean(agentId));
  for (const name of ["t2_send", "t2_slow", "t2_big", "t2_raw", "t2_fw"]) {
    refs[name] = await toolRef(name);
  }
  check("t2 tool refs resolved", Object.keys(refs).length === 5, JSON.stringify(refs));

  const ruleRes = await api("/api/v1/policies/rules", {
    method: "POST",
    body: JSON.stringify({
      name: "T2 Gmail sends are allowed",
      description: "E2E t2",
      conditions: [{ field: "action", operator: "is", value: "google.gmail.send" }],
      action: "allow",
      mode: "enforce",
      enabled: true,
    }),
  });
  allowRuleId = ruleRes.body?.data?.id ?? "";
  check("t2 allow rule created", ruleRes.status === 200 && Boolean(allowRuleId));

  const grantRes = await api("/api/v1/grants", {
    method: "POST",
    body: JSON.stringify({ connection_id: CONN_G, agent_id: agentId, scopes: ["gmail.send"], approval_status: "approved" }),
  });
  googleGrantId = grantRes.body?.data?.id ?? "";
  check("t2 google grant approved", grantRes.status === 200, JSON.stringify(grantRes.body));

  // ═══ T2-1 grant race: max_uses=1, 8 concurrent distinct-key invokes ═══
  {
    await mock("/_reset", { method: "POST" });
    await mock("/_delay", { method: "POST", body: JSON.stringify({ delays: { "/t2/send": 400 } }) });
    const runId = await startRun("Acme t2: race");
    const g0 = await useCount(CONN_G);
    sql(`UPDATE connect_grants SET max_uses = ${g0.uses + 1} WHERE connection_id='${CONN_G}' AND workspace_id='${WS}'`);
    const calls = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        invoke(refs.t2_send, runId, { to: `race${i}@x.test`, subject: "race", body: "r" }, `t2race-${Date.now()}-${i}`),
      ),
    );
    const decisions = calls.map((c) => c.body?.data?.decision);
    const statuses = calls.map((c) => c.status);
    const allows = decisions.filter((d) => d === "allow").length;
    const denies = decisions.filter((d) => d === "deny").length;
    const hits = await mock("/_hits");
    const g1 = await useCount(CONN_G);
    check("race: exactly one allow", allows === 1, JSON.stringify(decisions));
    check("race: rest deny", denies === 7, JSON.stringify(decisions));
    check("race: one upstream execution", hits.filter((h) => h.path === "/t2/send").length === 1, JSON.stringify(hits.map((h) => h.path)));
    check("race: use_count advanced by exactly one", g1.uses === g0.uses + 1, JSON.stringify({ g0, g1 }));
    check("race: no 500s", statuses.every((s) => s < 500), JSON.stringify(statuses));
    sql(`UPDATE connect_grants SET max_uses = NULL WHERE connection_id='${CONN_G}' AND workspace_id='${WS}'`);
    await mock("/_reset", { method: "POST" });
  }

  // ═══ T2-2 idempotency key reuse across different args must not replay stale ═══
  {
    await mock("/_reset", { method: "POST" });
    const runId = await startRun("Acme t2: key-mismatch");
    const key = `t2key-mismatch-${Date.now()}`;
    const r1 = await invoke(refs.t2_send, runId, { to: "a@x.test", subject: "one", body: "1" }, key);
    check("mismatch: first executes", r1.body?.data?.decision === "allow" && !r1.body?.data?.idempotent_replay, JSON.stringify(r1.body));
    const r2 = await invoke(refs.t2_send, runId, { to: "b@x.test", subject: "two", body: "2" }, key);
    const hits = await mock("/_hits");
    check(
      "mismatch: different args are rejected, never replayed",
      r2.body?.error?.code === 400 && /idempotency key already used/.test(JSON.stringify(r2.body)),
      `status=${r2.status} ${JSON.stringify(r2.body).slice(0, 200)}`,
    );
    check("mismatch: rejected before any side effect", hits.filter((h) => h.path === "/t2/send").length === 1, `hits=${hits.length}`);
  }

  // ═══ T2-4 secret-shaped args must not land plaintext in the ledger ═══
  {
    const runId = await startRun("Acme t2: secret-args");
    const secret = "sk-live-T2SECRET-123";
    const r = await invoke(refs.t2_send, runId, { to: "vip@example.com", subject: "keys", body: "see attached", api_key: secret }, `t2secret-${Date.now()}`);
    check("secret: invoke allowed", r.body?.data?.decision === "allow", JSON.stringify(r.body));
    const rows = sql(`SELECT kind, args, result FROM agent_events WHERE run_id='${runId}'`);
    const blob = JSON.stringify(rows);
    check("secret: no plaintext secret in agent_events", !blob.includes(secret), blob.slice(0, 400));
  }

  // ═══ T2-5 hostile upstream: timeout, giant body, non-JSON ═══
  {
    await mock("/_reset", { method: "POST" });
    await mock("/_delay", { method: "POST", body: JSON.stringify({ delays: { "/t2/slow": 32000 } }) });
    out = runAppT2("probe_timeout");
    const value = firstSaw(out);
    check("timeout: model sees upstream_unreachable", value?.error === "upstream_unreachable", JSON.stringify(value).slice(0, 300));
    check("timeout: raw token never in model view", !(out.text ?? "").includes(TOKEN_G));
    await mock("/_reset", { method: "POST" });
    await mock("/_big", { method: "POST", body: JSON.stringify({ paths: { "/t2/big": 2000000 } }) });
    out = runAppT2("probe_big");
    const bigVal = firstSaw(out);
    check("big: truncated flag reaches model", bigVal?.truncated === true, JSON.stringify(bigVal).slice(0, 200));
    check("big: raw token scrubbed", !(out.text ?? "").includes(TOKEN_G) && (out.text ?? "").includes("[REDACTED]"));
    await mock("/_reset", { method: "POST" });
    await mock("/_raw", { method: "POST", body: JSON.stringify({ paths: { "/t2/raw": "plain-text-body-no-json" } }) });
    out = runAppT2("probe_raw");
    const rawVal = firstSaw(out);
    check("raw: non-JSON body surfaces as body", rawVal?.body === "plain-text-body-no-json", JSON.stringify(rawVal).slice(0, 200));
    await mock("/_reset", { method: "POST" });
  }

  // ═══ T2-6 forward abuse: absolute URL, traversal, credential override ═══
  {
    await mock("/_reset", { method: "POST" });
    const runId = await startRun("Acme t2: forward-abuse");
    const fwd = (p, headers) =>
      api(`/api/v1/tools/${refs.t2_fw}/forward`, {
        method: "POST",
        body: JSON.stringify({ run_id: runId, method: "POST", path: p, ...(headers ? { headers } : {}), idempotency_key: `t2fw-${Date.now()}-${p}` }),
      });
    const evil = await fwd("https://evil.test/x");
    check("forward: absolute URL rejected", evil.body?.error?.code === 400, `status=${evil.status} ${JSON.stringify(evil.body).slice(0, 200)}`);
    const trav = await fwd("/../admin");
    const hits = await mock("/_hits");
    check(
      "forward: traversal stays on the tool host, normalized",
      trav.status === 200 && hits.length === 1 && hits[0]?.path === "/admin",
      `status=${trav.status} hits=${JSON.stringify(hits)}`,
    );
    await mock("/_reset", { method: "POST" });
    const over = await fwd("/t2/send", { Authorization: "Bearer evil", "X-Custom": "kept" });
    const hits2 = await mock("/_hits");
    check("forward: caller cannot override credential", hits2.length === 1 && hits2[0]?.auth === `Bearer ${TOKEN_G}`, JSON.stringify(hits2));
    check("forward: non-auth headers pass through", over.status === 200, `status=${over.status}`);
  }

  // ═══ T2-3 revocation mid-flight: in-flight stands, next call stops ═══
  {
    await mock("/_reset", { method: "POST" });
    await mock("/_delay", { method: "POST", body: JSON.stringify({ delays: { "/t2/send": 2500 } }) });
    const runId = await startRun("Acme t2: revoke-midflight");
    const g0 = await useCount(CONN_G);
    const pending = invoke(refs.t2_send, runId, { to: "mid@x.test", subject: "m", body: "m" }, `t2mid-${Date.now()}`);
    await sleep(600);
    const rev = await api(`/api/v1/grants/${googleGrantId}/revoke`, { method: "POST", body: JSON.stringify({ reason: "t2 revoke mid-flight" }) });
    check("revoke accepted", rev.status === 200, JSON.stringify(rev.body).slice(0, 200));
    const r = await pending;
    check("midflight: in-flight call stands", r.body?.data?.decision === "allow", JSON.stringify(r.body).slice(0, 300));
    const hitsBefore = (await mock("/_hits")).length;
    const r2 = await invoke(refs.t2_send, runId, { to: "after@x.test", subject: "a", body: "a" }, `t2after-${Date.now()}`);
    const hitsAfter = (await mock("/_hits")).length;
    check("revoked: next call is consent, not allow", r2.body?.data?.decision === "consent", JSON.stringify(r2.body).slice(0, 300));
    check("revoked: no new upstream call", hitsAfter === hitsBefore, `${hitsBefore} -> ${hitsAfter}`);
    check("revoked: use_count unchanged by blocked call", (await useCount(CONN_G)).uses === g0.uses + 1);
    const decs = sql(`SELECT decision FROM policy_decisions WHERE run_id='${runId}' AND workspace_id='${WS}' ORDER BY created_at`);
    check("midflight: allow decision recorded for the run", decs.some((d) => d.decision === "allow"), JSON.stringify(decs));
    await mock("/_reset", { method: "POST" });
    // Fresh grant for the volume + flip legs.
    const g3 = await api("/api/v1/grants", {
      method: "POST",
      body: JSON.stringify({ connection_id: CONN_G, agent_id: agentId, scopes: ["gmail.send"], approval_status: "approved" }),
    });
    googleGrantId = g3.body?.data?.id ?? googleGrantId;
    check("t2 grant re-issued", Boolean(googleGrantId) && g3.status === 200, JSON.stringify(g3.body).slice(0, 200));
  }

  // ═══ T2-7 isolation: second workspace, cross-ref 404, other-principal attribution ═══
  {
    const now = new Date().toISOString();
    dbrunner("sql", `INSERT INTO users (id, name, email, password, created_at, updated_at) VALUES ('${U_T2}','T2','t2@example.com','t2-test-password','${now}','${now}')`);
    dbrunner("sql", `INSERT INTO workspaces (id, name, owner_user_id, status, metadata, created_at, updated_at) VALUES ('${WS2}','T2','${U_T2}','active','{}','${now}','${now}')`);
    dbrunner("sql", `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES ('wsm_t2','${WS2}','${U_T2}','owner','${now}','${now}')`);
    JWT2 = dbrunner("jwt_ws", U_T2, WS2);
    check("ws2 token minted", JWT2.length > 50);
    const out2 = runAppT2("probe_resolve", { RUNMESH_TOKEN: JWT2, T2_AGENT_KEY: "acme-t2-probe" });
    check("ws2 same-key resolve ok", out2.text === "t2-resolved" && !out2.threw, JSON.stringify(out2));
    const id1 = sql(`SELECT id FROM agents WHERE external_key='acme-t2-probe' AND workspace_id='${WS}'`)[0]?.id;
    const id2 = sql(`SELECT id FROM agents WHERE external_key='acme-t2-probe' AND workspace_id='${WS2}'`)[0]?.id;
    check("isolation: same key, distinct agents per workspace", Boolean(id1) && Boolean(id2) && id1 !== id2, `${id1} vs ${id2}`);
    const ws2run = await apiAs("/api/v1/runs", JWT2, {
      method: "POST",
      body: JSON.stringify({ agent_id: id2, input: "Acme t2: xws", connect_user_id: "cu_demo" }),
    });
    const ws2runId = ws2run.body?.data?.id ?? "";
    const xws = await apiAs(`/api/v1/tools/${refs.t2_send}/invoke`, JWT2, {
      method: "POST",
      body: JSON.stringify({ run_id: ws2runId, args: { to: "x@x.test", subject: "x", body: "x" }, idempotency_key: `t2xws-${Date.now()}` }),
    });
    check("isolation: foreign tool ref is 404", xws.body?.error?.code === 404, `status=${xws.status} ${JSON.stringify(xws.body).slice(0, 200)}`);

    // Same workspace, other principal: allowed, but the decision names the principal.
    const enc = dbrunner("encrypt", TOKEN_OTHER);
    dbrunner("sql", `INSERT INTO connect_users (id, status, primary_email, primary_email_verified, created_at, updated_at) VALUES ('${CU_OTHER}','active','other@example.com',1,'${now}','${now}')`);
    dbrunner("sql", `INSERT INTO connect_connections (id, connect_user_id, provider, status, scopes, access_token_enc, metadata, created_at, updated_at, workspace_id) VALUES ('${CONN_OTHER}','${CU_OTHER}','google','active','[\"gmail.send\"]','${enc.replace(/'/g, "''")}','{}','${now}','${now}','${WS}')`);
    const og = await api("/api/v1/grants", {
      method: "POST",
      body: JSON.stringify({ connection_id: CONN_OTHER, agent_id: agentId, scopes: ["gmail.send"], approval_status: "approved" }),
    });
    check("other-principal grant approved", og.status === 200, JSON.stringify(og.body).slice(0, 200));
    const orun = await startRun("Acme t2: other-principal");
    const or = await invoke(refs.t2_send, orun, { to: "o@x.test", subject: "o", body: "o" }, `t2other-${Date.now()}`, JWT, CU_OTHER);
    check("other-principal: shared-workspace invoke allowed", or.body?.data?.decision === "allow", JSON.stringify(or.body).slice(0, 300));
    const odec = sql(`SELECT connect_user_id FROM policy_decisions WHERE run_id='${orun}' AND workspace_id='${WS}' ORDER BY created_at DESC LIMIT 1`)[0];
    check("other-principal: decision records the principal used", odec?.connect_user_id === CU_OTHER, JSON.stringify(odec));
  }

  // ═══ T2-8 audit at volume: counts, pages, attribution ═══
  {
    const vrun = await startRun("Acme t2: volume");
    const N = 30;
    for (let i = 0; i < N; i += 1) {
      // Explicit principal: T2-7 added a second google connection, so the
      // caller must name one — which also proves disambiguation works.
      const r = await invoke(refs.t2_send, vrun, { to: `v${i}@x.test`, subject: `v${i}`, body: "v" }, `t2vol-${Date.now()}-${i}`, JWT, "cu_demo");
      if (r.body?.data?.decision !== "allow") throw new Error(`volume invoke ${i} not allowed: ${JSON.stringify(r.body).slice(0, 200)}`);
    }
    const dbCalls = sql(`SELECT COUNT(*) AS n FROM agent_events WHERE run_id='${vrun}' AND kind='tool.call'`)[0]?.n;
    check("volume: 30 tool.calls recorded", Number(dbCalls) === N, `n=${dbCalls}`);
    const apiCalls = await api("/api/v1/connect/audit?event_type=tool.call&limit=500");
    const dbTotal = sql(`SELECT COUNT(*) AS n FROM agent_events WHERE workspace_id='${WS}' AND kind='tool.call'`)[0]?.n;
    check("volume: API filter total matches ledger", apiCalls.body?.meta?.total === Number(dbTotal), `api=${apiCalls.body?.meta?.total} db=${dbTotal}`);
    const p0 = await api("/api/v1/connect/audit?limit=25&offset=0");
    const p1 = await api("/api/v1/connect/audit?limit=25&offset=25");
    const i0 = new Set(p0.body?.data?.map((e) => e.id) ?? []);
    const i1 = new Set(p1.body?.data?.map((e) => e.id) ?? []);
    const overlap = [...i0].filter((id) => i1.has(id));
    check("volume: pages disjoint, totals agree", overlap.length === 0 && p0.body?.meta?.total === p1.body?.meta?.total, `overlap=${overlap.length}`);
    const unattributed = (p0.body?.data ?? []).filter((e) => e.event_type === "tool.call" && e.on_behalf_of === "—");
    check("volume: every tool.call attributed", unattributed.length === 0, `${unattributed.length} unattributed`);
  }

  // ═══ T2-9 policy flip at call time + revoke replays as consent ═══
  {
    const flip = await api(`/api/v1/policies/rules/${allowRuleId}`, { method: "PATCH", body: JSON.stringify({ action: "deny" }) });
    check("flip: rule patched to deny", flip.status === 200, `status=${flip.status}`);
    await mock("/_reset", { method: "POST" });
    const frun = await startRun("Acme t2: flip");
    const fr = await invoke(refs.t2_send, frun, { to: "f@x.test", subject: "f", body: "f" }, `t2flip-${Date.now()}`, JWT, "cu_demo");
    const fhits = await mock("/_hits");
    check("flip: deny evaluated at call time", fr.body?.data?.decision === "deny", JSON.stringify(fr.body).slice(0, 300));
    check("flip: no upstream on deny", fhits.length === 0, JSON.stringify(fhits));
    const back = await api(`/api/v1/policies/rules/${allowRuleId}`, { method: "PATCH", body: JSON.stringify({ action: "allow" }) });
    check("flip: rule restored to allow", back.status === 200);
    const rev = await api(`/api/v1/grants/${googleGrantId}/revoke`, { method: "POST", body: JSON.stringify({ reason: "t2 final revoke" }) });
    check("revoke accepted", rev.status === 200);
    await mock("/_reset", { method: "POST" });
    const crun = await startRun("Acme t2: revoked-consent");
    const cr = await invoke(refs.t2_send, crun, { to: "c@x.test", subject: "c", body: "c" }, `t2cons-${Date.now()}`, JWT, "cu_demo");
    const chits = await mock("/_hits");
    check("revoked: consent with URL, no upstream", cr.body?.data?.decision === "consent" && typeof cr.body?.data?.consent_url === "string" && chits.length === 0, JSON.stringify(cr.body).slice(0, 300));
  }
}

try {
  await main();
} catch (err) {
  failures += 1;
  const cause = err?.cause ? ` cause=${JSON.stringify({ code: err.cause?.code, message: err.cause?.message })}` : "";
  console.log(`[FAIL] driver crashed: ${err?.stack ?? err}${cause}`);
} finally {
  if (t0 && process.env.KEEP === "1") {
    console.log("\n[KEEP=1] residue preserved for review");
    try {
      const rows = sql(`SELECT thread_id, id, input, status FROM agent_runs WHERE workspace_id='${WS}' AND input LIKE 'Acme t2%' AND created_at >= '${t0.replace(/'/g, "''")}' ORDER BY created_at`);
      for (const r of rows) console.log(`  thread ${r.thread_id}  run ${r.id}  ${r.input}  (${r.status})`);
      console.log("\n  UI: Audit → Threads → open a th_ id above (localhost:5173/audit)");
      console.log(`  clean later: cd runmesh-main && PYTHONPATH=src uv run python "${path.join(HERE, "dbrunner.py")}" cleanup '${t0}'`);
    } catch (err) {
      failures += 1;
      console.log(`[FAIL] listing kept runs: ${err}`);
    }
  } else if (t0) {
    try {
      // T2-specific residue the shared cleanup does not own: second
      // workspace, other principal, and its grant.
      dbrunner("sql", `DELETE FROM agent_events WHERE workspace_id='${WS2}'`);
      dbrunner("sql", `DELETE FROM agent_runs WHERE workspace_id='${WS2}'`);
      dbrunner("sql", `DELETE FROM tools WHERE workspace_id='${WS2}'`);
      dbrunner("sql", `DELETE FROM agents WHERE workspace_id='${WS2}'`);
      dbrunner("sql", `DELETE FROM policy_decisions WHERE workspace_id='${WS2}'`);
      dbrunner("sql", `DELETE FROM connect_audit_events WHERE workspace_id='${WS2}'`);
      dbrunner("sql", `DELETE FROM connect_grants WHERE connection_id='${CONN_OTHER}'`);
      dbrunner("sql", `DELETE FROM connect_connections WHERE id='${CONN_OTHER}'`);
      dbrunner("sql", `DELETE FROM connect_app_users WHERE external_user_id='${CONN_OTHER}'`);
      dbrunner("sql", `DELETE FROM connect_users WHERE id='${CU_OTHER}'`);
      dbrunner("sql", `DELETE FROM workspace_members WHERE workspace_id='${WS2}'`);
      dbrunner("sql", `DELETE FROM workspaces WHERE id='${WS2}'`);
      dbrunner("sql", `DELETE FROM users WHERE id='${U_T2}'`);
      const after = JSON.parse(dbrunner("cleanup", t0));
      const same = baseline && JSON.stringify(after) === JSON.stringify(baseline);
      console.log("after cleanup:", JSON.stringify(after));
      check("residue back to baseline", same, `baseline=${JSON.stringify(baseline)} after=${JSON.stringify(after)}`);
    } catch (err) {
      failures += 1;
      console.log(`[FAIL] cleanup crashed: ${err?.stack ?? err}`);
    }
  }
  if (mockProc) mockProc.kill();
}

console.log(failures === 0 ? "\nALL T2 LEGS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
