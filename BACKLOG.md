# Runmesh Connect Architecture Backlog

## Connect Architectural Assessment (2026-09-04)

### Current State
Connect is a **solid, secure identity and credential layer** that successfully solves the problem of letting third-party apps delegate user access without storing long-lived secrets. The implementation is thoughtfully designed with clean session state machines, sensible database invariants, and correct cryptography.

However, **Connect is not yet an "agentic infrastructure" layer**—it's the substrate you build on top of to create one.

---

## Gap Analysis: Agentic vs. Current Design

### 1. Human-Driven Consent Flow, Not Agent-Aware
**Current behavior:**
- The GRANT mode explicitly routes through HTML consent forms (`/connect/consent`) where a *person* approves access
- No primitives for *programmatic* approval gates tied to agent actions
- No connection between token issuance and specific agent identity, task, or workflow run

**Impact:**
- An agent cannot autonomously request a Connect token; an app must pre-fetch grants manually and hand the grant_id to the agent
- This violates the agentic principle: "How does an agent prove it should get a token?" Right now: "the app tells you"—not agent-native
- No audit trail linking token issuance to the agent that used it (only post-hoc in audit events)

**What Agentic Would Look Like:**
- Token requests should include `agent_id`, `task_id`, or `workflow_run_id`
- Approval gates should be tied to existing task/workflow approval workflows, not separate
- The grant record itself should know which agents or tasks it was created for

### 2. Scope Granularity Stops at OAuth Level
**Current behavior:**
- Scopes are OAuth scopes (e.g., `issues:write` for GitHub)
- Grants bundle app + user + connection + OAuth scopes
- No way to issue a token that says "write to only this repository" or "only for this specific workflow run"

**Impact:**
- Coarse-grained permissions; agent gets all-or-nothing access to a provider
- Real agent security requires finer granularity: time-bounded, action-bounded, resource-bounded tokens
- Impossible to express "this agent can file issues in repos tagged 'trusted-agents' only"

**What Agentic Would Look Like:**
- Provider-specific scope mapping: `github.issue.create` for specific repo, not just `issues:write`
- Task-scoped tokens: "this token is valid only while executing task_123"
- Resource-scoped tokens: "this token can only affect resources tagged with project_id"

### 3. Synchronous Token Request, Not Async
**Current behavior:**
- `POST /api/v1/connect/token` is synchronous: request → immediate token response
- If you want approval before issuing a token, the app must call a separate approval endpoint first
- No integration with task/workflow queues or approval events

**Impact:**
- Cannot queue a task that says "run this, and if you need a GitHub token, get approval first then resume"
- Agent workflows cannot be paused waiting for Connect token approval
- Approval logic lives outside the Connect/Task/Workflow layers

**What Agentic Would Look Like:**
- Async token request: `POST /api/v1/tasks/...` with `needs_connect_grant` flag
- Task pauses waiting for approval event
- Once approved, token issued and task resumed
- Task can reference the token that was used in its audit trail

### 4. Schema Is App-Centric, Not Agent-Centric
**Current schema:**
```sql
grants (
  connect_app_id,
  connect_user_id,
  connection_id,
  scopes,
  status,
  -- Optional metadata in audit events only, not in grant record itself
)
```

**Impact:**
- No indexed `agent_id`, `task_id`, or `workflow_run_id` in the grant table
- Queries like "which grants can this agent use?" require scanning audit logs
- Cannot revoke access to a specific agent without revoking entire grant
- Multi-agent or multi-task scenarios have no first-class representation

**What Agentic Would Look Like:**
```sql
grants (
  connect_app_id,
  connect_user_id,
  connection_id,
  scopes,
  -- Agent/task context
  created_by_task_id,
  created_by_workflow_run_id,
  agent_id,
  -- Scope constraints
  resource_filters, -- JSON: {repo: "...", label: "..."}
  valid_until,
  max_uses,
  -- Audit
  approved_by_user_id,
  approved_at,
)
```

### 5. Email Is Only Identity Anchor, No Environment Scoping
**Current behavior:**
- Connect User = 1:1 with verified email
- Apps can map their user IDs to Connect Users via `connect_app_users`
- No environment or project scoping (dev/staging/prod are all same connection)

