# Agentic Connect Layer - Implementation Task List

## Overview

This task list breaks down P0 (task-aware grants) and P1 (approval integration) into 30 discrete, implementable tasks across 6 phases. Each task has clear acceptance criteria, dependencies, and rollback procedures.

**Timeline**: 4 weeks (1 week per phase, with overlap)
**Risk Level**: Low (zero-downtime migration, backward compatible, feature flags)
**Success Criteria**: Agents can request tokens with task/workflow context; tokens are approval-gated; complete audit trail; existing flows unaffected

---

## Phase 1: Database Foundation (Week 1)

### Task 1.1: Create Database Migration for Agentic Context Columns

**Description**: Add 13 new columns to the `grants` table for agent/task/workflow context, approval status, and time-bounded validity. All columns are nullable for backward compatibility.

**Acceptance Criteria**:
- Migration creates columns: `created_by_task_id`, `created_by_workflow_run_id`, `agent_id`, `approval_status`, `approved_by_user_id`, `approved_at`, `denied_by_user_id`, `denied_at`, `denial_reason`, `valid_from`, `valid_until`, `resource_filters`
- All columns are nullable (DEFAULT NULL)
- `approval_status` has DEFAULT 'auto_approved' for backward compatibility
- Migration runs on PostgreSQL 12+ without errors
- Migration is idempotent (safe to re-run)
- Existing grant records unaffected

**Dependencies**: None (first task)

**Effort**: Small

**Files Modified/Created**:
- `runmesh-main/migrations/0013_agentic_connect_context.sql` (new)

**Test Coverage**:
- Unit: Migration runs without errors, creates all columns with correct types
- Integration: Old code + new schema; existing queries work
- Edge case: Migration re-runs idempotently

**Rollback**: 
```sql
DROP TABLE connect_grants_backup;
ALTER TABLE grants DROP COLUMN created_by_task_id, DROP COLUMN created_by_workflow_run_id, ...;
```

---

### Task 1.2: Create Indexes for Agent/Task/Workflow Grant Queries

**Description**: Create 8 strategic indexes on the new columns to enable indexed lookups for agent/task/workflow scoped queries. Use `CONCURRENTLY` to avoid table locks.

**Acceptance Criteria**:
- Indexes created concurrently (no table locks, zero downtime)
- Partial indexes on nullable columns (WHERE column IS NOT NULL)
- Composite indexes for common user + agent/task/workflow patterns
- Indexes: `idx_grants_task_id`, `idx_grants_workflow_run_id`, `idx_grants_agent_id`, `idx_grants_approval_status`, `idx_grants_valid_until`, `idx_grants_user_agent`, `idx_grants_user_task`, `idx_grants_user_workflow`
- Query plans use indexes (verified with EXPLAIN)

**Dependencies**: Task 1.1 (columns must exist)

**Effort**: Small

**Files Modified/Created**:
- `runmesh-main/migrations/0013_agentic_connect_context.sql` (append to migration)

**Test Coverage**:
- Unit: All indexes created successfully
- Integration: EXPLAIN ANALYZE shows index usage (no sequential scans)
- Performance: Query latency < 100ms p99 on staging dataset

**Rollback**: 
```sql
DROP INDEX CONCURRENTLY idx_grants_task_id, idx_grants_workflow_run_id, ...;
```

---

### Task 1.3: Validate Backward Compatibility - Old Code + New Schema

**Description**: Deploy pre-migration service code against post-migration database to verify existing queries and logic continue to work without modification.

**Acceptance Criteria**:
- Old service code (without agent/task context handling) runs against new schema
- All existing grant queries work (SELECT * FROM grants returns results)
- Token exchange works (no approval status check, defaults to auto_approved)
- New columns return NULL in old code (gracefully ignored)
- Existing test suite passes

**Dependencies**: Task 1.1, 1.2

**Effort**: Small

**Files Modified/Created**: None (testing only)

**Test Coverage**:
- Integration: Spawn old service version against new schema; run full test suite
- Smoke test: Create grant, query grant, exchange token

**Rollback**: N/A (testing only)

---

### Task 1.4: Deploy Database Migration to Staging

**Description**: Run the schema migration on staging environment and validate zero downtime, no locks, index creation.

**Acceptance Criteria**:
- Migration runs in production-like staging environment
- No table locks; concurrent index creation works
- Migration duration < 5 minutes
- Old and new code both work against new schema
- No data loss; all existing grants unchanged

**Dependencies**: Task 1.1, 1.2, 1.3

**Effort**: Small

**Files Modified/Created**: None (operational)

**Test Coverage**:
- Operational: Monitor pg_stat_activity, index creation progress
- Verification: Query count before/after; audit trail unaffected

**Rollback**: 
```bash
psql runmesh-db -c "ROLLBACK;" # if in transaction
# OR manually drop columns if committed
```

---

### Task 1.5: Deploy Database Migration to Production

