# Requirements Document

## Agentic Connect Layer - Requirements

## Introduction

Runmesh Connect is currently a solid, secure identity and credential layer that enables third-party apps to delegate user access without storing long-lived secrets. However, it is fundamentally app-centric and human-driven, with no primitives for autonomous agent credential requests or task-scoped token issuance.

This requirements document defines the transformation of Connect from a portable OAuth vault into an agentic credential layer. The transformation enables agents to autonomously request credentials within task execution workflows, with approval gates, scope constraints, and full audit traceability.

The scope covers foundational priorities P0 (task-aware grants) and P1 (approval integration), with architectural groundwork for P2 (resource scoping) and P3 (async task integration).

## Glossary

- **Agent**: An autonomous or semi-autonomous system that executes tasks within Runmesh; may require external credentials to perform work
- **Connect**: The credential management subsystem that brokers OAuth tokens between third-party providers (GitHub, etc.) and Runmesh applications
- **Grant**: An approval record that authorizes a Connect User to access a specific Provider Connection under defined OAuth scopes
- **Provider**: A third-party service offering (GitHub, GitLab, Jira, etc.) that Runmesh integrates with via OAuth
- **Provider Connection**: An OAuth connection between a Connect User and a Provider, established via OAuth flow; credentials stored in Runmesh
- **Task**: A unit of work in Runmesh execution; may require external credentials to complete
- **Workflow**: A collection of tasks orchestrated together; may require approvals before credential access
- **Connect User**: An identity within Runmesh tied to a verified email; represents the human or service account using Connect
- **Token**: An OAuth access token issued by a Provider and stored securely; valid for a specific Provider Connection and scopes
- **Scope**: OAuth-level permission grants (e.g., `issues:write` for GitHub) that authorize specific actions
- **Grant Record**: A database row in the `grants` table that tracks authorization, approval status, and agent/task context
- **Approval Status**: The state of a grant request: `pending_approval`, `approved`, `denied`, or `auto_approved`
- **Audit Trail**: System-level logs recording who (agent/user/task) requested what token, when, for what purpose, and with what result
- **Task-Scoped Token**: A token issued for a specific task and valid only during that task's execution window
- **Workflow Run ID**: Unique identifier for a specific execution instance of a workflow
- **Agentic Primitive**: A system or API design that allows autonomous agents to perform work with explicit consent and scope constraints

---

## Requirements

### Requirement 1: Grant Records Capture Agent and Task Context

**User Story:** As an infrastructure operator, I want Connect grant records to include agent, task, and workflow context, so that I can audit which agents used which credentials for which work.

#### Acceptance Criteria

1. WHEN a Connect token is requested, THE Connect System SHALL accept optional `task_id`, `workflow_run_id`, and `agent_id` fields in the token request body
2. WHEN a token is issued, THE Connect System SHALL store `created_by_task_id`, `created_by_workflow_run_id`, and `agent_id` (all nullable) in the grant record
3. WHEN a grant record is queried, THE Grant Record SHALL return all stored context fields (`task_id`, `workflow_run_id`, `agent_id`) in the response
4. WHEN a grant is created without agent/task context, THE Connect System SHALL accept the request (backward compatibility with existing app-driven flows)
5. WHEN a grant is created with both `task_id` and `workflow_run_id`, THE Connect System SHALL store both values without requiring one or the other
6. WHERE an agent executes a task and requests a token, THE Audit Logger SHALL log the relationship between agent, task, workflow, and token issuance

#### Rationale

Grant records must retain agent and task context so that audit queries can answer: "Which agents used this grant?" and "Which token was used to execute this task?" This is foundational for agent-aware governance and incident response.

---

### Requirement 2: Grant Records Are Indexed for Agent and Task Lookup

**User Story:** As a security operator, I want to quickly query which grants an agent or task has used, so that I can investigate unauthorized access or revoke credentials for compromised agents.

#### Acceptance Criteria