**Impact:**
- If you use one GitHub OAuth app for dev/staging/prod, all environments share the same connection
- Impossible to issue a token that says "valid only for staging repos"
- A revoked agent in prod revokes the entire GitHub connection (affects all envs)

**What Agentic Would Look Like:**
- Grants scoped by environment/project: `grants` has `project_id` or `environment`
- Provider connections can have environment-specific token usage policies
- Separate audit trails per environment

---

## Recommended Priority Improvements

### P0: Make Token Requests Agent-Aware (Foundation)
**Scope:** Enable the core agentic use case: "task needs a token, get approved, then execute with token"

**Changes:**
1. Add `task_id`, `workflow_run_id`, `agent_id` (nullable) fields to `grants` table
2. Add `created_by_task_id`, `created_by_workflow_run_id` to `grants` (denormalized for indexing)
3. Add optional `approval_required` field to `grants`
4. Extend `POST /api/v1/connect/token` to accept `task_id`, `workflow_run_id`, `agent_id` in request body
5. Log approval status in grant record, not just audit event
6. New endpoint: `GET /api/v1/connect/grants?agent_id=...` or `?task_id=...` for task-scoped lookups

**Database migration:**
- Add columns: `created_by_task_id`, `created_by_workflow_run_id`, `agent_id` (TEXT, nullable)
- Add indexes: `(task_id)`, `(workflow_run_id)`, `(agent_id)` for fast lookups
- Populate existing grants with NULL (backward compatible)

**API changes:**
- Token request now includes context: `{ grant_id, task_id?, workflow_run_id?, agent_id? }`
- Audit event links to task/workflow/agent via these fields
- Grant context endpoint returns these fields

**Acceptance criteria:**
- Task can call `POST /api/v1/connect/token` with `task_id`
- Audit trail shows which task issued which token
- Can query grants by task_id with indexed lookup

---

### P1: Approval Gate Tied to Task/Workflow Approval
**Scope:** Block token issuance until human/system approves, integrated with existing approval flows

**Changes:**
1. Add `approval_status` field to `grants`: `pending_approval`, `approved`, `denied`, `auto_approved`
2. Add `approved_by_user_id`, `approved_at`, `approval_reason` for audit
3. When task needs approval *and* needs token:
   - Token request returns `{ status: "pending_approval", token_id, expires_in }`
   - Task waits for approval event (same as workflow approval flow)
   - Once approved, `POST /api/v1/connect/grants/{grant_id}/finalize` issues actual token
4. New endpoint: `POST /api/v1/connect/grants/{grant_id}/approve` (developer endpoint)
5. New event: `connect.grant.approved` emitted to task queue/event stream

**Database changes:**
- Add columns: `approval_status`, `approved_by_user_id`, `approved_at`, `approval_reason`
- Index on `(approval_status, expires_at)` for "pending approvals" queries

**API changes:**
- Extend grant request to include `approval_required: boolean`
- Token response indicates approval state
- Approval webhook or event-driven approval via existing approval flow

**Acceptance criteria:**
- Can mark a grant request as requiring approval
- Approval blocks token issuance until explicitly approved
- Integration with Workflow approval steps (e.g., approval step can approve Connect grants)
- Audit trail shows who approved and when

---

### P2: Scope Refinement & Resource Binding
**Scope:** Enable action-scoped and resource-scoped tokens, not just OAuth-scope-scoped

**Changes:**
1. Add `resource_filters` (JSON) to grants:
   ```json
   {
     "github": {
       "org": "myorg",
       "repos": ["repo1", "repo2"],
       "labels": ["trusted-agents"]
     }
   }
   ```
2. Add provider-specific scope validators (e.g., GitHub has scopes like `github.issue.create.repo:myorg/repo1`)
3. Extend `normalize_requested_scopes()` to map action names to OAuth scopes + resource constraints
4. When app exchanges token: include resource_filters in grant context JWT payload
5. Add task-scoped token validity:
   - `valid_from`, `valid_until` in grant
   - `max_uses` counter on grant (incremented per token exchange)

**Database changes:**
- Add columns: `resource_filters` (JSON), `valid_from`, `valid_until`, `max_uses`, `use_count`
- Index on `(valid_until)` for expired grant cleanup