**Description**: Execute the schema migration on production database with full monitoring, rollback plan on standby.

**Acceptance Criteria**:
- Migration successful; all columns created, indexes built
- Zero downtime during migration (concurrent indexing used)
- Monitoring dashboards show no impact on query latency
- On-call team monitoring; rollback plan at ready
- Rollback time < 15 minutes if needed

**Dependencies**: Task 1.4 (tested on staging first)

**Effort**: Small

**Files Modified/Created**: None (operational)

**Test Coverage**:
- Operational: Full observability (metrics, logs, query performance)
- Smoke test: Immediately after migration, verify existing queries work

**Rollback**: Same as Task 1.4 but on production

---

## Phase 2: Service Layer Core (Week 2)

### Task 2.1: Extend ConnectGrantModel with Agent/Task Context Methods

**Description**: Add methods to `ConnectGrantModel` to store and retrieve agent/task/workflow context. Methods: `create()` (extended), `find_by_agent_id()`, `find_by_task_id()`, `find_by_workflow_run_id()`.

**Acceptance Criteria**:
- `create()` accepts optional `created_by_task_id`, `created_by_workflow_run_id`, `agent_id` in payload
- Method stores all fields in grant record (NULL if not provided)
- `find_by_agent_id()`, `find_by_task_id()`, `find_by_workflow_run_id()` use indexed lookups
- Methods return paginated results with limit/offset
- All methods filter by `connect_user_id` (authorization)
- Methods handle NULL context gracefully (backward compatible)

**Dependencies**: Task 1.5 (database schema live)

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/src/db/connect_orm.py` (extend ConnectGrantModel class)

**Test Coverage**:
- Unit: Create grant with/without context; verify storage
- Unit: Query by agent/task/workflow; verify pagination
- Integration: Authorization (user can only see own grants)
- Performance: Query latency on staged dataset

**Rollback**: Revert file changes; schema columns remain but unused

---

### Task 2.2: Implement Grant Approval/Denial Methods

**Description**: Add methods to `ConnectGrantModel` to approve and deny grants. Methods: `approve_grant()`, `deny_grant()`, with metadata storage (approver, timestamp, reason).

**Acceptance Criteria**:
- `approve_grant(grant_id, approved_by_user_id, reason)` updates grant to `approval_status = 'approved'`
- `deny_grant(grant_id, denied_by_user_id, reason)` updates grant to `approval_status = 'denied'`
- Both store timestamp (RFC3339) and approver/denier user_id
- Idempotent: Approving already-approved grant raises `grant_already_approved` error
- Deny can only deny `pending_approval` grants (raises error otherwise)
- Methods emit events for downstream systems (foundation for P5)

**Dependencies**: Task 2.1

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/src/db/connect_orm.py` (add methods)

**Test Coverage**:
- Unit: Approve pending grant; verify status/timestamp/approver
- Unit: Deny grant; verify status/timestamp/denier/reason
- Unit: Idempotent approval (error on re-approve)
- Unit: Can't approve denied grant

**Rollback**: Revert file changes

---

### Task 2.3: Implement Token Request Validation with Approval Status Gate

**Description**: Extend the token exchange flow to check `approval_status` before issuing token. If `pending_approval` or `denied`, reject with HTTP 403.

**Acceptance Criteria**:
- Token request checks grant's `approval_status`
- `auto_approved` → token issued immediately
- `approved` → token issued immediately
- `pending_approval` → HTTP 403 with error code `grant_pending_approval`
- `denied` → HTTP 403 with error code `grant_denied` with denial_reason
- Existing flows (no approval_status check) continue to work (defaults to auto_approved)
- Approval status check happens before OAuth provider call (fail fast)