1. WHEN a query is made for grants by `task_id`, THE Database SHALL return results using an indexed lookup (no full table scans)
2. WHEN a query is made for grants by `workflow_run_id`, THE Database SHALL return results using an indexed lookup
3. WHEN a query is made for grants by `agent_id`, THE Database SHALL return results using an indexed lookup
4. WHEN an index on `task_id` is created, THE Database Migration SHALL ensure backward compatibility (new index on column with NULLs is safe)
5. WHEN the Connect System queries grants by agent_id, THE Query Latency SHALL be sub-second for typical agent portfolios (< 1000 grants per agent)

#### Rationale

Indexed lookups enable rapid investigation and remediation. Without indexing, audit queries on large datasets will be slow and operationally impractical.

---

### Requirement 3: Connect API Exposes Agent-Scoped Grant Queries

**User Story:** As a task executor, I want to query which grants are available for my agent or task, so that I can determine which tokens can be issued without making redundant requests.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/v1/connect/grants?agent_id={agent_id}`, THE Connect System SHALL return a paginated list of grants created by or authorized for that agent
2. WHEN a GET request is made to `/api/v1/connect/grants?task_id={task_id}`, THE Connect System SHALL return a paginated list of grants created by that task
3. WHEN a GET request is made to `/api/v1/connect/grants?workflow_run_id={workflow_run_id}`, THE Connect System SHALL return a paginated list of grants created by that workflow run
4. WHEN grants are filtered by agent_id, task_id, or workflow_run_id, THE Response SHALL include context fields: `task_id`, `workflow_run_id`, `agent_id`, `provider`, `scopes`, `approval_status`, and `expires_at`
5. IF a user queries grants for an agent_id they do not own, THEN THE Connect System SHALL return an authorization error (403 Forbidden)
6. WHEN the grants endpoint is queried with invalid parameters, THE Connect System SHALL return a 400 Bad Request with a descriptive error message

#### Rationale

Exposing agent/task-scoped queries allows task executors and orchestrators to reason about token availability without making blind requests. This is critical for parallel task execution and error handling.

---

### Requirement 4: Grant Requests Include Approval Status

**User Story:** As a security team member, I want Connect grants to track approval status, so that I can ensure tokens are only issued after human or policy-driven approval.

#### Acceptance Criteria

1. WHEN a grant request is created, THE Grant Record SHALL store an `approval_status` field with one of: `pending_approval`, `approved`, `denied`, or `auto_approved`
2. WHEN a grant is created with no explicit approval requirement, THE Connect System SHALL set `approval_status` to `auto_approved` (backward compatible)
3. WHEN a grant request is created with `approval_required: true`, THE Connect System SHALL set `approval_status` to `pending_approval`
4. WHEN a grant has `approval_status == pending_approval`, THEN attempting to exchange the grant for a token SHALL return status code 403 with reason `grant_pending_approval`
5. WHEN a grant is denied (status `denied`), THEN attempting to exchange the grant for a token SHALL return status code 403 with reason `grant_denied`
6. WHEN a grant has been approved, THE Grant Record SHALL store `approved_by_user_id` and `approved_at` (RFC3339 timestamp)

#### Rationale

Approval status is essential for gating token issuance. Agents cannot get credentials until explicitly approved by a human or policy engine, enforcing security boundaries in agentic workflows.

---

### Requirement 5: Approval Status Blocks Token Issuance

**User Story:** As a security operator, I want unapproved grant requests to not issue tokens, so that I can review and approve agent token requests before they are used.

#### Acceptance Criteria

1. WHEN a token is requested for a grant with `approval_status != approved` and `approval_status != auto_approved`, THE Connect System SHALL NOT issue a token
2. WHEN a token request is rejected due to pending approval, THE Response SHALL include HTTP 403 and a JSON body with `{ "error": "grant_pending_approval", "grant_id": "...", "message": "..." }`
3. WHEN a token request is rejected due to denial, THE Response SHALL include HTTP 403 and a JSON body with `{ "error": "grant_denied", "grant_id": "...", "message": "..." }`
4. WHEN a grant is in `pending_approval` status and an approval timeout occurs, THE Connect System behavior SHALL be defined by operator policy (e.g., auto-deny after 24 hours) and logged
5. WHEN a denied grant is re-requested by the same task or agent, THE Connect System SHALL create a new grant record (not reuse the denied one) to allow retry

#### Rationale

Blocking token issuance at the source prevents unauthorized access and ensures approval requirements are enforced uniformly. This is critical for maintaining security posture.

---

### Requirement 6: Grant Approval Endpoint Allows Policy-Driven Approval

**User Story:** As a security team member, I want to explicitly approve or deny grant requests, so that I can gate token access based on policy review.

#### Acceptance Criteria

1. WHEN a POST request is made to `/api/v1/connect/grants/{grant_id}/approve`, THE Connect System SHALL validate the user has approval authority
2. WHEN an approval request is made with valid authorization, THE Grant Record SHALL be updated to `approval_status = approved` with `approved_by_user_id` and `approved_at`
3. WHEN an approval request is made to an already-approved grant, THE Connect System SHALL return HTTP 409 (Conflict) with message "grant already approved"
4. WHEN a POST request is made to `/api/v1/connect/grants/{grant_id}/deny`, THE Connect System SHALL update the grant to `approval_status = denied` with `denied_by_user_id` and `denied_at`
5. WHEN a denial request includes a reason, THE Grant Record SHALL store `denial_reason` for audit purposes
6. WHEN a grant is approved, THE Audit Logger SHALL log: user_id, grant_id, approval_timestamp, and any associated task/workflow context

#### Rationale

Explicit approval endpoints enable human-in-the-loop workflows and policy enforcement. Integration with existing approval systems occurs at a higher level (task/workflow layer).

---

### Requirement 7: Token Request Integrates with Workflow Approval Context

**User Story:** As a task orchestrator, I want Connect token requests to include workflow context, so that token approval can be part of the workflow approval flow.

#### Acceptance Criteria

1. WHEN a token is requested with `workflow_run_id` set, THE Grant Record SHALL capture the workflow_run_id for audit and approval routing
2. WHEN a workflow has an approval step that gates credential access, THE Approval Step SHALL be able to identify pending Connect grants for that workflow
3. WHEN a workflow approval step approves a task, AND the task needs a Connect grant, THEN the workflow system SHALL emit an event to approve the grant (integration point)
4. WHEN a task requires a Connect grant and is queued, THE Task Queue SHALL store a reference to the pending grant_id for the task's use
5. WHERE a workflow approval system has custom rules (e.g., "approve all GitHub grants automatically for trusted workflows"), THE Connect System SHALL accept a webhook or event callback for programmatic approval

#### Rationale

Integration with workflow approval ensures that token approval is not a separate, forgotten step—it's part of the orchestration flow. This prevents approval bypass and reduces operational friction.

---

### Requirement 8: Audit Logs Record Complete Token Lifecycle

**User Story:** As a compliance officer, I want audit logs to record every step of a token's lifecycle (request, approval, issuance, usage), so that I can demonstrate compliance and investigate incidents.

#### Acceptance Criteria

1. WHEN a token is requested, THE Audit Logger SHALL record: timestamp, requester (user/agent/task), grant_id, provider, requested_scopes, approval_required flag
2. WHEN a grant is approved, THE Audit Logger SHALL record: timestamp, approver_user_id, grant_id, approval_reason (if provided)
3. WHEN a grant is denied, THE Audit Logger SHALL record: timestamp, denier_user_id, grant_id, denial_reason
4. WHEN a token is issued, THE Audit Logger SHALL record: timestamp, grant_id, token_issued_at, token_expires_at, requester context (agent/task/workflow)
5. WHEN a token is exchanged or used by an agent, THE Audit Logger SHALL log: timestamp, agent_id, task_id, grant_id, provider action (if instrumented)
6. FOR EVERY audit log entry, THE Entry SHALL include: unique log_id, ISO8601 timestamp, actor (user_id/agent_id/system), action, resource_id, result (success/failure), error_message (if failed)
7. WHEN audit logs are queried by grant_id, THE System SHALL return all related entries (request → approval/denial → issuance → usage) in chronological order

#### Rationale

Complete audit trails are non-negotiable for security, compliance, and incident response. They answer: "Who did what, when, and with what token?"

---

### Requirement 9: Grant Record Schema Evolution Does Not Break Existing Deployments

**User Story:** As a database administrator, I want schema migrations to add new agent/task/approval fields without downtime, so that I can deploy updates safely.

#### Acceptance Criteria

1. WHEN new columns (`created_by_task_id`, `created_by_workflow_run_id`, `agent_id`, `approval_status`, `approved_by_user_id`, `approved_at`) are added to the grants table, THE Columns SHALL be nullable
2. WHEN existing grants are queried after migration, THE Grants WITHOUT new data SHALL return NULL for new columns (no errors)
3. WHEN a migration adds new indexes on nullable columns, THE Migration SHALL complete without locking the grants table for extended periods (use online indexing or batch migration)
4. WHEN the Connect System is running on pre-migration code and post-migration database, THE System SHALL continue to function (backward compatibility)
5. WHEN a rollback to pre-migration code is required, THE System SHALL continue to function with the new schema (nullable columns are safe)

#### Rationale

Safe schema migrations prevent outages and allow gradual rollout. Using nullable columns ensures backward compatibility during the transition period.

---

### Requirement 10: Grant Records Support Time-Bounded Validity

**User Story:** As a security team member, I want to issue tokens with explicit expiration windows, so that I can limit the blast radius of a compromised token.

#### Acceptance Criteria

1. WHEN a grant is created, THE Grant Record SHALL support `valid_until` (RFC3339 timestamp, nullable)
2. WHEN a token is requested for a grant with `valid_until` in the past, THE Connect System SHALL return HTTP 403 with error `grant_expired`
3. WHEN a grant has not yet reached its `valid_from` time (if set), THEN token requests SHALL be rejected
4. WHEN an operator sets `valid_until` on a grant, THE Token Issuance SHALL enforce the expiration window and not issue tokens beyond that time
5. WHERE a grant has no `valid_until`, THE System SHALL use a default expiration window defined by operator policy (e.g., 24 hours)
6. WHEN a grant is queried, THE Response SHALL include `valid_from`, `valid_until`, and `seconds_until_expiration` (calculated)

#### Rationale

Time-bounded grants reduce blast radius and enable rotation policies. This is a foundation for P2 (scope refinement) and P3 (task-scoped tokens).

---

### Requirement 11: Agent Context Does Not Break Existing App-Centric Flows

**User Story:** As an existing Connect user, I want my app-centric workflows (request token, get approval from UI, use token) to continue working, so that I don't need to migrate my integration immediately.

#### Acceptance Criteria

1. WHEN a token is requested WITHOUT agent_id, task_id, or workflow_run_id, THE Connect System SHALL process the request as before (backward compatible)
2. WHEN a grant is created WITHOUT approval_required flag, THE Connect System SHALL set approval_status to `auto_approved` (no blocking)
3. WHEN the Connect System receives a token request from an existing app integration, THE System SHALL not require agent context fields
4. WHEN audit logs are viewed for grants created by app-centric flows, THE agent_id/task_id/workflow_run_id SHALL be NULL (clearly distinguished)
5. WHERE an operator wants to enforce approval for all grants (both app-centric and agent-centric), THE System SHALL support a global policy flag to apply approval_required uniformly

#### Rationale

Backward compatibility ensures existing integrations are not broken by new features. Operators can gradually migrate to agent-aware workflows without a flag-day cutover.

---

### Requirement 12: Error Responses Distinguish Between User and System Errors

**User Story:** As a task executor, I want clear error messages when token requests fail, so that I can determine if the failure is due to denial, expiration, or a system issue.

#### Acceptance Criteria

1. WHEN a token request fails due to grant denial, THE Response SHALL include HTTP 403 and error code `grant_denied` with reason
2. WHEN a token request fails due to pending approval, THE Response SHALL include HTTP 403 and error code `grant_pending_approval`
3. WHEN a token request fails due to grant expiration, THE Response SHALL include HTTP 403 and error code `grant_expired` with `valid_until` timestamp
4. WHEN a token request fails due to invalid grant_id, THE Response SHALL include HTTP 404 and error code `grant_not_found`
5. WHEN a token request fails due to invalid user context, THE Response SHALL include HTTP 401 with error code `unauthorized`
6. WHEN a token request fails due to a system error, THE Response SHALL include HTTP 500 with error code `internal_error` and a request_id for tracing
7. WHEN an error response is returned, THE Response Body SHALL include: `error` (code), `message` (human-readable), `grant_id` (if applicable), `timestamp`, and `request_id`

#### Rationale

Clear error semantics enable robust error handling in task executors and external monitoring systems. Distinguishing user vs. system errors prevents misdiagnosis.

---

### Requirement 13: Foundation for Resource-Scoped Tokens

**User Story:** As an infrastructure operator, I want Connect to support resource-scoped tokens (even if not fully implemented), so that I can plan for fine-grained access control.

#### Acceptance Criteria

1. WHEN a grant record is created, THE Schema SHALL support an optional `resource_filters` field (JSON, nullable) for future use
2. WHEN the `resource_filters` field is populated, THE Grant Record SHALL store the constraint without enforcing it (foundation for P2 implementation)
3. WHEN audit logs show a grant with `resource_filters` set, THE Operators SHALL be able to see what resource constraints were intended
4. WHERE a future implementation adds resource validation, THE Existing grants WITH `resource_filters == NULL` SHALL continue to work without modification
5. WHEN documentation is created for Connect, THE Resource Scoping Section SHALL outline the planned P2 implementation and how operators can prepare

#### Rationale

Adding the schema field now, without enforcement, allows operators to plan for and test resource-scoped workflows without waiting for full P2 implementation. This reduces later migration friction.

---

### Requirement 14: Foundation for Async Task Integration

**User Story:** As a workflow designer, I want Connect to support async token issuance (even if not fully implemented in task layer), so that tasks can wait for token approval before executing.

#### Acceptance Criteria

1. WHEN a grant is created with `approval_required: true`, THE Grant Record SHALL store a `awaiting_approval` flag (or status indicating async-capable state)
2. WHEN a task needs a token and queries Connect, THE Connect System SHALL return the grant's `approval_status` so the task can decide whether to wait
3. WHEN audit logs show a task waiting on grant approval, THE Logs SHALL clearly indicate the wait state and reason
4. WHERE a future task execution layer implements async waiting, THE Connect API SHALL emit events or webhooks for grant approval (integration point defined)
5. WHEN documentation describes the token request flow, THE Async Integration Section SHALL outline how tasks will await approval in P3 and what events will be available

#### Rationale

Designing the async flow now prevents rework later. Events and status fields are in place; task layer integration is a future step.

---

## Non-Functional Requirements

### Performance

1. WHEN a grant is queried by task_id, workflow_run_id, or agent_id, THE Query Latency SHALL be < 100ms for the 99th percentile (p99) with typical dataset sizes
2. WHEN a token is issued, THE Connect System SHALL complete the operation within 200ms (p99), including Provider API calls if needed
3. WHEN audit logs are written, THE Logging Latency SHALL not exceed 50ms (p99) to avoid blocking token issuance

### Scalability

1. WHEN the Connect System handles a spike in token requests (e.g., 1000 QPS), THE System SHALL process requests without dropped connections or timeout errors
2. WHEN database indexes are added, THE System SHALL support at least 10 million grant records without performance degradation

### Security

1. ALL Connect API Endpoints SHALL require authentication (JWT or OAuth token) and authorization (user owns the resource)
2. WHEN audit logs are created, THE Logs SHALL NOT contain OAuth tokens, API keys, or other secrets
3. WHEN grant records are queried, THE Results SHALL be filtered by user authorization (agents can only see their own grants)

### Reliability

1. WHEN a database migration fails, THE System SHALL roll back cleanly and alert operators
2. WHEN the Connect Service is restarted, THE In-Flight Grant Requests SHALL be completed or failed gracefully (no lost approvals)

### Observability

1. WHEN Connect operations occur, THE System SHALL emit structured logs (JSON) with `timestamp`, `level`, `component`, `action`, `result`, `duration_ms`
2. WHEN a grant approval occurs, THE System SHALL emit a metric event for monitoring (e.g., `connect.grant.approved`)
3. WHEN errors occur, THE System SHALL emit error metrics by error code for alerting

---

## Dependencies and Assumptions

### Dependencies

- **Database System**: PostgreSQL with support for nullable columns, indexing, and migrations (already in use by Runmesh)
- **OAuth Provider SDKs**: Existing GitHub/GitLab/Jira OAuth client libraries remain compatible
- **Audit System**: Existing Runmesh audit logging system is available for extended event recording
- **Task/Workflow System**: Task and Workflow execution layers exist and can provide task_id, workflow_run_id context

### Assumptions

1. Connect Users are already tied to verified emails and identified in the system
2. Provider Connections (OAuth tokens) are already securely stored and managed
3. The Audit Logger is already in operation for other Runmesh components
4. Operators have database access and can execute migrations
5. Agents and tasks have identifiers (agent_id, task_id) available from the orchestration layer

---

## Implementation Notes

### Schema Changes Summary

The following columns will be added to the `grants` table:

| Column | Type | Nullable | Index | Description |
|--------|------|----------|-------|-------------|
| `created_by_task_id` | TEXT | YES | YES | Task that created this grant |
| `created_by_workflow_run_id` | TEXT | YES | YES | Workflow run that created this grant |
| `agent_id` | TEXT | YES | YES | Agent authorized to use this grant |
| `approval_status` | ENUM | NO | YES | `pending_approval`, `approved`, `denied`, `auto_approved` |
| `approved_by_user_id` | TEXT | YES | NO | User who approved the grant |
| `approved_at` | TIMESTAMPTZ | YES | NO | Timestamp of approval |
| `denied_by_user_id` | TEXT | YES | NO | User who denied the grant |
| `denied_at` | TIMESTAMPTZ | YES | NO | Timestamp of denial |
| `denial_reason` | TEXT | YES | NO | Reason for denial |
| `valid_from` | TIMESTAMPTZ | YES | NO | Token valid from time |
| `valid_until` | TIMESTAMPTZ | YES | YES | Token valid until time |
| `resource_filters` | JSONB | YES | NO | Resource constraints (P2 foundation) |

### New API Endpoints

1. `GET /api/v1/connect/grants?agent_id={agent_id}` - Query grants by agent
2. `GET /api/v1/connect/grants?task_id={task_id}` - Query grants by task
3. `GET /api/v1/connect/grants?workflow_run_id={workflow_run_id}` - Query grants by workflow
4. `POST /api/v1/connect/grants/{grant_id}/approve` - Approve a grant
5. `POST /api/v1/connect/grants/{grant_id}/deny` - Deny a grant

### Existing Endpoint Changes

1. `POST /api/v1/connect/token` - Extended to accept optional `task_id`, `workflow_run_id`, `agent_id`, `approval_required`
2. Grant context endpoints updated to return new fields

---

## Success Metrics

1. **Adoption**: Percentage of new grant requests that include agent_id or task_id (target: 80% within 3 months)
2. **Approval Coverage**: Percentage of grants created with `approval_required: true` (target: 100% for agent-driven flows)
3. **Audit Completeness**: Percentage of token usage events with full audit trail (target: 99.9%)
4. **Query Performance**: Grant lookups by agent_id/task_id latency p99 < 100ms (target: maintain as volume grows)
5. **Backward Compatibility**: Zero breaking changes to existing app-centric integrations (target: 100%)

---

## Open Questions for Stakeholder Review

1. **Default Approval Policy**: Should new grants default to `approval_required: true` or `auto_approved`? (Recommend: `auto_approved` for backward compatibility, with operator flag to enforce approval)
2. **Approval Authority**: Who (users, roles, service accounts) can approve grants? (Recommend: Operators define approval roles; initially any user with admin role)
3. **Timeout Policy**: If a grant is pending approval and expires without action, should it auto-deny or stay pending? (Recommend: Configurable; default to auto-deny after 7 days with operator notification)
4. **Audit Retention**: How long should audit logs be retained? (Recommend: At least 1 year for compliance; configurable by operator)
5. **Resource Scoping Priority**: Should P2 (resource-scoped tokens) be prioritized earlier if certain use cases demand it? (Recommend: Re-evaluate after P0/P1 stabilize)
