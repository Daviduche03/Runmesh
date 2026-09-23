#!/usr/bin/env node
// Driver for the Acme tier-1 customer E2E.
// Seeds a workspace fixture (connections, rules, grant), runs the customer
// app (e2e/acme/app.mjs) through every leg against the real backend +
// mock upstream, asserts model-visible and backend state, then cleans up
// residue back to the exact baseline counts.
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const RM = path.join(ROOT, "runmesh-main");
const API = process.env.RUNMESH_URL ?? "http://localhost:8787";
const MOCK = process.env.MOCK_URL ?? "http://localhost:8799";
const WS = "ws_2c2d5a5148e64b5cb6898b7b8772dd31";
const CONN_G = "conn_e2e_google";
const CONN_S = "conn_e2e_slack";
const TOKEN_G = "acme_gmail_token_e2e_secret_1";
const TOKEN_S = "acme_slack_token_e2e_secret_1";

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Transient socket resets must not flake the suite: one retry, then throw. */
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

async function api(pathname, init = {}) {
  const res = await fetchJson(`${API}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${JWT}`,
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

async function mock(pathname, init = {}) {
  const res = await fetchJson(`${MOCK}${pathname}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  return res.json();
}

function runApp(scenario) {
  const proc = spawnSync("node", [path.join(HERE, "app.mjs"), scenario], {
    cwd: HERE,
    encoding: "utf8",
    env: { ...process.env, RUNMESH_URL: API, MOCK_URL: MOCK, RUNMESH_TOKEN: JWT },
    maxBuffer: 8 * 1024 * 1024,
  });
  const lines = (proc.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  let out;
  try {
    out = JSON.parse(last);
  } catch {
    out = { scenario, parseError: true, stdout: proc.stdout, stderr: proc.stderr, status: proc.status };
  }
  if (proc.stderr) process.stderr.write(`  [app:${scenario}] ${proc.stderr.trim()}\n`);
  return out;
}

async function waitFor(url, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
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

function firstSaw(out) {
  return saw(out)[0]?.value ?? {};
}

let JWT = "";
let mockProc = null;
let t0 = "";
let baseline = null;
let agentId = "";
let slackGrantId = "";
let googleGrantId = "";

const RULES = [
  { name: "Gmail sends are allowed", action: "allow", value: "google.gmail.send" },
  { name: "Slack deletes are hard-denied", action: "deny", value: "slack.chat.delete" },
  { name: "Gmail modifications need a human", action: "escalate", value: "google.gmail.modify" },
  { name: "Gmail drafts need consent", action: "consent", value: "google.gmail.draft" },
  { name: "Slack posts are allowed", action: "allow", value: "slack.chat.postMessage" },
  // Issuance tier: the consent path's pending grant must stay pending
  // (escalate → pending_approval) instead of being blocked by default-deny
  // or auto-approved by an allow rule.
  { name: "Slack scope issuance needs sign-off", action: "escalate", value: "slack.chat:write" },
];

async function useCount(connectionId) {
  const rows = JSON.parse(
    dbrunner("sql", `SELECT use_count FROM connect_grants WHERE connection_id='${connectionId}' AND workspace_id='${WS}'`),
  );
  return rows.length ? Number(rows[0].use_count) : 0;
}

async function slackGrant() {
  const rows = JSON.parse(
    dbrunner("sql", `SELECT id, approval_status, use_count FROM connect_grants WHERE connection_id='${CONN_S}' AND workspace_id='${WS}'`),
  );
  return rows[0] ?? null;
}

async function main() {
  // ——— preflight ———
  baseline = JSON.parse(dbrunner("counts"));
  t0 = dbrunner("t0");
  console.log("baseline:", JSON.stringify(baseline));

  const health = await waitFor(`${API}/health`);
  if (!health) throw new Error(`backend not reachable at ${API}/health — start pywrangler dev first`);
  check("backend healthy", true);

  mockProc = spawn("node", [path.join(HERE, "mock-upstream.mjs")], { stdio: "pipe" });
  mockProc.stderr.on("data", (d) => process.stderr.write(`[mock] ${d}`));
  const mockUp = await waitFor(`${MOCK}/_hits`);
  check("mock upstream up", mockUp);

  dbrunner("seed");
  JWT = dbrunner("jwt");

  // ——— resolve the customer agent ———
  await mock("/_reset", { method: "POST" });
  let out = runApp("resolve");
  check("resolve run completed", out.text === "resolved" && !out.threw, JSON.stringify(out));

  // The list API never returns external_key (public shape: fingerprint only),
  // so the agent id comes from the row the resolve just wrote.
  const agentRows = JSON.parse(
    dbrunner(
      "sql",
      `SELECT id FROM agents WHERE external_key='acme-support-copilot' AND workspace_id='${WS}'`,
    ),
  );
  agentId = agentRows[0]?.id ?? "";
  check("agent registered", Boolean(agentId), JSON.stringify(agentRows));

  // ——— policy rules ———
  for (const rule of RULES) {
    const res = await api("/api/v1/policies/rules", {
      method: "POST",
      body: JSON.stringify({
        name: rule.name,
        description: `E2E: ${rule.value}`,
        conditions: [{ field: "action", operator: "is", value: rule.value }],
        action: rule.action,
        mode: "enforce",
        enabled: true,
      }),
    });
    check(`rule ${rule.action} ${rule.value}`, res.status === 200, `status=${res.status} ${JSON.stringify(res.body)}`);
  }

  // ——— google grant: policy allow → auto-approved ———
  const grantRes = await api("/api/v1/grants", {
    method: "POST",
    body: JSON.stringify({
      connection_id: CONN_G,
      agent_id: agentId,
      scopes: ["gmail.send"],
      approval_status: "approved",
    }),
  });
  googleGrantId = grantRes.body?.data?.id ?? "";
  check(
    "google grant created approved",
    grantRes.status === 200 && grantRes.body?.data?.approval_status === "approved",
    JSON.stringify(grantRes.body),
  );

  // ——— allow ———
  await mock("/_reset", { method: "POST" });
  const g0 = await useCount(CONN_G);
  out = runApp("allow");
  let hits = await mock("/_hits");
  let value = firstSaw(out);
  check("allow: model saw upstream result", value.ok === true, JSON.stringify(out));
  check("allow: exactly one upstream hit", hits.length === 1, JSON.stringify(hits));
  check("allow: credential injected", hits[0]?.auth === `Bearer ${TOKEN_G}`, hits[0]?.auth ?? "");
  check("allow: token scrubbed from model view", (out.text ?? "").includes("[REDACTED]"));
  check("allow: raw token never reaches the model", !(out.text ?? "").includes(TOKEN_G));
  check("allow: grant use consumed", (await useCount(CONN_G)) === g0 + 1);

  // ——— deny ———
  await mock("/_reset", { method: "POST" });
  const g1 = await useCount(CONN_G);
  out = runApp("deny");
  hits = await mock("/_hits");
  value = firstSaw(out);
  check("deny: policy_denied to model", value.error === "policy_denied", JSON.stringify(value));
  check("deny: rule named", Boolean(value.reason) && String(value.reason).length > 0, JSON.stringify(value));
  check("deny: no upstream call", hits.length === 0, JSON.stringify(hits));
  check("deny: no grant use", (await useCount(CONN_G)) === g1);

  // ——— escalate ———
  await mock("/_reset", { method: "POST" });
  const g2 = await useCount(CONN_G);
  out = runApp("escalate");
  hits = await mock("/_hits");
  value = firstSaw(out);
  check("escalate: policy_escalated to model", value.error === "policy_escalated", JSON.stringify(value));
  check("escalate: no upstream call", hits.length === 0, JSON.stringify(hits));
  check("escalate: no grant use", (await useCount(CONN_G)) === g2);

  // ——— policy consent (no consent_url yet — different machinery) ———
  await mock("/_reset", { method: "POST" });
  out = runApp("policy_consent");
  value = firstSaw(out);
  check("policy consent: consent_required to model", value.error === "consent_required", JSON.stringify(value));
  check("policy consent: no url yet", value.consent_url === null || value.consent_url === undefined, JSON.stringify(value));

  // ——— default deny ———
  await mock("/_reset", { method: "POST" });
  out = runApp("default_deny");
  value = firstSaw(out);
  check("default deny: policy_denied to model", value.error === "policy_denied", JSON.stringify(value));
  check("default deny: reason says default", /default/i.test(String(value.reason ?? "")), JSON.stringify(value));
  const gaps = await api("/api/v1/policies/coverage-gaps");
  check(
    "default deny: visible in coverage gaps",
    JSON.stringify(gaps.body).includes("google.gmail.labels"),
    JSON.stringify(gaps.body).slice(0, 300),
  );

  // ——— consent → pending grant → reuse → operator approve → resume ———
  await mock("/_reset", { method: "POST" });
  out = runApp("consent");
  value = firstSaw(out);
  check("consent: consent_required to model", value.error === "consent_required", JSON.stringify(value));
  check(
    "consent: resume URL points at grants page",
    typeof value.consent_url === "string" && value.consent_url.endsWith("/grants"),
    JSON.stringify(value),
  );
  let pending = await slackGrant();
  check("consent: pending grant minted", pending?.approval_status === "pending_approval", JSON.stringify(pending));

  out = runApp("consent"); // retry must reuse, not duplicate
  value = firstSaw(out);
  const pendingCount = JSON.parse(
    dbrunner("sql", `SELECT COUNT(*) AS n FROM connect_grants WHERE connection_id='${CONN_S}' AND workspace_id='${WS}'`),
  )[0]?.n;
  check("consent retry: same URL, no duplicate grants", value.consent_url?.endsWith("/grants") && Number(pendingCount) === 1, `n=${pendingCount}`);

  const approveRes = await api(`/api/v1/connect/grants/${pending.id}/approve`, {
    method: "POST",
    body: JSON.stringify({ reason: "E2E operator approval" }),
  });
  check("operator approval", approveRes.status === 200, JSON.stringify(approveRes.body));
  pending = await slackGrant();
  check("grant now approved", pending?.approval_status === "approved", JSON.stringify(pending));

  const audit = await api("/api/v1/connect/audit?limit=50");
  const auditText = JSON.stringify(audit.body);
  check("audit: approval recorded", auditText.includes("connect.grant.approved"), auditText.slice(0, 300));

  // ——— resume after approval ———
  await mock("/_reset", { method: "POST" });
  const s0 = await useCount(CONN_S);
  out = runApp("resume");
  hits = await mock("/_hits");
  value = firstSaw(out);
  check("resume: allow reaches model", value.ok === true, JSON.stringify(value));
  check("resume: slack upstream hit", hits.length === 1 && hits[0]?.path === "/slack/post", JSON.stringify(hits));
  check("resume: slack credential injected", hits[0]?.auth === `Bearer ${TOKEN_S}`, hits[0]?.auth ?? "");
  check("resume: use consumed", (await useCount(CONN_S)) === s0 + 1);

  // ——— forward mode ———
  await mock("/_reset", { method: "POST" });
  const s1 = await useCount(CONN_S);
  out = runApp("forward");
  hits = await mock("/_hits");
  value = firstSaw(out);
  check("forward: dev execute got result", value.ok === true, JSON.stringify(value));
  check("forward: one routed call", hits.length === 1 && hits[0]?.path === "/slack/post", JSON.stringify(hits));
  check("forward: credential injected", hits[0]?.auth === `Bearer ${TOKEN_S}`, hits[0]?.auth ?? "");
  check("forward: scrubbed in model view", (out.text ?? "").includes("[REDACTED]") && !(out.text ?? "").includes(TOKEN_S));
  check("forward: use consumed", (await useCount(CONN_S)) === s1 + 1);

  // ——— local tool: no upstream, telemetry thread lands ———
  await mock("/_reset", { method: "POST" });
  out = runApp("local");
  hits = await mock("/_hits");
  value = firstSaw(out);
  check("local: refund result to model", value?.refund?.amount === 19.99, JSON.stringify(value));
  check("local: zero upstream calls", hits.length === 0, JSON.stringify(hits));
  const runRows = JSON.parse(
    dbrunner("sql", `SELECT id FROM agent_runs WHERE input='Acme e2e: local' AND workspace_id='${WS}' ORDER BY created_at DESC`),
  );
  const localRun = runRows[0];
  check("local: run recorded", Boolean(localRun?.id), JSON.stringify(runRows));
  if (localRun?.id) {
    const runDetail = await api(`/api/v1/runs/${localRun.id}`);
    const events = runDetail.body?.data?.events ?? [];
    check(
      "local: tool.call event in audit thread",
      events.some((e) => e.name === "refund_lookup" && e.kind === "tool.call"),
      JSON.stringify(events.map((e) => `${e.kind}:${e.name}`)),
    );
  }

  // ——— idempotency: same run + same args executes upstream once ———
  await mock("/_reset", { method: "POST" });
  const g3 = await useCount(CONN_G);
  out = runApp("idempotent");
  hits = await mock("/_hits");
  const values = saw(out);
  check("idempotent: model saw both results", values.length === 2, JSON.stringify(values));
  check("idempotent: single upstream execution", hits.filter((h) => h.path === "/gmail/send").length === 1, JSON.stringify(hits));
  check(
    "idempotent: replayed result identical",
    values.length === 2 && JSON.stringify(values[0].value) === JSON.stringify(values[1].value),
    JSON.stringify(values),
  );
  check("idempotent: one grant use for two calls", (await useCount(CONN_G)) === g3 + 1);

  // ——— upstream failure: fail-closed flag, still scrubbed ———
  await mock("/_reset", { method: "POST" });
  await mock("/_fail", { method: "POST", body: JSON.stringify({ paths: ["/gmail/send"] }) });
  const g4 = await useCount(CONN_G);
  out = runApp("failure");
  value = firstSaw(out);
  check("failure: upstream error surfaces to model", value.error === "upstream_exploded", JSON.stringify(value));
  check("failure: raw token still scrubbed", !(out.text ?? "").includes(TOKEN_G) && (out.text ?? "").includes("[REDACTED]"));
  check("failure: policy did not treat 500 as denial", value.error !== "policy_denied");
  check("failure: use already reserved", (await useCount(CONN_G)) === g4 + 1);

  // ——— grant lifecycle: exhausted max_uses denies ———
  dbrunner(
    "sql",
    `UPDATE connect_grants SET max_uses = use_count WHERE connection_id='${CONN_G}' AND workspace_id='${WS}'`,
  );
  await mock("/_reset", { method: "POST" });
  const g5 = await useCount(CONN_G);
  out = runApp("allow");
  hits = await mock("/_hits");
  value = firstSaw(out);
  check("exhausted: deny to model", value.error === "policy_denied", JSON.stringify(value));
  check("exhausted: reason names uses", /use/i.test(String(value.reason ?? "")), JSON.stringify(value));
  check("exhausted: no upstream call", hits.length === 0, JSON.stringify(hits));
  check("exhausted: count unchanged", (await useCount(CONN_G)) === g5);

  // ——— misconfigured managed tool fails loudly ———
  out = runApp("misconfig");
  check(
    "misconfig: wrapTools throws naming the tool",
    typeof out.threw === "string" && out.threw.includes("ghost_send"),
    JSON.stringify(out),
  );

  // ——— ledger: every decision class landed ———
  const decisions = JSON.parse(
    dbrunner(
      "sql",
      `SELECT decision, COUNT(*) AS n FROM policy_decisions WHERE workspace_id='${WS}' AND created_at >= '${t0.replace(/'/g, "''")}' GROUP BY decision`,
    ),
  );
  const byDecision = Object.fromEntries(decisions.map((d) => [d.decision, Number(d.n)]));
  for (const kind of ["allow", "deny", "escalate", "consent"]) {
    check(`ledger: ${kind} decisions recorded`, (byDecision[kind] ?? 0) > 0, JSON.stringify(byDecision));
  }

  // ——— final use totals ———
  check("final google uses = 3 (allow + idempotent + failure)", (await useCount(CONN_G)) === 3, `got ${await useCount(CONN_G)}`);
  check("final slack uses = 2 (resume + forward)", (await useCount(CONN_S)) === 2, `got ${await useCount(CONN_S)}`);

  // ——— model never saw any raw credential across every leg ———
  check("no raw credentials in last app output", !JSON.stringify(out).includes(TOKEN_G) && !JSON.stringify(out).includes(TOKEN_S));
}