**Dependencies**: Task 2.2

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/src/services/connect.py` (extend exchange_connect_token function)

**Test Coverage**:
- Unit: Auto-approved grant → token issued
- Unit: Approved grant → token issued
- Unit: Pending approval grant → 403 error
- Unit: Denied grant → 403 error with reason
- Integration: App-centric flow (no approval) still works

**Rollback**: Revert file changes; existing grants all have approval_status='auto_approved'

---

### Task 2.4: Implement Time-Bounded Validity Checks

**Description**: Add validation for `valid_from` and `valid_until` in token request flow. Reject tokens outside validity window.

**Acceptance Criteria**:
- Token request checks `valid_from` (if set): reject with 403 if NOW() < valid_from
- Token request checks `valid_until` (if set): reject with 403 if NOW() > valid_until
- Default `valid_until` applied at grant creation time (24 hours if not specified)
- Error responses include timestamp information for debugging
- Validity window check happens before approval status check

**Dependencies**: Task 2.1 (columns exist)

**Effort**: Small

**Files Modified/Created**:
- `runmesh-main/src/services/connect.py` (add validity window checks)

**Test Coverage**:
- Unit: Grant not yet valid (valid_from in future) → 403
- Unit: Grant expired (valid_until in past) → 403
- Unit: Grant within validity window → proceeds to approval check
- Unit: Default validity window applied at creation

**Rollback**: Revert file changes

---

## Phase 3: API Exposure (Week 2-3)

### Task 3.1: Extend POST /api/v1/connect/token Endpoint

**Description**: Extend the token request endpoint to accept optional `task_id`, `workflow_run_id`, `agent_id`, `approval_required`, `valid_from`, `valid_until` in request body.

**Acceptance Criteria**:
- Request body accepts new fields (all optional, nullable)
- Validation: `task_id`, `workflow_run_id`, `agent_id` must be non-empty strings if provided
- Validation: `valid_until`, `valid_from` must be RFC3339 timestamps if provided
- Response echoes back `task_id`, `workflow_run_id`, `agent_id`, `approval_status`, `valid_from`, `valid_until`, `seconds_until_expiration`
- Backward compatible: existing requests without new fields work unchanged
- Request/response DTOs updated in `src/utils/types.py`

**Dependencies**: Task 2.1, 2.3, 2.4

**Effort**: Small

**Files Modified/Created**:
- `runmesh-main/src/entry.py` (extend endpoint handler)
- `runmesh-main/src/utils/types.py` (extend ConnectTokenRequest/Response DTOs)

**Test Coverage**:
- Unit: Token request with task_id → request accepted, response echoes task_id
- Unit: Token request with task_id + workflow_run_id → both stored and returned
- Unit: Token request without agentic context → backward compatible
- Integration: Old code can still call endpoint (new fields ignored)

**Rollback**: Revert file changes

---

### Task 3.2: Implement GET /api/v1/connect/grants Query Endpoint

**Description**: Create new endpoint to query grants by agent_id, task_id, or workflow_run_id with pagination. Authorization: user can only see own grants.

**Acceptance Criteria**:
- Endpoint: `GET /api/v1/connect/grants?agent_id={agent_id}&page=1&limit=50`
- Also supports `task_id` and `workflow_run_id` as query parameters
- At least one of `agent_id`, `task_id`, `workflow_run_id` must be provided (400 if not)
- Response includes all grant fields: `id`, `provider`, `scopes`, `approval_status`, `agent_id`, `created_by_task_id`, `created_by_workflow_run_id`, `created_at`, `expires_at`, `valid_from`, `valid_until`, `approved_at`, `approved_by_user_id`, `seconds_until_expiration`
- Authorization: 403 if user doesn't own the queried grants
- Pagination: `page`, `limit`, `total`, `pages` in response meta
- Uses indexed queries (< 100ms p99 latency)

**Dependencies**: Task 2.1, 2.2

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/src/entry.py` (new endpoint handler)
- `runmesh-main/src/utils/types.py` (new GrantQueryRequest/Response DTOs)

**Test Coverage**:
- Unit: Query by agent_id → returns agent's grants only
- Unit: Query by task_id → returns task's grants only
- Unit: Query by workflow_run_id → returns workflow's grants only
- Unit: Unauthorized user → 403
- Unit: No filter provided → 400
- Performance: Query latency < 100ms on staged dataset
- Integration: Pagination works (total, page, pages correct)

**Rollback**: Revert file changes

---

### Task 3.3: Implement POST /api/v1/connect/grants/{id}/approve Endpoint

**Description**: Create endpoint to approve a pending grant. Updates grant status, stores approver metadata, emits event.

**Acceptance Criteria**:
- Endpoint: `POST /api/v1/connect/grants/{grant_id}/approve`
- Request body: `{ "reason": "...", "approved_by": "user_id" }`
- Authorization: JWT user with admin role can approve (configurable)
- Updates grant: `approval_status = 'approved'`, `approved_by_user_id`, `approved_at`
- Idempotent: Re-approving returns 409 (Conflict) with message "grant already approved"
- Can't approve denied grant: returns 403 with message "grant already denied"
- Response includes updated grant with new approval status
- Emits event `grant.approved` for workflow approval system (foundation for P5)

**Dependencies**: Task 2.2

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/src/entry.py` (new endpoint handler)
- `runmesh-main/src/utils/types.py` (new GrantApprovalRequest/Response DTOs)

**Test Coverage**:
- Unit: Approve pending grant → status updated, timestamp stored, approver recorded
- Unit: Approve already-approved grant → 409 error
- Unit: Approve denied grant → 403 error
- Unit: Non-admin user → 403 error
- Unit: Grant not found → 404 error

**Rollback**: Revert file changes

---

### Task 3.4: Implement POST /api/v1/connect/grants/{id}/deny Endpoint

**Description**: Create endpoint to deny a pending grant. Updates grant status, stores denier metadata and reason, emits event.

**Acceptance Criteria**:
- Endpoint: `POST /api/v1/connect/grants/{grant_id}/deny`
- Request body: `{ "reason": "...", "denied_by": "user_id" }`
- Authorization: JWT user with admin role can deny (configurable)
- Updates grant: `approval_status = 'denied'`, `denied_by_user_id`, `denied_at`, `denial_reason`
- Can deny `pending_approval` or `auto_approved` (proactive denial)
- Can't deny already-denied grant: returns error
- Response includes updated grant with denial info
- Emits event `grant.denied` for downstream systems

**Dependencies**: Task 2.2

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/src/entry.py` (new endpoint handler)
- `runmesh-main/src/utils/types.py` (new GrantDenialRequest/Response DTOs)

