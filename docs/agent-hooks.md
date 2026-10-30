# Agent hooks

One seam every coding agent can reach: the agent reports "I am about to run this", and
Runmesh answers **allow**, **deny**, or **ask**. The answer comes from the workspace's
policy rules; every question and answer is written to the decision ledger.

Claude Code calls this natively over HTTP. The OpenCode plugin forwards the same shape.
`runmesh exec` will call the same service, so the policy and the audit trail do not change
with the host.

## Endpoints

| Route | Body | Response |
|---|---|---|
| `POST /api/v1/agent-hooks/tool` | normalized (below) | Runmesh envelope |
| `POST /api/v1/agent-hooks/claude-code` | Claude Code's own hook payload | Claude Code's hook output |

Both require `X-API-Key: rk_...` (or a bearer token) with `write` permission. The key's
workspace scopes the decision.

### Normalized body

```json
{
  "source": "opencode",
  "event": "tool.before",
  "session_id": "ses_abc",
  "agent": "build",
  "tool": "Bash",
  "input": { "command": "gh pr merge 12" },
  "cwd": "/repo"
}
```

`event` is one of `tool.before`, `tool.after`, `session.start`, `session.end`.

Response:

```json
{
  "ok": true,
  "data": {
    "run_id": "run_…",
    "thread_id": "th_hook_…",
    "agent_id": "agt_…",
    "assessment": {
      "action": "git.pr.merge",
      "resource": "",
      "suspicion": "normal",
      "signals": [],
      "reason": "merges a pull request"
    },
    "decision": {
      "decision": "escalate",
      "reason": "Ask before merging matched on action is git.pr.merge.",
      "rule": { "id": "pol_…", "name": "Ask before merging", "priority": 1 },
      "configured": true,
      "enforced": true
    }
  }
}
```

## Claude Code

Add the hook to `.claude/settings.json` (project) or `~/.claude/settings.json` (user):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Edit|Write|WebFetch",
        "hooks": [
          {
            "type": "http",
            "url": "https://runmesh.example.com/api/v1/agent-hooks/claude-code",
            "headers": { "X-API-Key": "$RUNMESH_API_KEY" },
            "allowedEnvVars": ["RUNMESH_API_KEY"],
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|Edit|Write|WebFetch",
        "hooks": [
          {
            "type": "http",
            "url": "https://runmesh.example.com/api/v1/agent-hooks/claude-code",
            "headers": { "X-API-Key": "$RUNMESH_API_KEY" },
            "allowedEnvVars": ["RUNMESH_API_KEY"],
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

`PostToolUse` is what turns a decision into a receipt: the result lands on the same run.

If your settings define `allowedHttpHookUrls`, the URL must be on that list.

## Decision mapping

| Runmesh | Claude Code | Meaning |
|---|---|---|
| `allow` | `permissionDecision: "allow"` | only when an enforce rule allowed it |
| `deny` | `permissionDecision: "deny"` | an enforce rule refused it |
| `escalate` | `permissionDecision: "ask"` | a human decides |
| `consent` | `permissionDecision: "ask"` | the end user must connect an account |

When policy is **not configured**, or the matching rule is `log-only`, the endpoint returns
no decision at all (`{}`). That is deliberate: the hook must never make a call looser than
the host's own permission flow. It can only add friction.

## Turning it on

Policy is off until a workspace has at least one enabled `enforce` rule. Before that, every
call is assessed and recorded, and nothing is blocked.

Start with `log-only` rules so `policy_decisions` fills with what *would* have happened:

```bash
curl -X POST "$RUNMESH/api/v1/policies/rules" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Watch credential reads",
    "conditions": [{"field": "action", "operator": "is", "value": "secrets.read"}],
    "action": "deny",
    "mode": "log-only",
    "enabled": true
  }'
```

Then flip that one rule to `"mode": "enforce"`. From that moment **unmatched actions fall to
default deny**, which is the intended behaviour but a sharp edge — add allow rules for
routine work first:

```json
{ "name": "Allow reads",    "conditions": [{ "field": "action", "operator": "is", "value": "fs.read" }],   "action": "allow", "mode": "enforce", "enabled": true }
{ "name": "Allow searches", "conditions": [{ "field": "action", "operator": "is", "value": "net.search" }], "action": "allow", "mode": "enforce", "enabled": true }
{ "name": "Allow tests",    "conditions": [{ "field": "action", "operator": "is", "value": "test.run" }],  "action": "allow", "mode": "enforce", "enabled": true }
```

## What the assessment sees

`assessTool` maps every tool onto one action vocabulary, so a single rule covers a shell
command and an MCP call:

| Tool | Action |
|---|---|
| `Bash` `git push --force` | `git.force_push` |
| `Bash` `gh pr merge 12` | `git.pr.merge` |
| `Bash` `cat .env` | `secrets.read` |
| `Bash` `npm test` | `test.run` |
| `Edit` / `Write` | `fs.write` |
| `Read` / `Grep` | `fs.read` |
| `WebFetch` | `net.fetch` |
| `mcp__github__create_issue` | `github.create.issue` |

Bash is split on `&&`, `||`, `;`, `|`, newlines, `$(...)`, and backticks before matching, and
the **worst** action in a chain wins: `npm test && rm -rf /` is `fs.destroy`.

Evasion signals raise suspicion to `high` even when the action looks harmless:
`pipe_to_shell`, `encoded_payload`, `string_interpreter`, `secret_paths`, `audit_tamper`,
`egress_bypass`, `write_outside_cwd`, `privilege_escalation`. A command with no matching rule
is `unknown`, which a rule can match — it is never treated as safe.

## Proving it

`pnpm hooks:replay` seeds three rules on a live server and posts the same payloads Claude Code
sends, then fails if any decision disagrees with policy:

```
PASS  routine test run                   allow  bun test
PASS  credential read                    deny   cat ~/.ssh/id_rsa
PASS  pull request merge                 ask    gh pr merge 12 --squash
PASS  unmatched action (default deny)    deny   make deploy
```

```bash
cd runmesh-ts
PORT=8899 DB_PATH=/tmp/hooks.db JWT_SECRET=dev bun src/main.ts &
pnpm hooks:replay http://localhost:8899 dev /tmp/hooks.db
```

## What this is not

- **Not a sandbox.** If the real credential is in the environment and the network is open,
  nothing here stops a determined agent from going around the hook. The hook routes, records,
  and escalates; it does not contain.
- **Not full visibility.** Agents that cannot post a pre-tool event (Codex, today) are not
  observed by this endpoint. They are governed through the managed tool path instead.
- **Not a classifier yet.** Assessment is deterministic rules. The model-backed classifier
  plugs into the same `assessTool` interface so `unknown` can become a real guess, with the
  same rule: a guess may escalate, never allow.

## Privacy

Request arguments are redacted and capped by the collection layer (8 KB). File bodies are
the exception: `Edit`/`Write` inputs are never stored — only the path, the byte length, and
a short hash.
