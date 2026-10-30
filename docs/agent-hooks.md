# Agent access: MCP first, hooks for shell

Every coding agent that speaks MCP — Claude Code, Codex, OpenCode — connects to one
place: the MCP server. Each call runs through the workspace's policy, executes with the
stored credential, and is recorded. There is one rule set and one ledger, whatever the
host.

```
agent ──▶ POST /mcp ──▶ policy ──▶ stored credential ──▶ upstream ──▶ ledger
              │              │
              │              └── deny → isError + reason (nothing executes)
              └── tools/list → what this workspace exposes
```

One normalized hook covers the single thing MCP cannot see — a raw shell command:

```
runmesh exec ──▶ POST /api/v1/agent-hooks/tool ──▶ assess ──▶ policy ──▶ ledger
```

Native tool calls go through MCP. The hook is the fallback `runmesh exec` uses for shell
actions, and it has exactly one shape in and one shape out. Host-specific serializers do
not belong in this codebase: the day a second one appears, that is the review to block.

## MCP endpoint

`POST /mcp` speaks JSON-RPC 2.0 (single or batch). `GET` and `DELETE` answer 405.

Authentication is the API key the dashboard issues, sent either way:

```
X-API-Key: rk_...
Authorization: Bearer rk_...
```

The second form exists because MCP clients such as Codex can only send bearer tokens.
JWT session tokens work in `Authorization` as before.

Listing is a read call; calling is a write call, enforced per key permissions.

### Methods

| Method | Params | Result |
|---|---|---|
| `initialize` | `protocolVersion`, `clientInfo` | negotiated version, `capabilities.tools`, `serverInfo` |
| `ping` | — | `{}` |
| `tools/list` | — | the workspace's managed tools |
| `tools/call` | `name`, `arguments` | tool result, or `isError` on refusal |
| `notifications/*` | — | 202, no body |

Two verbs are served: `runmesh_list_tools` (discovery) and `runmesh_call_tool` (execution).

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "runmesh_call_tool",
    "arguments": {
      "tool_ref": "tool_abc",
      "args": { "repo": "org/proj", "title": "Fix" },
      "session_id": "codex-1",
      "idempotency_key": "retry-1"
    }
  }
}
```

`run_id` attaches to an existing run; otherwise `session_id` (caller-chosen, stable across
calls) puts every call of a session on one run, so the audit trail chains. The run comes
back in `_meta`:

```json
{ "result": { "content": [{ "type": "text", "text": "…" }], "_meta": { "run_id": "run_…" } } }
```

A refusal never executes and never raises transport-level: it returns `isError: true` with
the reason as text, so the agent can read it and react.

| Decision | MCP result |
|---|---|
| `allow` | `content[0].text` is the tool result |
| `deny` | `isError`, text is the reason |
| `escalate` | `isError`, text says a human must decide first |
| `consent` | `isError`, text names the provider to connect |

Unknown tools and bad arguments are JSON-RPC errors (`-32602`); anything else is `-32603`.
The server never answers an MCP request with an HTML error page.

### Client configuration

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.runmesh]
url = "https://runmesh.example.com/mcp"
bearer_token_env_var = "RUNMESH_API_KEY"
```

Claude Code (`.claude/settings.json` or `claude mcp add --transport http`):

```json
{
  "mcpServers": {
    "runmesh": {
      "type": "http",
      "url": "https://runmesh.example.com/mcp",
      "headers": { "Authorization": "Bearer $RUNMESH_API_KEY" }
    }
  }
}
```

## The hook fallback

`POST /api/v1/agent-hooks/tool` takes one normalized body and returns the Runmesh
envelope:

```json
{
  "source": "exec",
  "event": "tool.before",
  "session_id": "ses_abc",
  "agent": "build",
  "tool": "Bash",
  "input": { "command": "gh pr merge 12" },
  "cwd": "/repo"
}
```

`event` is one of `tool.before`, `tool.after`, `session.start`, `session.end`.

The response carries the assessment and the decision:

```json
{
  "ok": true,
  "data": {
    "run_id": "run_…",
    "thread_id": "th_hook_…",
    "agent_id": "agt_…",
    "assessment": { "action": "git.pr.merge", "suspicion": "normal", "signals": [] },
    "decision": { "decision": "escalate", "reason": "…", "configured": true, "enforced": true }
  }
}
```

## Assessment

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
`egress_bypass`, `write_outside_cwd`, `privilege_escalation`. A command with no matching
rule is `unknown`, which a rule can match — it is never treated as safe.

The hook never decides on its own: the assessment picks which rule gets asked, and policy
answers. Only an *enforced* allow runs; when policy is unconfigured or log-only, the
assessment is recorded and nothing is blocked.

## Turning policy on

Policy is off until a workspace has at least one enabled `enforce` rule. Before that,
everything is assessed and recorded, and nothing is blocked.

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

Then flip that rule to `"mode": "enforce"`. From that moment **unmatched actions fall to
default deny**, which is the intended behaviour but a sharp edge — add allow rules for
routine work first:

```json
{ "name": "Allow reads",    "conditions": [{ "field": "action", "operator": "is", "value": "fs.read" }],   "action": "allow", "mode": "enforce", "enabled": true }
{ "name": "Allow searches", "conditions": [{ "field": "action", "operator": "is", "value": "net.search" }], "action": "allow", "mode": "enforce", "enabled": true }
{ "name": "Allow tests",    "conditions": [{ "field": "action", "operator": "is", "value": "test.run" }],  "action": "allow", "mode": "enforce", "enabled": true }
```

## Proving it

`pnpm hooks:replay` drives the MCP server on a live instance — handshake, discovery, a
real refusal through the policy path, session-to-run chaining, errors, and auth:

```
PASS  initialize handshake
PASS  tool discovery                          runmesh_list_tools, runmesh_call_tool
PASS  refusal maps onto isError, not a call   Connect test-provider to let this agent act on your behalf.
PASS  one session shares one run              run_ca213039892d
PASS  unknown tool is a JSON-RPC error         -32602
PASS  unauthenticated is 401                  HTTP 401
```

```bash
cd runmesh-ts
PORT=8899 DB_PATH=/tmp/hooks.db JWT_SECRET=dev bun src/main.ts &
pnpm hooks:replay http://localhost:8899 dev /tmp/hooks.db
```

## What this is not

- **Not full shell visibility.** An agent that runs shell commands outside `runmesh exec`
  is not observed by either surface today. The hook is the seam; the shim comes next.
- **Not a sandbox.** If the real credential is in the environment and the network is open,
  nothing here stops a determined agent from going around the hook. The server routes,
  records, and refuses; it does not contain.
- **Not a classifier yet.** Assessment is deterministic rules. The model-backed classifier
  plugs into the same `assessTool` interface so `unknown` can become a real guess, with the
  same rule: a guess may escalate, never allow.

## Privacy

Request arguments are redacted and capped by the collection layer (8 KB). `Edit`/`Write`
bodies are the exception: the hook stores only the path, the byte length, and a short
hash, never the content.