**Test Coverage**:
- Unit: Deny pending grant → status updated, reason stored, denier recorded
- Unit: Deny auto-approved grant (proactive) → status updated
- Unit: Deny already-denied grant → error
- Unit: Non-admin user → 403 error
- Unit: Grant not found → 404 error

**Rollback**: Revert file changes

---

### Task 3.5: Implement Error Response Standardization

**Description**: Standardize all error responses from new endpoints with consistent error codes, messages, and contextual information.

**Acceptance Criteria**:
- Error codes defined: `grant_pending_approval`, `grant_denied`, `grant_expired`, `grant_not_found`, `grant_not_yet_valid`, `unauthorized`, `invalid_parameters`, `grant_already_approved`, `grant_already_denied`, `internal_error`
- All error responses include: `ok: false`, `error` (code), `message`, `grant_id` (if applicable), `request_id` (for tracing), `timestamp`
- HTTP status codes: 403 for user errors, 404 for not found, 409 for conflict, 400 for validation, 500 for system
- Additional fields in `details` object for contextual info (valid_until, denial_reason, etc.)
- Error responses follow JSON schema for tooling

**Dependencies**: Task 3.1, 3.2, 3.3, 3.4

**Effort**: Small

**Files Modified/Created**:
- `runmesh-main/src/utils/types.py` (define error response schemas)
- `runmesh-main/src/utils/errors.py` (new error handler utilities)

**Test Coverage**:
- Unit: Each error code produces correct HTTP status and response format
- Unit: Error responses include all required fields
- Integration: Error responses consistent across all Connect endpoints

**Rollback**: Revert file changes

---

## Phase 4: Audit & Observability (Week 3)

### Task 4.1: Extend Audit Event Structure with Agentic Context

**Description**: Add agent/task/workflow context fields to audit events. Extend `ConnectAuditEventCreate` DTO to capture `agent_id`, `task_id`, `workflow_run_id`.

**Acceptance Criteria**:
- Audit event DTO includes: `agent_id`, `task_id`, `workflow_run_id` (all optional)
- Audit events for token requests include: action, timestamp, requester, grant_id, scopes, approval_required, result
- Audit events for approvals include: action, approver, grant_id, approval_reason, timestamp
- Audit events for denials include: action, denier, grant_id, denial_reason, timestamp
- Audit events for token issuance include: grant_id, agent_id, task_id, token_issued_at, token_expires_at
- All audit entries include: unique log_id, ISO8601 timestamp, actor, action, resource_id, result, error_message (if failed)

**Dependencies**: Task 2.1

**Effort**: Small

**Files Modified/Created**:
- `runmesh-main/src/db/connect_audit_orm.py` (extend DTO and model)

**Test Coverage**:
- Unit: Audit event created with agent/task context fields
- Unit: Audit event stored in database with all fields
- Unit: NULL context fields handled gracefully

**Rollback**: Revert file changes

---

### Task 4.2: Implement Token Lifecycle Audit Logging

**Description**: Log every action in the token lifecycle: grant request, approval, denial, token issuance. Each action creates an audit entry with full context.

**Acceptance Criteria**:
- Grant request logged: action=`grant.requested`, includes task_id, workflow_run_id, agent_id, scopes, approval_required
- Grant approval logged: action=`grant.approved`, includes approver, approval_reason, timestamp
- Grant denial logged: action=`grant.denied`, includes denier, denial_reason, timestamp
- Token issuance logged: action=`token.issued`, includes agent_id, task_id, token issued/expiry times
- All audit entries linked by grant_id for complete lifecycle query
- Audit logging non-blocking (asynchronous if possible)