try {
  await main();
} catch (err) {
  failures += 1;
  const cause = err?.cause ? ` cause=${JSON.stringify({ code: err.cause?.code, message: err.cause?.message })}` : "";
  console.log(`[FAIL] driver crashed: ${err?.stack ?? err}${cause}`);
} finally {
  if (t0 && process.env.KEEP === "1") {
    // KEEP=1: leave residue so the audit thread(s) can be reviewed in the UI.
    console.log("\n[KEEP=1] residue preserved for review");
    try {
      const rows = JSON.parse(
        dbrunner(
          "sql",
          `SELECT thread_id, id, input, status, created_at FROM agent_runs WHERE workspace_id='${WS}' AND input LIKE 'Acme e2e%' AND created_at >= '${t0.replace(/'/g, "''")}' ORDER BY created_at`,
        ),
      );
      for (const r of rows) {
        console.log(`  thread ${r.thread_id}  run ${r.id}  ${r.input}  (${r.status})`);
      }
      console.log("\n  UI: Audit → Threads → open a th_ id above (localhost:5173/audit)");
      console.log(`  clean later: cd runmesh-main && PYTHONPATH=src uv run python "${path.join(HERE, "dbrunner.py")}" cleanup '${t0}'`);
    } catch (err) {
      failures += 1;
      console.log(`[FAIL] listing kept runs: ${err}`);
    }
  } else if (t0) {
    try {
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

console.log(failures === 0 ? "\nALL LEGS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