**API changes:**
- Session creation accepts `scopes: ["github.issue.create"]` instead of just `["issues:write"]`
- Grant context endpoint returns `{ scopes, resource_filters, valid_until, use_count, max_uses }`
- Apps use filters to validate token scope before delegating to agent

**Acceptance criteria:**
- Can request action-scoped access (e.g., "file issues in repo X only")
- Grant context includes resource constraints
- Token has max-use counter and expiration window
- Audit shows what action/resource was authorized

---

### P3: Async Token Issuance Integrated with Task Queue
**Scope:** Tie token requests into task execution flow; pause task waiting for approval/token

**Changes:**
1. Extend Task schema: add `requires_connect_grant_id` (nullable)
2. When task starts and needs a Connect token:
   - Queue a `connect.token_request` event
   - Task pauses (state: `waiting_for_grant`)
   - Wait for `connect.grant_issued` event with token
3. Task runner checks: if task needs grant and grant pending approval, don't execute—wait
4. New queue type: `connect.grants` for approval workflows
5. Webhooks for grant approval: developer can approve via webhook or dashboard

**Changes:**
- Task struct: add `connect_grant_requirements: { grant_id, approval_required? }`
- Task state machine: add `waiting_for_grant` state
- Task run endpoint: `GET /api/v1/tasks/{id}/grant_status` returns approval state
- Task webhook: include grant context if task needed a token

**Acceptance criteria:**
- Task can declare it needs a specific grant
- If grant pending approval, task waits (doesn't execute)
- Once grant approved, task resumes with token
- Audit shows task → grant approval → token → task execution sequence

---

### P4: Environment/Project Scoping
**Scope:** Allow same OAuth app across dev/staging/prod with environment-specific policies

**Changes:**
1. Add `project_id`, `environment` to grants (or create a higher-level resource like `grant_policy`)
2. When issuing token: tag it with environment it was issued in
3. Apps validate token usage: `{ valid_for_environment: "staging" }`
4. Connection can have usage policies: "this connection can only be used in staging"
5. Audit log scoped by environment

**Database changes:**
- Add columns to grants: `project_id` (FK), `environment` (enum: dev/staging/prod)
- Index on `(project_id, environment)` for environment-scoped lookups

**API changes:**
- Session creation accepts `project_id`, `environment`
- Token context includes `valid_for_environment`
- Grant context endpoint returns environment scope

**Acceptance criteria:**
- Same GitHub connection can issue tokens for different environments
- Token is tagged with environment
- Can revoke access in one environment without affecting others

---

## Implementation Order

1. **P0 first** (1-2 weeks): Makes Connect task-aware; foundation for everything else
2. **P1 next** (1 week): Approval gates; pairs with P0 for real approval workflows
3. **P2 + P3 parallel** (2-3 weeks): Scope refinement and async flow; can work in parallel
4. **P4 last** (1 week): Environment scoping; less urgent, but completes the picture

---

## Testing Strategy

### P0 Testing
- Unit: Grant creation with task_id, workflow_run_id, agent_id
- Integration: Create task, request token with task_id, verify audit trail
- Query: `GET /api/v1/connect/grants?task_id=...` returns correct grants

### P1 Testing
- Happy path: Request token → approval → finalize → get token
- Sad path: Request token → denial → error response
- Integration: Task waits for grant approval before executing

### P2 Testing
- Resource filter validation on token request
- Resource filters in grant context JWT
- Max-use counter increments on token exchange
- Expiration window enforced on token validation

### P3 Testing
- Task state machine: pending → waiting_for_grant → executing
- Grant approval event triggers task resume
- Timeout: task in waiting_for_grant too long

### P4 Testing
- Same connection, different environments, different tokens
- Cross-environment revocation prevents unintended access

---

## Strategic Rationale

These changes transform Connect from "portable login + OAuth vault" into "agentic credential layer":

- **P0** makes Connect task-aware (foundation)
- **P1** integrates with approval workflows (safety)
- **P2** enables fine-grained access control (security)
- **P3** ties token issuance to task execution (orchestration)
- **P4** supports multi-environment deployments (production reality)

Together, they answer: *"How does an agent prove it should get a token?"* → **"It's approved by a human/system via workflow, scoped to a task, resource-bound, and time-limited."**

This positions Runmesh Connect as a genuine agentic infrastructure layer, not just a credential vault.