**Dependencies**: Task 4.1, Task 2.1, 2.2, 2.3

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/src/services/connect.py` (add audit logging calls after each action)

**Test Coverage**:
- Unit: Each action generates correct audit entry
- Unit: Audit entries queryable by grant_id in chronological order
- Integration: Full token lifecycle produces 3-4 audit entries

**Rollback**: Revert file changes; audit entries remain for historical record

---

### Task 4.3: Implement Audit Query Patterns

**Description**: Create helper functions for common audit investigation queries: "all tokens used by agent", "pending approvals", "investigate compromised agent".

**Acceptance Criteria**:
- Query helper: Find all tokens issued to/used by agent_id (SQL query provided)
- Query helper: Find all grants pending approval in last 24 hours
- Query helper: Find all audit events for a compromised agent (with timeline)
- Query helpers available in `src/services/connect_queries.py`
- Queries use indexed lookups for performance

**Dependencies**: Task 4.2

**Effort**: Small

**Files Modified/Created**:
- `runmesh-main/src/services/connect_queries.py` (new file with query helpers)

**Test Coverage**:
- Unit: Each query helper returns expected results on test dataset
- Performance: Queries execute in < 200ms on staged dataset

**Rollback**: Revert file changes

---

### Task 4.4: Create Monitoring Metrics and Dashboards

**Description**: Emit structured metrics for adoption, approval activity, token issuance, and query performance. Create Grafana/CloudWatch dashboards for observability.

**Acceptance Criteria**:
- Metrics emitted:
  - `connect.grant.request.with_agent_context` (gauge, %)
  - `connect.grant.request.with_task_context` (gauge, %)
  - `connect.grant.pending_approval.count` (gauge)
  - `connect.grant.approval.latency_seconds` (histogram)
  - `connect.grant.approval.rate` (counter)
  - `connect.grant.denial.rate` (counter)
  - `connect.token.issue.latency_seconds` (histogram)
  - `connect.token.issue.blocked_by_approval` (counter)
  - `connect.token.issue.blocked_by_expiration` (counter)
  - `connect.grant.query.latency_seconds` (histogram)
- Dashboards created:
  - Adoption (% agentic context in requests)
  - Approval Queue (pending grants, latency trends)
  - Error Dashboard (rejection rates by reason)
  - Performance Dashboard (query latencies, index usage)

**Dependencies**: Task 2.1, 3.1, 3.2, 3.3, 3.4, 4.2

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/src/services/connect.py` (add metric emission)
- `docs/monitoring/connect-metrics.md` (new)
- Grafana dashboard definitions (new, JSON)

**Test Coverage**:
- Integration: Metrics emitted correctly for each action
- Operational: Dashboards display correct data on staging

**Rollback**: Revert file changes; metrics stop being emitted but system continues

---

### Task 4.5: Implement Audit Log Retention and Cleanup Policy

**Description**: Define audit log retention policy (e.g., 1 year), implement automated cleanup, alert on breach.

**Acceptance Criteria**:
- Retention policy: 1 year for audit logs (configurable)
- Automated cleanup job: Deletes audit logs older than retention period
- Job runs daily; no user-facing impact
- Alert if cleanup fails or retention breached
- Compliance: Documentation of retention policy for auditors

**Dependencies**: Task 4.2

**Effort**: Small

**Files Modified/Created**:
- `runmesh-main/scripts/cleanup_audit_logs.py` (new)
- `runmesh-main/README.md` (update with retention policy)

**Test Coverage**:
- Unit: Cleanup job correctly identifies logs to delete
- Integration: Cleanup doesn't affect recent logs

**Rollback**: Disable cleanup job; restore from backup if needed

---

## Phase 5: Integration & Events (Week 3-4)

### Task 5.1: Implement Event Emission for Grant Lifecycle

**Description**: Emit events at key lifecycle points: grant.pending_approval, grant.approved, grant.denied. Events available for workflow approval system and task execution layer to consume.

**Acceptance Criteria**:
- Events emitted:
  - `grant.pending_approval`: when grant created with approval_required=true
  - `grant.approved`: when grant approved via approval endpoint
  - `grant.denied`: when grant denied via denial endpoint
- Event payload includes: grant_id, agent_id, task_id, workflow_run_id, provider, scopes, approver/denier info
- Events delivered to registered webhooks (foundation for P3 async)
- Events non-blocking (async delivery)
- Event delivery retries with exponential backoff

