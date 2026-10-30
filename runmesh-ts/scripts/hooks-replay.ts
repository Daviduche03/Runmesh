/**
 * Replay real Claude Code hook payloads against a live server.
 *
 * Seeds a throwaway account, installs three policy rules, then posts the same JSON that
 * Claude Code's `PreToolUse` HTTP hook sends. Fails if any decision is not what the rules say.
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
  sqlite.close();
}
const TOKEN = await signToken({ id: USER_ID, email: `hooks-${RUN}@test.com` }, 3600);

async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` };
  let data: string | undefined;
  if (body !== undefined) {
    data = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(BASE + path, { method, headers, body: data, signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}

const rules = [
  {
    name: "Allow the test suite",
    conditions: [{ field: "action", operator: "is", value: "test.run" }],
    action: "allow",
    mode: "enforce",
    enabled: true,
  },
  {
    name: "Deny credential reads",
    conditions: [{ field: "action", operator: "is", value: "secrets.read" }],
    action: "deny",
    mode: "enforce",
    enabled: true,
  },
  {
    name: "Ask before merging",
    conditions: [{ field: "action", operator: "is", value: "git.pr.merge" }],
    action: "escalate",
    mode: "enforce",
    enabled: true,
  },
];

for (const rule of rules) {
  const created = await api("POST", "/api/v1/policies/rules", {
    ...rule,
    description: "seeded by scripts/hooks-replay.ts",
  });
  if (created.status !== 200) {
    console.error(`could not create rule "${rule.name}": ${created.status} ${created.text}`);
    process.exit(1);
  }
}

const scenarios: Array<{ label: string; command: string; expected: string }> = [
  { label: "routine test run", command: "bun test", expected: "allow" },
  { label: "credential read", command: "cat ~/.ssh/id_rsa", expected: "deny" },
  { label: "pull request merge", command: "gh pr merge 12 --squash", expected: "ask" },
  { label: "unmatched action (default deny)", command: "make deploy", expected: "deny" },
];

let failures = 0;

for (const scenario of scenarios) {
  const response = await api("POST", "/api/v1/agent-hooks/claude-code", {
    hook_event_name: "PreToolUse",
    session_id: `replay-${RUN}`,
    cwd: "/repo",
    tool_name: "Bash",
    tool_input: { command: scenario.command },
  });

  if (response.status !== 200) {
    failures += 1;
    console.log(`FAIL  ${scenario.label}  -> HTTP ${response.status} ${response.text}`);
    continue;
  }

  const decision = response.json?.hookSpecificOutput?.permissionDecision ?? "none";
  const reason = response.json?.hookSpecificOutput?.permissionDecisionReason ?? "";
  const ok = decision === scenario.expected;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${scenario.label.padEnd(34)} ${decision.padEnd(6)} ${scenario.command}${reason ? `  (${reason})` : ""}`,
  );
}

console.log(failures === 0 ? "\nall hook decisions matched policy" : `\n${failures} hook decision(s) wrong`);
process.exit(failures === 0 ? 0 : 1);