**Dependencies**: Task 2.2, 3.3, 3.4

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/src/services/connect.py` (add event emission)
- `runmesh-main/src/services/webhooks.py` (extend webhook delivery)

**Test Coverage**:
- Unit: Events emitted with correct payload at correct time
- Integration: Webhook receives event correctly
- Integration: Failed delivery retries (backoff tested)

**Rollback**: Disable event emission; system continues without external integrations

---

### Task 5.2: Create Workflow Approval System Integration Point

**Description**: Define integration point for workflow approval system to listen to grant lifecycle events and auto-approve/deny based on workflow policy.

**Acceptance Criteria**:
- Integration point: Workflow approval system receives `grant.pending_approval` event
- Workflow system evaluates policy (e.g., "trusted workflows auto-approve")
- Workflow system calls `/api/v1/connect/grants/{id}/approve` or `/deny` based on decision
- Example implementation provided in pseudocode/docs
- No changes to Connect required (event emission sufficient)

**Dependencies**: Task 5.1

**Effort**: Small

**Files Modified/Created**:
- `docs/integration/workflow-approval-system.md` (new)

**Test Coverage**:
- Integration: Workflow system receives event and makes approval decision
- End-to-end: Grant approved by workflow system, token then available

**Rollback**: Workflow system stops listening; grants require manual approval

---

### Task 5.3: Create Task Execution Layer Integration Example

**Description**: Provide example code showing how task execution layer queries available grants and checks approval status before task execution.

**Acceptance Criteria**:
- Example code shows: Query grants by task_id before execution
- Example shows: Check approval_status (pending → wait/fail, denied → fail, approved → proceed)
- Example shows: Exchange grant for token and pass to task
- Documentation: Flow diagram, pseudocode, integration points
- No changes to Connect required (queries sufficient)

**Dependencies**: Task 3.2

**Effort**: Small

**Files Modified/Created**:
- `docs/integration/task-execution-layer.md` (new)

**Test Coverage**:
- Documentation: Code examples are valid and runnable
- Walkthrough: End-to-end flow from task to token to task execution

**Rollback**: N/A (documentation only)

---

### Task 5.4: Implement Feature Flags for Approval Enforcement

**Description**: Add feature flags to control approval enforcement without code re-deployment. Operators can toggle approval_required globally or per-workflow.

**Acceptance Criteria**:
- Feature flag: `approval_required_for_all_grants` (global, default: false)
- Feature flag: Can be toggled via admin API without re-deployment
- When enabled: New grants default to approval_required=true
- When disabled: New grants default to approval_required=false (backward compatible)
- Per-workflow override: Can specify approval_required in workflow config
- Rollback: Disable flag to revert to non-approval behavior

**Dependencies**: Task 3.1, 3.3, 3.4

**Effort**: Small

**Files Modified/Created**:
- `runmesh-main/src/config.py` (add feature flag definitions)
- `runmesh-main/src/services/connect.py` (check feature flags)
- `runmesh-main/src/entry.py` (admin endpoint to toggle flags)

**Test Coverage**:
- Unit: Feature flag read correctly; affects grant creation
- Integration: Toggle flag via admin API; behavior changes
- Rollback: Disable flag → grants auto-approved again

**Rollback**: Revert to pre-flag version or manually disable flag

---

### Task 5.5: Implement Webhook Endpoint for External Approval Systems

**Description**: Create a webhook endpoint where external approval systems can register and receive grant lifecycle events. Document webhook format.

**Acceptance Criteria**:
- Endpoint: `POST /api/v1/connect/webhooks/register`
- Request: `{ "url": "...", "secret": "...", "events": ["grant.pending_approval", ...] }`
- Webhook delivery: POST to registered URL with HMAC signature (for verification)
- Webhook payload: Event type, grant data, timestamp, request_id
- Webhook retries: Exponential backoff up to 3 attempts over 24 hours
- Webhook management: GET (list), DELETE (unregister)

**Dependencies**: Task 5.1

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/src/entry.py` (new webhook endpoints)
- `runmesh-main/src/services/webhooks.py` (webhook delivery with retries)

**Test Coverage**:
- Unit: Webhook registered correctly
- Integration: Event delivers to registered webhook with correct signature
- Integration: Retries work on failed delivery
- Security: HMAC signature verified before accepting webhook

**Rollback**: Disable webhook delivery; system continues with internal events only

---

## Phase 6: Testing & Validation (Week 4)

### Task 6.1: Unit Tests - Grant Model Operations

**Description**: Comprehensive unit tests for all grant model methods: create, query, approve, deny, with/without context.

**Acceptance Criteria**:
- Tests cover all methods in ConnectGrantModel
- Tests verify grant creation with/without agentic context
- Tests verify indexed queries (agent_id, task_id, workflow_run_id)
- Tests verify approval/denial with idempotency
- Tests verify authorization (user can only see own grants)
- Tests verify NULL context handling (backward compatibility)
- Test coverage: > 90%

**Dependencies**: Task 2.1, 2.2

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/tests/unit/test_connect_grant_model.py` (new)

**Test Coverage**:
- 30+ unit tests covering all code paths

**Rollback**: N/A (tests don't affect production)

---

### Task 6.2: Unit Tests - Token Validation and Approval Gates

**Description**: Unit tests for token request validation, approval status blocking, validity window enforcement.

**Acceptance Criteria**:
- Tests verify approval_status gate (auto_approved → token, pending_approval → 403, denied → 403)
- Tests verify validity window checks (valid_from, valid_until)
- Tests verify default validity window applied
- Tests verify error responses with correct HTTP codes and error codes
- Tests verify backward compatibility (requests without approval_required work)
- Test coverage: > 90%

**Dependencies**: Task 2.3, 2.4

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/tests/unit/test_connect_token_validation.py` (new)

**Test Coverage**:
- 25+ unit tests covering all validation scenarios

**Rollback**: N/A

---

### Task 6.3: Unit Tests - API Endpoints

**Description**: Unit tests for all new endpoints: query, approve, deny, with proper authorization and error handling.

**Acceptance Criteria**:
- Tests verify query endpoint filtering (agent_id, task_id, workflow_run_id)
- Tests verify query endpoint authorization (403 for non-owned grants)
- Tests verify pagination (page, limit, total, pages)
- Tests verify approve endpoint idempotency (409 on re-approve)
- Tests verify deny endpoint authorization
- Tests verify error response format for all error codes
- Test coverage: > 90%

**Dependencies**: Task 3.1, 3.2, 3.3, 3.4

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/tests/unit/test_connect_endpoints.py` (new)

**Test Coverage**:
- 40+ unit tests covering all endpoints and error cases

**Rollback**: N/A

---

### Task 6.4: Unit Tests - Audit Logging

**Description**: Unit tests for audit event creation, logging, and query patterns.

**Acceptance Criteria**:
- Tests verify audit event created for each lifecycle action
- Tests verify audit events include agentic context
- Tests verify audit events linked by grant_id
- Tests verify query patterns return expected results
- Tests verify audit logging non-blocking
- Test coverage: > 90%

**Dependencies**: Task 4.1, 4.2, 4.3

**Effort**: Small

**Files Modified/Created**:
- `runmesh-main/tests/unit/test_connect_audit.py` (new)

**Test Coverage**:
- 20+ unit tests covering audit operations

**Rollback**: N/A

---

### Task 6.5: Integration Tests - App-Centric Flow (Backward Compatibility)

**Description**: End-to-end test of existing app-centric flow to verify backward compatibility. Old flow must work unchanged.

**Acceptance Criteria**:
- App creates session (existing flow)
- User consents via OAuth (existing flow)
- Grant record created (existing flow)
- Token request works (no agent context, no approval gate)
- Token issued immediately (approval_status = auto_approved)
- Old code + new schema = existing behavior
- No breaking changes

**Dependencies**: Task 1.5, 2.1, 3.1

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/tests/integration/test_backward_compatibility.py` (new)

**Test Coverage**:
- 1 comprehensive end-to-end flow test

**Rollback**: If test fails, investigate schema/code changes breaking compatibility

---

### Task 6.6: Integration Tests - Agent-Driven Flow with Approval

**Description**: End-to-end test of new agent-driven flow with approval gates.

**Acceptance Criteria**:
- Agent requests token with task_id, workflow_run_id, agent_id
- Grant created with approval_status = pending_approval
- Token request blocked (403)
- Approval endpoint called → grant approved
- Token request succeeds
- Token issued with context
- Audit trail shows full lifecycle

**Dependencies**: Task 2.1, 3.1, 3.2, 3.3

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/tests/integration/test_agent_driven_flow.py` (new)

**Test Coverage**:
- 1 comprehensive end-to-end flow test with approval

**Rollback**: N/A

---

### Task 6.7: Integration Tests - Event Emission and External System Integration

**Description**: Test event emission and external system (workflow approval) integration.

**Acceptance Criteria**:
- Grant created with approval_required → event emitted
- External system receives event
- External system calls approve endpoint
- Grant approved, event emitted again
- Token now available
- Full flow: grant → pending_approval event → external approval → token

**Dependencies**: Task 5.1, 5.2

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/tests/integration/test_event_integration.py` (new)

**Test Coverage**:
- 1 comprehensive integration test with external system

**Rollback**: N/A

---

### Task 6.8: Performance Tests - Query Latency

**Description**: Performance test to verify query latency meets requirements (< 100ms p99 for indexed queries).

**Acceptance Criteria**:
- Generate test dataset: 10K grants with distributed agent/task/workflow IDs
- Query by agent_id: measure latency, verify < 100ms p99
- Query by task_id: measure latency, verify < 100ms p99
- Query by workflow_run_id: measure latency, verify < 100ms p99
- Verify indexes are used (EXPLAIN ANALYZE shows index scan)
- Document performance results

**Dependencies**: Task 1.2, 2.1, 3.2

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/tests/performance/test_query_latency.py` (new)

**Test Coverage**:
- Performance test with realistic dataset size

**Rollback**: If queries too slow, add composite indexes or partition strategy

---

### Task 6.9: Performance Tests - Token Issuance Latency

**Description**: Performance test to verify token issuance latency (< 200ms p99).

**Acceptance Criteria**:
- Generate test scenario: Approve grant, request token, measure latency
- Test with/without provider API call (cache vs. fresh token)
- Latency includes: approval check, validity check, OAuth call, response
- Verify < 200ms p99 for complete flow
- Document performance results

**Dependencies**: Task 2.3, 2.4

**Effort**: Small

**Files Modified/Created**:
- `runmesh-main/tests/performance/test_token_issuance_latency.py` (new)

**Test Coverage**:
- Performance test with typical token request flow

**Rollback**: If too slow, investigate bottleneck (OAuth provider, DB, computation)

---

### Task 6.10: Migration Testing - Schema and Rollback

**Description**: Full migration testing: apply migration, verify backward compatibility, execute rollback, verify safety.

**Acceptance Criteria**:
- Test environment: PostgreSQL 12+
- Apply migration: No errors, no locks, indexes created
- Backward compat: Old code runs against new schema
- Data integrity: Grants unchanged, queries return same results
- Rollback: Drop indexes/columns safely
- Post-rollback: Old code still works
- Document migration procedure and rollback steps

**Dependencies**: Task 1.1, 1.2, 1.3

**Effort**: Medium

**Files Modified/Created**:
- `runmesh-main/tests/integration/test_migration.py` (new)

**Test Coverage**:
- Migration test with full rollback scenario

**Rollback**: Migration rollback procedure documented and tested

---

### Task 6.11: Deployment Readiness Validation

**Description**: Final validation checklist before production deployment: all tests pass, documentation complete, monitoring ready, rollback plan tested.

**Acceptance Criteria**:
- All unit tests pass (> 90% coverage)
- All integration tests pass
- Performance tests meet requirements
- Migration tested on staging (zero downtime)
- Documentation complete (API changes, approval flow, integration points)
- Monitoring dashboards created and tested
- Rollback plan documented and tested
- On-call runbook created
- Stakeholder communication completed
- Go/no-go decision documented

**Dependencies**: All Tasks 1-6 (comprehensive)

**Effort**: Medium

**Files Modified/Created**:
- `docs/DEPLOYMENT_CHECKLIST.md` (new)
- `docs/RUNBOOK_ROLLBACK.md` (new)

**Test Coverage**: Comprehensive validation across all systems

**Rollback**: Rollback plan fully documented and tested

---

### Task 6.12: Post-Deployment Monitoring (Week 4, ongoing)

**Description**: Monitor production deployment for first week: adoption, errors, performance, incidents.

**Acceptance Criteria**:
- Adoption metrics tracked (% agentic context in requests)
- Error rates monitored (approval blocking rate, expiration rate)
- Query latencies monitored (ensure < 100ms p99)
- No unexpected errors or system issues
- Stakeholder communication on metrics
- Feedback collected for refinements
- Issues logged for future phases (P2, P3)

**Dependencies**: All previous tasks

**Effort**: Medium

**Files Modified/Created**:
- `docs/POST_DEPLOYMENT_REPORT.md` (new, filled during week 1)

**Test Coverage**: Operational monitoring

**Rollback**: Quick rollback if critical issues detected

---

## Task Dependencies Summary

```
Phase 1 (Database):
  Task 1.1 → Task 1.2 → Task 1.3 → Task 1.4 → Task 1.5

Phase 2 (Service Layer):
  Task 1.5 → Task 2.1 → Task 2.2 → Task 2.3 → Task 2.4

Phase 3 (API):
  Task 2.4 → Task 3.1
  Task 2.2 → Task 3.2
  Task 2.2 → Task 3.3
  Task 2.2 → Task 3.4
  Task 3.1 → Task 3.5

Phase 4 (Audit):
  Task 2.1 → Task 4.1
  Task 4.1 → Task 4.2 (also Task 2.1, 2.2, 2.3)
  Task 4.2 → Task 4.3
  Tasks 2.1, 3.1, 3.2, 3.3, 3.4, 4.2 → Task 4.4
  Task 4.2 → Task 4.5

Phase 5 (Integration):
  Task 2.2, 3.3, 3.4 → Task 5.1
  Task 5.1 → Task 5.2
  Task 3.2 → Task 5.3
  Task 3.1, 3.3, 3.4 → Task 5.4
  Task 5.1 → Task 5.5

Phase 6 (Testing):
  Task 2.1, 2.2 → Task 6.1
  Task 2.3, 2.4 → Task 6.2
  Task 3.1, 3.2, 3.3, 3.4 → Task 6.3
  Task 4.1, 4.2, 4.3 → Task 6.4
  Task 1.5, 2.1, 3.1 → Task 6.5
  Task 2.1, 3.1, 3.2, 3.3 → Task 6.6
  Task 5.1, 5.2 → Task 6.7
  Task 1.2, 2.1, 3.2 → Task 6.8
  Task 2.3, 2.4 → Task 6.9
  Task 1.1, 1.2, 1.3 → Task 6.10
  All → Task 6.11
  All → Task 6.12
```

---

## Success Criteria Summary

By end of Phase 6:

1. ✅ Database: 13 new columns, 8 indexes, backward compatible, zero-downtime migration tested
2. ✅ Service Layer: Agent/task context captured, approval gates enforced, queries indexed
3. ✅ API: 5 new endpoints (token+context, query, approve, deny) with distinct error codes
4. ✅ Audit: Complete token lifecycle logging, investigation patterns, retention policy
5. ✅ Integration: Events emitted, external systems integrated, feature flags for rollback
6. ✅ Testing: > 90% unit test coverage, integration tests pass, performance validated
7. ✅ Deployment: Zero-downtime migration, rollback plan tested, monitoring dashboards ready
8. ✅ Backward Compatibility: Existing app-centric flows unchanged, no breaking changes

**Production Ready**: Deploy to staging (Week 1), validate (Week 2), deploy to production (Week 4)
