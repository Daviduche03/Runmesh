# Agentic Connect Layer - Technical Design

## Overview

The Agentic Connect Layer transforms Runmesh Connect from an app-centric OAuth vault into a credential broker that autonomously services agent-driven workflows. This design document details the technical implementation of:

1. **Grant Records** with agent/task/workflow context
2. **Approval Workflows** that gate token issuance
3. **Query APIs** for agent/task-scoped grant discovery
4. **Audit Trails** for complete token lifecycle tracking
5. **Safe Migrations** for zero-downtime deployment

### Design Philosophy

- **Backward Compatibility**: Existing app-centric flows continue without modification
- **Event-Driven**: Integration points emit events for async approval systems
- **Query Efficiency**: Indexed lookups enable rapid investigation and remediation
- **Audit First**: Every action is logged for compliance and incident response
- **Safe by Default**: Agents must request approval; auto-approval requires explicit opt-in

---

## Architecture

### Database Schema Evolution

#### Current State

The existing `grants` table in Connect schema stores:
- `id` (TEXT PRIMARY KEY): Grant ID
- `connect_app_id` (TEXT): App that owns the grant
- `connect_user_id` (TEXT): User who authorized the grant
- `provider` (TEXT): OAuth provider (github, gitlab, etc.)
- `connection_id` (TEXT): Reference to the OAuth connection
- `scopes` (TEXT, JSON): OAuth scopes requested
- `created_at` (TIMESTAMPTZ)
- `expires_at` (TIMESTAMPTZ, nullable)
- `status` (TEXT): active, revoked, expired
- `metadata` (JSONB, nullable)

#### API Contract Changes

**POST /api/v1/connect/token** (existing, now extended)

Request body changes:

```json
{
  "grant_id": "grant_abc123",
  "connect_app_id": "app_xyz789",
  
  // NEW: Optional agentic context
  "task_id": "task_123",
  "workflow_run_id": "run_456",
  "agent_id": "agent_789",
  
  // NEW: Optional approval requirement
  "approval_required": false,
  
  // NEW: Optional time bounds
  "valid_until": "2024-12-31T23:59:59Z",
  "valid_from": "2024-01-01T00:00:00Z"
}
```

**Validation Rules:**
- At least one of `grant_id` or `connect_app_id` must be provided
- `task_id`, `workflow_run_id`, `agent_id` are optional (nullable)
- `approval_required` defaults to `false` (backward compatible)
- `valid_until` and `valid_from` must be RFC3339 timestamps if provided
- Both `task_id` and `workflow_run_id` can be set (not mutually exclusive)

**Response Changes:**

```json
{
  "ok": true,
  "data": {
    "grant_id": "grant_abc123",
    "access_token": "token_...",
    "token_type": "bearer",
    "expires_in": 3600,
    "scope": "repo,gist",
    
    // NEW: Context echo
    "task_id": "task_123",
    "workflow_run_id": "run_456",
    "agent_id": "agent_789",
    
    // NEW: Approval status
    "approval_status": "approved",
    
    // NEW: Validity info
    "valid_from": "2024-01-01T00:00:00Z",
    "valid_until": "2024-12-31T23:59:59Z",
    "seconds_until_expiration": 86399
  }
}
```

**Error Responses:**

```json
// 403: Grant pending approval
{
  "ok": false,
  "error": "grant_pending_approval",
  "message": "Grant is awaiting approval. Approval requested by: ...",
  "grant_id": "grant_abc123",
  "status_code": 403
}

// 403: Grant denied
{
  "ok": false,
  "error": "grant_denied",
  "message": "Grant was denied. Reason: Too many scopes requested",
  "grant_id": "grant_abc123",
  "denied_reason": "Too many scopes requested",
  "denied_at": "2024-01-15T10:30:00Z",
  "status_code": 403
}

// 403: Grant expired
{
  "ok": false,
  "error": "grant_expired",
  "message": "Grant validity window has passed",
  "grant_id": "grant_abc123",
  "valid_until": "2024-12-31T23:59:59Z",
  "status_code": 403
}

// 404: Grant not found
{
  "ok": false,
  "error": "grant_not_found",
  "message": "No grant found with id: grant_abc123",
  "grant_id": "grant_abc123",
  "status_code": 404
}

// 401: User not authorized
{
  "ok": false,
  "error": "unauthorized",
  "message": "You do not have permission to access this grant",
  "status_code": 401
}
```

#### New Query Endpoints

**GET /api/v1/connect/grants**

Query parameters (all optional, but at least one should be provided):

```
GET /api/v1/connect/grants?agent_id={agent_id}&page=1&limit=50
GET /api/v1/connect/grants?task_id={task_id}&page=1&limit=50
GET /api/v1/connect/grants?workflow_run_id={workflow_run_id}&page=1&limit=50
```

Response:

```json
{
  "ok": true,
  "data": [
    {
      "id": "grant_abc123",
      "provider": "github",
      "scopes": ["repo", "gist"],
      "approval_status": "approved",
      "task_id": "task_123",
      "workflow_run_id": "run_456",
      "agent_id": "agent_789",
      "created_at": "2024-01-01T00:00:00Z",
      "created_by_task_id": "task_123",
      "created_by_workflow_run_id": "run_456",
      "expires_at": "2024-01-02T00:00:00Z",
      "valid_from": "2024-01-01T00:00:00Z",
      "valid_until": "2024-01-02T00:00:00Z",
      "approved_at": "2024-01-01T00:30:00Z",
      "approved_by_user_id": "user_sec",
      "seconds_until_expiration": 86399,
      "status": "active"
    }
  ],
  "meta": {
    "total": 5,
    "page": 1,
    "limit": 50,
    "pages": 1
  }
}
```

Error responses:

```json
// 400: Invalid parameters
{
  "ok": false,
  "error": "invalid_parameters",
  "message": "At least one of agent_id, task_id, or workflow_run_id must be provided",
  "status_code": 400
}

// 403: User not authorized to query
{
  "ok": false,
  "error": "unauthorized",
  "message": "You do not have permission to query grants for agent_id: agent_xyz",
  "status_code": 403
}
```

#### New Approval Endpoints

**POST /api/v1/connect/grants/{grant_id}/approve**

Request body:

```json
{
  "reason": "Approved for trusted workflow",
  "approved_by": "user_sec"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "id": "grant_abc123",
    "approval_status": "approved",
    "approved_at": "2024-01-01T00:30:00Z",
    "approved_by_user_id": "user_sec",
    "message": "Grant approved successfully"
  }
}
```

Error responses:

```json
// 409: Already approved
{
  "ok": false,
  "error": "grant_already_approved",
  "message": "Grant was already approved at 2024-01-01T00:30:00Z",
  "grant_id": "grant_abc123",
  "status_code": 409
}

// 403: Already denied
{
  "ok": false,
  "error": "grant_already_denied",
  "message": "Grant was already denied",
  "grant_id": "grant_abc123",
  "status_code": 403
}

// 403: No permission to approve
{
  "ok": false,
  "error": "unauthorized",
  "message": "You do not have approval authority for this grant",
  "status_code": 403
}

// 404: Grant not found
{
  "ok": false,
  "error": "grant_not_found",
  "message": "No grant found with id: grant_abc123",
  "status_code": 404
}
```

**POST /api/v1/connect/grants/{grant_id}/deny**

Request body:

```json
{
  "reason": "Scope too broad for untrusted agent",
  "denied_by": "user_sec"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "id": "grant_abc123",
    "approval_status": "denied",
    "denied_at": "2024-01-01T00:30:00Z",
    "denied_by_user_id": "user_sec",
    "denial_reason": "Scope too broad for untrusted agent",
    "message": "Grant denied successfully"
  }
}
```

---

## Components and Interfaces

### Service Layer Architecture

#### Token Request Validation Flow

```
POST /api/v1/connect/token
  ↓
1. Authenticate requester (JWT or API key)
   └─ Extract user_id from token
  ↓
2. Validate grant exists and belongs to user
   └─ SELECT * FROM grants WHERE id = grant_id AND connect_user_id = current_user_id
  ↓
3. Check validity window
   ├─ IF valid_from IS NOT NULL AND NOW() < valid_from
   │  └─ REJECT (403): grant_not_yet_valid
   ├─ IF valid_until IS NOT NULL AND NOW() > valid_until
   │  └─ REJECT (403): grant_expired
   └─ PASS: Continue
  ↓
4. Check approval status
   ├─ IF approval_status = 'pending_approval'
   │  └─ REJECT (403): grant_pending_approval
   ├─ IF approval_status = 'denied'
   │  └─ REJECT (403): grant_denied
   ├─ IF approval_status = 'auto_approved'
   │  └─ PASS: Continue
   ├─ IF approval_status = 'approved'
   │  └─ PASS: Continue
   └─ Other: REJECT (500): Invalid status
  ↓
5. Exchange grant for token
   ├─ Call OAuth provider (cached if recent)
   ├─ Store token securely
   └─ Return token to caller
  ↓
6. Audit log token issuance
   └─ INSERT INTO audit_events (action, grant_id, agent_id, task_id, ...)
```

#### Grant Request and Approval Flow

```
Agent requests token → Connect evaluates approval_required flag
  ↓
IF approval_required = false
  ├─ Set approval_status = 'auto_approved'
  ├─ Proceed directly to token exchange
  └─ Return token immediately
  ↓
IF approval_required = true
  ├─ Create grant record with approval_status = 'pending_approval'
  ├─ Emit event: "grant.pending_approval" (for workflow approval system)
  ├─ Return (202 Accepted) with polling URL
  ├─ Agent polls /api/v1/connect/grants/{grant_id}?include_status=true
  │
  └─ Approver reviews grant and calls:
      ├─ POST /api/v1/connect/grants/{grant_id}/approve
      │  └─ Emit event: "grant.approved"
      ├─ OR POST /api/v1/connect/grants/{grant_id}/deny
      │  └─ Emit event: "grant.denied"
      │
      └─ After approval:
         ├─ Update grant: approval_status = 'approved'
         ├─ Store approved_by_user_id, approved_at
         └─ Agent can now exchange grant for token
```

#### Grant Query Authorization

```
GET /api/v1/connect/grants?agent_id={agent_id}
  ↓
1. Authenticate requester
   └─ Extract user_id from JWT/API key
  ↓
2. Check authorization
   ├─ Query ownership: SELECT connect_user_id FROM grants WHERE agent_id = {agent_id}
   ├─ IF ALL grants belong to current_user_id
   │  └─ PASS: User can see grants
   └─ ELSE
      └─ REJECT (403): User does not own these grants
  ↓
3. Return paginated results
   └─ SELECT * FROM grants 
      WHERE connect_user_id = current_user_id 
        AND agent_id = {agent_id}
      ORDER BY created_at DESC
      LIMIT {limit} OFFSET {offset}
```

#### Integration with Existing OAuth Connection Flow

The existing flow (app requests token → consent screen → token stored) remains unchanged:

```
Current Flow (No Changes)
├─ App creates session → OAuth provider
├─ User consents → Provider callback
├─ Grant record created (app-centric)
└─ Token stored in connection

Agentic Flow (New, Parallel)
├─ Agent requests token via new endpoint
├─ Task/workflow context captured
├─ Approval gate applied (if required)
├─ Grant record created (agent-centric, linked to task)
└─ Token issued to agent
```

Both flows coexist; existing integrations are unaffected.

#### Async Hooks for Workflow Approval System

Define event emission points (foundation for P3 async integration):

```python
# In connect.py after grant creation or approval change:

async def _emit_grant_event(event_type: str, grant_id: str, context: dict):
    """
    Emit an event for external systems to observe grant lifecycle.
    Future task/workflow execution layer can subscribe to these events.
    
    event_type: 'grant.pending_approval', 'grant.approved', 'grant.denied'
    context: {grant_id, agent_id, task_id, workflow_run_id, ...}
    """
    # Webhook payload
    payload = {
        "event": event_type,
        "timestamp": datetime.utcnow().isoformat(),
        "data": {
            "grant_id": grant_id,
            **context
        }
    }
    
    # Emit to registered webhooks
    await webhooks_service.emit("connect.grant.*", payload)
    
    # Future: Emit to workflow approval system
    # await workflow_approval_system.handle_grant_event(event_type, grant_id, context)
```

Integration points:

1. **Workflow Approval System** can listen to `grant.pending_approval` events
2. **Task Execution Layer** polls `/api/v1/connect/grants?task_id={task_id}` to check grant status
3. **Async Waiters** (future P3) will have explicit event subscriptions

### Audit & Logging

#### Audit Event Structure

Extend the existing `audit_events` table with agent/task context:

```python
class ConnectAuditEventCreate(BaseModel):
    action: str  # 'grant.requested', 'grant.approved', 'grant.denied', 'token.issued'
    connect_user_id: str
    grant_id: str
    connect_app_id: Optional[str] = None
    provider: str
    scopes: List[str]
    
    # NEW: Agentic context
    agent_id: Optional[str] = None
    task_id: Optional[str] = None
    workflow_run_id: Optional[str] = None
    
    # Action-specific fields
    approval_required: Optional[bool] = None
    approved_by_user_id: Optional[str] = None
    approved_at: Optional[str] = None
    denied_by_user_id: Optional[str] = None
    denial_reason: Optional[str] = None
    
    # OAuth token lifecycle
    token_issued_at: Optional[str] = None
    token_expires_at: Optional[str] = None
    
    # Result tracking
    result: str  # 'success', 'failure'
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    
    # Metadata
    request_id: str  # For tracing
    timestamp: str  # ISO8601
```

#### Complete Token Lifecycle Audit Trail

Example audit sequence for a token request:

```
1. Token Request Received
   action: 'grant.requested'
   timestamp: 2024-01-15T10:00:00Z
   agent_id: 'agent_sec'
   task_id: 'task_123'
   workflow_run_id: 'run_456'
   scopes: ['repo', 'gist']
   approval_required: true
   result: 'success'
   message: 'Grant request accepted; pending approval'

2. Grant Approved
   action: 'grant.approved'
   timestamp: 2024-01-15T10:05:00Z
   grant_id: 'grant_abc123'
   approved_by_user_id: 'user_sec'
   approval_reason: 'Trusted agent; scheduled workflow'
   result: 'success'

3. Token Issued
   action: 'token.issued'
   timestamp: 2024-01-15T10:05:30Z
   grant_id: 'grant_abc123'
   agent_id: 'agent_sec'
   task_id: 'task_123'
   token_issued_at: 2024-01-15T10:05:30Z
   token_expires_at: 2024-01-15T14:05:30Z
   result: 'success'

4. (Later) Token Used
   action: 'token.used'
   timestamp: 2024-01-15T10:10:00Z
   grant_id: 'grant_abc123'
   agent_id: 'agent_sec'
   oauth_action: 'repo.create'  # If instrumented with OAuth provider
   result: 'success'
```

#### Query Patterns for Audit Investigation

**Find all tokens used by an agent:**

```sql
SELECT * FROM audit_events
WHERE agent_id = 'agent_sec'
  AND action IN ('grant.requested', 'grant.approved', 'token.issued', 'token.used')
ORDER BY timestamp DESC
LIMIT 100;
```

**Find all grants requiring action (pending approval):**

```sql
SELECT g.*, COUNT(a.id) as event_count
FROM grants g
LEFT JOIN audit_events a ON a.grant_id = g.id
WHERE g.approval_status = 'pending_approval'
  AND g.created_at > NOW() - INTERVAL '24 hours'
GROUP BY g.id
ORDER BY g.created_at DESC;
```

**Investigate a compromised agent:**

```sql
SELECT * FROM audit_events
WHERE agent_id = 'agent_compromised'
  AND action IN ('token.issued', 'token.used')
ORDER BY timestamp DESC;
-- Result: List all tokens issued to and used by compromised agent
```

---

## Data Models

### New Columns for Agentic Context

Add the following columns to the `grants` table (all nullable initially for backward compatibility):

```sql
-- Agent/Task Context
ALTER TABLE grants ADD COLUMN created_by_task_id TEXT DEFAULT NULL;
ALTER TABLE grants ADD COLUMN created_by_workflow_run_id TEXT DEFAULT NULL;
ALTER TABLE grants ADD COLUMN agent_id TEXT DEFAULT NULL;

-- Approval Status
ALTER TABLE grants ADD COLUMN approval_status TEXT DEFAULT 'auto_approved';
ALTER TABLE grants ADD COLUMN approved_by_user_id TEXT DEFAULT NULL;
ALTER TABLE grants ADD COLUMN approved_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE grants ADD COLUMN denied_by_user_id TEXT DEFAULT NULL;
ALTER TABLE grants ADD COLUMN denied_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE grants ADD COLUMN denial_reason TEXT DEFAULT NULL;

-- Time-Bounded Validity
ALTER TABLE grants ADD COLUMN valid_from TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE grants ADD COLUMN valid_until TIMESTAMPTZ DEFAULT NULL;

-- Foundation for P2 (Resource Scoping)
ALTER TABLE grants ADD COLUMN resource_filters JSONB DEFAULT NULL;
```

### Indexes for Performance

Create the following indexes to enable efficient queries (indexed lookup instead of full table scans):

```sql
-- Query by task
CREATE INDEX idx_grants_task_id ON grants(created_by_task_id)
WHERE created_by_task_id IS NOT NULL;

-- Query by workflow run
CREATE INDEX idx_grants_workflow_run_id ON grants(created_by_workflow_run_id)
WHERE created_by_workflow_run_id IS NOT NULL;

-- Query by agent
CREATE INDEX idx_grants_agent_id ON grants(agent_id)
WHERE agent_id IS NOT NULL;

-- Query by approval status (for finding pending approvals)
CREATE INDEX idx_grants_approval_status ON grants(approval_status)
WHERE approval_status = 'pending_approval';

-- Query by validity window (for checking expiration)
CREATE INDEX idx_grants_valid_until ON grants(valid_until)
WHERE valid_until IS NOT NULL;

-- Composite index for user + agent lookups (common query pattern)
CREATE INDEX idx_grants_user_agent ON grants(connect_user_id, agent_id)
WHERE agent_id IS NOT NULL;

-- Composite index for user + task lookups
CREATE INDEX idx_grants_user_task ON grants(connect_user_id, created_by_task_id)
WHERE created_by_task_id IS NOT NULL;

-- Composite index for user + workflow run lookups
CREATE INDEX idx_grants_user_workflow ON grants(connect_user_id, created_by_workflow_run_id)
WHERE created_by_workflow_run_id IS NOT NULL;
```

### Schema Update Strategy

**Phase 1: Prepare Database (zero downtime)**
1. Add columns with `DEFAULT NULL` — existing rows unaffected
2. Create indexes concurrently (`CREATE INDEX CONCURRENTLY`) — no table lock
3. Validate backward compatibility: old code + new schema works

**Phase 2: Deploy Code**
1. Deploy updated service code that reads new fields (handles NULL gracefully)
2. Code treats NULL values as "not set" for agent/task context
3. Existing queries and logic flow unaffected

**Phase 3: Populate Agentic Context (gradual)**
1. New token requests include task/workflow/agent context
2. Audit queries can retroactively link historical grants

**Phase 4: Enable Approval Enforcement (optional)**
1. Operator configurable: global `approval_required_for_all_grants` flag
2. Workflows explicitly request approval for sensitive grants
3. Operators adjust policy without re-deployment

### Rollback Safety

- All new columns are nullable; old code continues to function
- Existing grant records without new fields return NULL for new columns
- Rollback simply drops new columns (no data loss — columns were additive)
- Foreign key constraints not changed; existing relationships unaffected

---

## Implementation

### Extended ConnectGrantModel

```python
# In src/db/connect_orm.py

class ConnectGrantModel(Model):
    """Extended grant model with agent/task/approval context"""
    
    async def create(self, payload: ConnectGrantCreate) -> ConnectGrantRow:
        """Create a new grant with agentic context"""
        data = {
            "id": generate_id("grant"),
            "connect_app_id": payload.connect_app_id,
            "connect_user_id": payload.connect_user_id,
            "provider": payload.provider,
            "connection_id": payload.connection_id,
            "scopes": json.dumps(payload.scopes),
            
            # NEW: Agentic context
            "created_by_task_id": payload.created_by_task_id,
            "created_by_workflow_run_id": payload.created_by_workflow_run_id,
            "agent_id": payload.agent_id,
            
            # NEW: Approval
            "approval_status": "pending_approval" if payload.approval_required else "auto_approved",
            "approval_required": payload.approval_required or False,
            
            # NEW: Time bounds
            "valid_from": payload.valid_from,
            "valid_until": payload.valid_until or (datetime.utcnow() + timedelta(hours=24)).isoformat(),
            
            # NEW: P2 foundation
            "resource_filters": json.dumps(payload.resource_filters) if payload.resource_filters else None,
            
            "created_at": datetime.utcnow().isoformat(),
            "expires_at": payload.expires_at,
            "metadata": json.dumps(payload.metadata or {}),
        }
        
        grant_id = await self.db.insert("grants", data)
        
        # Audit the grant request
        await _audit(
            action="grant.requested",
            grant_id=grant_id,
            agent_id=payload.agent_id,
            task_id=payload.created_by_task_id,
            workflow_run_id=payload.created_by_workflow_run_id,
            scopes=payload.scopes,
            approval_required=payload.approval_required,
            result="success"
        )
        
        # Emit event for workflow approval system
        if payload.approval_required:
            await _emit_grant_event("grant.pending_approval", grant_id, {
                "agent_id": payload.agent_id,
                "task_id": payload.created_by_task_id,
                "workflow_run_id": payload.created_by_workflow_run_id,
            })
        
        return await self.find_by_id(grant_id)
    
    async def find_by_agent_id(self, connect_user_id: str, agent_id: str, 
                                limit: int = 50, offset: int = 0) -> list[ConnectGrantRow]:
        """Query grants by agent_id (indexed lookup)"""
        rows = await self.db.find_many(
            "grants",
            "connect_user_id = ? AND agent_id = ?",
            connect_user_id, agent_id,
            limit=limit, offset=offset
        )
        return [ConnectGrantRow(**row) for row in rows]
    
    async def find_by_task_id(self, connect_user_id: str, task_id: str,
                               limit: int = 50, offset: int = 0) -> list[ConnectGrantRow]:
        """Query grants by task_id (indexed lookup)"""
        rows = await self.db.find_many(
            "grants",
            "connect_user_id = ? AND created_by_task_id = ?",
            connect_user_id, task_id,
            limit=limit, offset=offset
        )
        return [ConnectGrantRow(**row) for row in rows]
    
    async def find_by_workflow_run_id(self, connect_user_id: str, workflow_run_id: str,
                                       limit: int = 50, offset: int = 0) -> list[ConnectGrantRow]:
        """Query grants by workflow_run_id (indexed lookup)"""
        rows = await self.db.find_many(
            "grants",
            "connect_user_id = ? AND created_by_workflow_run_id = ?",
            connect_user_id, workflow_run_id,
            limit=limit, offset=offset
        )
        return [ConnectGrantRow(**row) for row in rows]
    
    async def approve_grant(self, grant_id: str, approved_by_user_id: str,
                            approval_reason: Optional[str] = None) -> int:
        """Approve a pending grant"""
        updated = await self.db.update(
            "grants",
            "id = ? AND approval_status = ?",
            {
                "approval_status": "approved",
                "approved_by_user_id": approved_by_user_id,
                "approved_at": datetime.utcnow().isoformat(),
            },
            grant_id, "pending_approval"
        )
        
        if updated > 0:
            # Audit the approval
            grant = await self.find_by_id(grant_id)
            await _audit(
                action="grant.approved",
                grant_id=grant_id,
                agent_id=grant.agent_id,
                task_id=grant.created_by_task_id,
                workflow_run_id=grant.created_by_workflow_run_id,
                approved_by_user_id=approved_by_user_id,
                approval_reason=approval_reason,
                result="success"
            )
            
            # Emit event
            await _emit_grant_event("grant.approved", grant_id, {
                "approved_by_user_id": approved_by_user_id,
                "approval_reason": approval_reason,
            })
        
        return updated
    
    async def deny_grant(self, grant_id: str, denied_by_user_id: str,
                         denial_reason: str) -> int:
        """Deny a pending grant"""
        updated = await self.db.update(
            "grants",
            "id = ? AND approval_status IN (?, ?)",
            {
                "approval_status": "denied",
                "denied_by_user_id": denied_by_user_id,
                "denied_at": datetime.utcnow().isoformat(),
                "denial_reason": denial_reason,
            },
            grant_id, "pending_approval", "auto_approved"
        )
        
        if updated > 0:
            grant = await self.find_by_id(grant_id)
            await _audit(
                action="grant.denied",
                grant_id=grant_id,
                agent_id=grant.agent_id,
                task_id=grant.created_by_task_id,
                workflow_run_id=grant.created_by_workflow_run_id,
                denied_by_user_id=denied_by_user_id,
                denial_reason=denial_reason,
                result="success"
            )
            
            await _emit_grant_event("grant.denied", grant_id, {
                "denied_by_user_id": denied_by_user_id,
                "denial_reason": denial_reason,
            })
        
        return updated
```

### Token Request Validation in Service Layer

```python
# In src/services/connect.py

async def exchange_connect_token_with_approval(
    token_request: ConnectTokenRequest,
    current_user_id: str,
    env
) -> dict:
    """
    Exchange a grant for a token, checking approval status first.
    This replaces/extends the existing exchange_connect_token function.
    """
    grant_model = ConnectGrantModel(env.DB)
    audit_model = ConnectAuditEventModel(env.DB)
    
    # 1. Find and authorize the grant
    grant = await grant_model.find_by_id(token_request.grant_id)
    if not grant:
        raise HTTPException(status_code=404, detail=json.dumps({
            "error": "grant_not_found",
            "message": f"No grant found with id: {token_request.grant_id}",
            "grant_id": token_request.grant_id
        }))
    
    # Check ownership
    if grant.connect_user_id != current_user_id:
        raise HTTPException(status_code=403, detail=json.dumps({
            "error": "unauthorized",
            "message": "You do not have permission to access this grant"
        }))
    
    # 2. Check validity window
    now = datetime.utcnow()
    if grant.valid_from and now < datetime.fromisoformat(grant.valid_from):
        raise HTTPException(status_code=403, detail=json.dumps({
            "error": "grant_not_yet_valid",
            "message": "Grant is not yet valid",
            "valid_from": grant.valid_from
        }))
    
    if grant.valid_until and now > datetime.fromisoformat(grant.valid_until):
        raise HTTPException(status_code=403, detail=json.dumps({
            "error": "grant_expired",
            "message": "Grant validity window has passed",
            "valid_until": grant.valid_until
        }))
    
    # 3. Check approval status
    if grant.approval_status == "pending_approval":
        raise HTTPException(status_code=403, detail=json.dumps({
            "error": "grant_pending_approval",
            "message": "Grant is awaiting approval",
            "grant_id": grant.id
        }))
    
    if grant.approval_status == "denied":
        raise HTTPException(status_code=403, detail=json.dumps({
            "error": "grant_denied",
            "message": f"Grant was denied. Reason: {grant.denial_reason}",
            "grant_id": grant.id,
            "denied_reason": grant.denial_reason,
            "denied_at": grant.denied_at
        }))
    
    if grant.approval_status not in ["auto_approved", "approved"]:
        raise HTTPException(status_code=500, detail=json.dumps({
            "error": "internal_error",
            "message": f"Invalid approval status: {grant.approval_status}"
        }))
    
    # 4. Exchange for token (existing logic)
    token_result = await _get_provider_token(grant)
    
    # 5. Audit token issuance
    await _audit(
        action="token.issued",
        grant_id=grant.id,
        agent_id=token_request.agent_id,
        task_id=token_request.task_id,
        workflow_run_id=token_request.workflow_run_id,
        token_issued_at=datetime.utcnow().isoformat(),
        token_expires_at=datetime.utcnow() + timedelta(seconds=token_result["expires_in"]),
        result="success"
    )
    
    # 6. Return token with context
    return {
        "grant_id": grant.id,
        "access_token": token_result["access_token"],
        "token_type": token_result["token_type"],
        "expires_in": token_result["expires_in"],
        "scope": token_result.get("scope", ""),
        
        # Echo agentic context
        "task_id": token_request.task_id,
        "workflow_run_id": token_request.workflow_run_id,
        "agent_id": token_request.agent_id,
        
        # Echo approval info
        "approval_status": grant.approval_status,
        
        # Echo validity window
        "valid_from": grant.valid_from,
        "valid_until": grant.valid_until,
        "seconds_until_expiration": max(0, int((
            datetime.fromisoformat(grant.valid_until) - now
        ).total_seconds())) if grant.valid_until else None,
    }
```

### Grant Query Endpoint

```python
# In src/entry.py (FastAPI routes)

@app.get("/api/v1/connect/grants")
async def list_grants(
    agent_id: Optional[str] = None,
    task_id: Optional[str] = None,
    workflow_run_id: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    request: Request = None,
    current_user: dict = Depends(get_jwt_user)
):
    """Query grants by agent, task, or workflow run"""
    
    # Validate that at least one filter is provided
    if not (agent_id or task_id or workflow_run_id):
        raise HTTPException(status_code=400, detail=json.dumps({
            "error": "invalid_parameters",
            "message": "At least one of agent_id, task_id, or workflow_run_id must be provided"
        }))
    
    env = request.scope["env"]
    grant_model = ConnectGrantModel(env.DB)
    
    # Pagination
    offset = (page - 1) * limit
    
    # Query based on filter
    if agent_id:
        grants = await grant_model.find_by_agent_id(
            current_user["id"], agent_id, limit=limit, offset=offset
        )
        total = await grant_model.count_by_agent_id(current_user["id"], agent_id)
    
    elif task_id:
        grants = await grant_model.find_by_task_id(
            current_user["id"], task_id, limit=limit, offset=offset
        )
        total = await grant_model.count_by_task_id(current_user["id"], task_id)
    
    else:  # workflow_run_id
        grants = await grant_model.find_by_workflow_run_id(
            current_user["id"], workflow_run_id, limit=limit, offset=offset
        )
        total = await grant_model.count_by_workflow_run_id(current_user["id"], workflow_run_id)
    
    # Serialize grants
    grant_dicts = [_serialize_grant(g) for g in grants]
    
    return success(grant_dicts, meta={
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit
    })
```

---

## Integration Points

### Workflow Approval System Integration

The workflow approval system (future layer) will:

1. **Listen** to `grant.pending_approval` events from Connect
2. **Inspect** the workflow context (e.g., "is this a trusted workflow?")
3. **Call** `/api/v1/connect/grants/{grant_id}/approve` or `/deny` based on policy
4. **Emit** events back to task execution layer

Example webhook listener (pseudo-code):

```python
async def on_grant_pending_approval(event: dict, env):
    """
    Workflow approval system listens to this event.
    Decides whether to auto-approve or route to human review.
    """
    grant_id = event["data"]["grant_id"]
    workflow_run_id = event["data"]["workflow_run_id"]
    
    # Fetch workflow to evaluate trust
    workflow = await get_workflow_by_run_id(workflow_run_id)
    
    if is_trusted_workflow(workflow):
        # Auto-approve
        await connect_service.approve_grant(grant_id, approver_user_id="system")
    else:
        # Route to manual approval queue
        await approval_queue.add(grant_id, workflow_run_id)
```

### Task Execution Layer Integration

The task execution layer will:

1. **Before executing a task**, query available grants:
   ```
   GET /api/v1/connect/grants?task_id={task_id}
   ```

2. **Check grant status**: If `approval_status` is `pending_approval`, the task can:
   - Wait for approval (async, P3)
   - Fail immediately (conservative)
   - Retry periodically (polling, P1)

3. **Use approved grant** to fetch token and execute task

Example task executor logic (pseudo-code):

```python
async def execute_task_with_connect_grant(task: TaskRow, env):
    """Execute a task that requires a Connect grant"""
    
    # Find available grants for this task
    grants = await connect_service.list_grants_by_task_id(task.id)
    
    if not grants:
        raise TaskExecutionError("No grants available for task")
    
    # Assume first matching grant (future: improve filtering)
    grant = grants[0]
    
    # Check if grant is ready
    if grant.approval_status == "pending_approval":
        # P1: Retry logic with backoff
        raise TaskExecutionError("Grant pending approval; retry later")
        
        # P3: Async wait
        # await wait_for_grant_approval(grant.id, timeout=300)
    
    if grant.approval_status == "denied":
        raise TaskExecutionError("Grant was denied; cannot proceed")
    
    # Request token
    token_response = await connect_service.exchange_connect_token(
        grant_id=grant.id,
        task_id=task.id,
        workflow_run_id=task.workflow_id
    )
    
    # Use token to execute task (e.g., GitHub API call)
    await execute_with_token(token_response["access_token"], task)
```

### Event Emission for Async Task Integration

Events emitted by Connect (foundation for P3):

```
grant.pending_approval
├─ Data: {grant_id, agent_id, task_id, workflow_run_id, provider, scopes}
├─ Consumer: Workflow approval system
└─ Action: Approve or deny based on workflow policy

grant.approved
├─ Data: {grant_id, approved_by_user_id, approval_reason}
├─ Consumer: Task execution layer (polls can unblock)
└─ Action: Task proceeds to token exchange

grant.denied
├─ Data: {grant_id, denied_by_user_id, denial_reason}
├─ Consumer: Task execution layer (mark as failed)
└─ Action: Task fails with error

token.issued
├─ Data: {grant_id, agent_id, task_id, token_issued_at, token_expires_at}
├─ Consumer: Audit/monitoring system
└─ Action: Log token issuance; emit metrics
```

### Webhook/Callback Point for External Approval

Operators can configure an external approval system via webhook:

```json
POST /api/v1/connect/webhooks/approvals
{
  "url": "https://approval-system.example.com/connect/grants/review",
  "secret": "webhook_secret_...",
  "events": ["grant.pending_approval"],
  "policy": {
    "auto_approve_trusted_workflows": true,
    "default_action": "require_human_review"
  }
}
```

When a grant is pending:

```
1. Connect emits event: grant.pending_approval
2. Webhook invoked: POST https://approval-system.example.com/connect/grants/review
3. External system evaluates policy
4. External system calls: POST /api/v1/connect/grants/{grant_id}/approve or /deny
5. Connect updates grant status
6. Event propagates to task execution layer
```

### Phased Migration and Rollout

**Week 1: Database Preparation (zero downtime)**
1. Deploy migration script (adds columns, creates indexes)
2. Run on staging; validate backward compatibility
3. No downtime; old code continues to work
4. Production deployment: `CONCURRENTLY` indexing (no table lock)

**Week 2: Code Deployment**
1. Deploy updated Connect service code
2. Code handles NULL values for new fields gracefully
3. Existing token requests work without agent context
4. New grant queries available but optional

**Week 3: Agentic Feature Rollout**
1. Enable agent/task context capture for new requests
2. Workflow system can now include `task_id`, `agent_id` in requests
3. Dashboard can display agentic grants
4. Feature flags control approval enforcement (rollback if needed)

**Week 4: Approval System Integration**
1. Operators define approval policies
2. New workflows use approval gates for sensitive grants
3. Feedback collected; refinements made
4. Existing workflows continue without approval (backward compatible)

**Rollback Plan**:
- Database: Drop new indexes concurrently (no downtime); optionally drop columns
- Code: Redeploy previous version; new fields ignored by old code; all queries continue
- Feature Flags: Global `approval_required_for_all_grants` flag (default: false); toggle without code re-deployment

**Monitoring During Migration**:

```python
# Metrics to track adoption and performance

# New field adoption
connect.grant.request.with_agent_context  # Gauge: % of new requests with agent_id
connect.grant.request.with_task_context   # Gauge: % of new requests with task_id
connect.grant.request.with_workflow_context  # Gauge: % with workflow_run_id

# Approval system activity
connect.grant.pending_approval.count  # Gauge: Grants awaiting approval
connect.grant.approval.latency_seconds  # Histogram: Time from request to approval
connect.grant.approval.rate  # Counter: Approvals per minute
connect.grant.denial.rate  # Counter: Denials per minute

# Token issuance
connect.token.issue.latency_seconds  # Histogram: Time to issue token
connect.token.issue.blocked_by_approval  # Counter: Tokens rejected (pending approval)
connect.token.issue.blocked_by_expiration  # Counter: Tokens rejected (expired)

# Query performance
connect.grant.query.latency_seconds  # Histogram: Time to query grants by agent_id/task_id/workflow_run_id
```

Dashboards:

- **Adoption Dashboard**: % of new requests using agentic context
- **Approval Queue**: Pending grants by workflow; approval latency trends
- **Error Dashboard**: Rejection rates by reason (expired, denied, pending)
- **Performance Dashboard**: Query latencies; index usage

---

## 8. Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Optional Agentic Context Is Accepted and Stored

*For any* token request, regardless of whether `agent_id`, `task_id`, or `workflow_run_id` are provided (singly, together, or not at all), the system SHALL accept the request and store the provided context fields in the grant record, with NULL for omitted fields.

**Validates: Requirements 1.1, 1.2, 1.4, 1.5, 11.1, 11.3**

### Property 2: Grant Context Is Retrievable and Complete

*For any* grant with stored agent/task/workflow context, querying that grant SHALL return all context fields (agent_id, created_by_task_id, created_by_workflow_run_id) exactly as stored, preserving NULL values for fields not set.

**Validates: Requirements 1.3, 7.1, 11.4**

### Property 3: Approval Status Blocks Token Issuance Correctly

*For any* grant with `approval_status` in {`pending_approval`, `denied`}, token issuance requests SHALL be rejected with HTTP 403 and an error response containing the appropriate error code (`grant_pending_approval` or `grant_denied`) and contextual information (denial_reason, denial_at).

**Validates: Requirements 4.4, 4.5, 5.1, 5.2, 5.3, 12.1, 12.2**

### Property 4: Default Approval Status Preserves Backward Compatibility

*For any* grant created without an explicit `approval_required` flag, the `approval_status` SHALL default to `auto_approved`, allowing token exchange to proceed immediately without approval gates.

**Validates: Requirements 4.2, 11.2**

### Property 5: Indexed Grant Queries Return Only Owned Grants

*For any* user querying grants by `agent_id`, `task_id`, or `workflow_run_id`, the results SHALL include only grants where `connect_user_id` matches the authenticated user; queries for non-owned grants SHALL return HTTP 403 (Forbidden) without confirming or denying existence.

**Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.5**

### Property 6: Grant Query Responses Include All Required Fields

*For any* paginated grant query result, each grant object SHALL include: `id`, `provider`, `scopes`, `approval_status`, `agent_id`, `created_by_task_id`, `created_by_workflow_run_id`, `created_at`, `expires_at`, `valid_from`, `valid_until`, `approved_at`, `approved_by_user_id`, and `seconds_until_expiration` (calculated).

**Validates: Requirements 3.4**

### Property 7: Time-Bounded Validity Is Enforced

*For any* grant with `valid_from` set to a future time, token requests before that time SHALL be rejected with HTTP 403 and error code `grant_not_yet_valid` with the timestamp. For any grant with `valid_until` set to a past time, token requests after that time SHALL be rejected with HTTP 403 and error code `grant_expired` with the timestamp.

**Validates: Requirements 10.2, 10.3, 10.4, 12.3**

### Property 8: Default Validity Window Is Applied and Enforced

*For any* grant without an explicit `valid_until` set, a default validity window (e.g., 24 hours from creation) SHALL be automatically applied, and token exchange SHALL enforce this expiration without requiring the caller to specify it.

**Validates: Requirements 10.5**

### Property 9: Grant Approval Creates Idempotent State

*For any* grant already in `approved` status, a subsequent call to `/api/v1/connect/grants/{id}/approve` SHALL return HTTP 409 (Conflict) with a descriptive message indicating the grant is already approved, and the grant's state (including `approved_by_user_id` and `approved_at`) SHALL remain unchanged.

**Validates: Requirements 6.3**

### Property 10: Denied Grants Require New Request

*For any* denied grant, a subsequent token request from the same task/agent SHALL create a new grant record (not reuse or re-evaluate the denied one), allowing retry workflows without operator intervention.

**Validates: Requirements 5.5**

### Property 11: Approval Records Include Full Metadata

*For any* grant that transitions to `approved` status via the `/api/v1/connect/grants/{id}/approve` endpoint, the record SHALL store `approved_by_user_id` and `approved_at` (RFC3339 timestamp); for `denied` status, it SHALL store `denied_by_user_id`, `denied_at`, and `denial_reason`.

**Validates: Requirements 4.6, 6.2, 6.4, 6.5**

### Property 12: Audit Trail Is Complete and Queryable

*For any* grant, a complete audit trail SHALL exist with entries for every action: `grant.requested`, optionally `grant.approved` or `grant.denied`, and `token.issued`; all entries SHALL be retrievable by `grant_id` in chronological order, containing required fields (log_id, timestamp, actor, action, resource_id, result, error_message).

**Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.6, 8.7, 12.7**

### Property 13: Agent Context Flows Through Audit Events

*For any* token request that includes `agent_id`, `task_id`, or `workflow_run_id`, all related audit events (request, approval/denial, issuance) SHALL include these context fields, enabling audit queries like "show all tokens used by agent X" to return complete results.

**Validates: Requirements 1.6, 8.1, 8.2, 8.3, 8.4**

### Property 14: Error Responses Are Semantically Distinct and Complete

*For any* error response, the JSON body SHALL include `error` (code), `message` (human-readable), `grant_id` (if applicable), `timestamp` (ISO8601), and `request_id` (for tracing); error codes SHALL distinguish user errors (403, 404, 400) from system errors (500), and each error code SHALL map to a specific failure reason (e.g., `grant_pending_approval`, `grant_denied`, `grant_expired`).

**Validates: Requirements 5.2, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7**

### Property 15: Backward Compatibility Across Schema Transitions

*For any* grant record created before new columns (`agent_id`, `approval_status`, `valid_until`, etc.) existed, querying that grant with updated code SHALL return NULL for new columns without errors; all existing functionality (token exchange, provider lookup, user authorization checks) SHALL work identically to pre-migration behavior.

**Validates: Requirements 9.2, 9.4, 9.5**

### Property 16: Resource Filters Are Stored Without Enforcement

*For any* grant with `resource_filters` populated, the field SHALL be stored in JSONB and visible in grant queries and audit logs, but SHALL NOT affect token issuance or validation; this ensures resource scoping (P2) can be added later without breaking existing grants with NULL resource_filters.

**Validates: Requirements 13.1, 13.2, 13.4**

### Property 17: Grant Status Drives Task Execution Decisions

*For any* grant query result returned to a task executor, the `approval_status` field SHALL accurately reflect the current state, allowing the task to decide whether to wait (P3), fail immediately, or retry—ensuring task execution logic is not blocked by stale grant status.

**Validates: Requirements 14.2**

---

## 9. Error Handling

### 9.1 Error Classification

| Error Code | HTTP Status | Category | Action |
|------------|------------|----------|--------|
| `grant_pending_approval` | 403 | User Error | Retry after approval |
| `grant_denied` | 403 | User Error | Request new grant or contact admin |
| `grant_expired` | 403 | User Error | Request new grant with updated validity window |
| `grant_not_found` | 404 | User Error | Verify grant_id is correct |
| `grant_not_yet_valid` | 403 | User Error | Wait until valid_from time or contact admin |
| `unauthorized` | 401/403 | User Error | Verify authentication and grant ownership |
| `invalid_parameters` | 400 | User Error | Fix request parameters |
| `grant_already_approved` | 409 | Conflict | Idempotent re-approval rejected |
| `grant_already_denied` | 403 | Conflict | Cannot approve a denied grant; create new one |
| `internal_error` | 500 | System Error | Retry with exponential backoff; check logs |

### 9.2 Error Response Format

All error responses follow a consistent format:

```json
{
  "ok": false,
  "error": "error_code",
  "message": "Human-readable explanation",
  "grant_id": "grant_abc123",  // if applicable
  "request_id": "req_xyz789",  // for tracing
  "timestamp": "2024-01-15T10:00:00Z",
  "status_code": 403,
  
  // Additional context based on error type
  "details": {
    "valid_until": "2024-01-15T15:00:00Z",  // for expiration errors
    "denial_reason": "...",  // for denial errors
    "approved_at": "...",  // for already-approved errors
  }
}
```

---

## 10. Testing Strategy

### Unit Tests

Cover individual functions and logic:

1. **Token Request Validation**
   - Valid grant → token issued
   - Pending approval → 403
   - Denied grant → 403
   - Expired grant → 403
   - Invalid grant → 404

2. **Grant Approval**
   - Approve pending grant → status updated
   - Approve already-approved grant → 409
   - Approve denied grant → 403
   - Deny pending grant → status updated

3. **Grant Queries**
   - Query by agent_id → returns agent's grants only
   - Query by task_id → returns task's grants only
   - Query by workflow_run_id → returns workflow's grants only
   - Unauthorized user → 403

4. **Audit Logging**
   - Each action logged with full context
   - Audit trail queryable by grant_id
   - Audit entries include agent/task context

### Integration Tests

Cover end-to-end workflows:

1. **App-Centric Flow** (existing, must not break)
   - App creates session → OAuth flow → token stored
   - Token request works without agent context
   - Audit trail shows app-centric flow

2. **Agent-Driven Flow** (new)
   - Agent requests token with task_id → grant pending approval
   - Approval endpoint approves grant
   - Agent retrieves token
   - Audit trail shows full lifecycle with agent context

3. **Schema Migration**
   - Database migrated without downtime
   - Old code + new schema continues to work
   - New code + new schema works
   - Rollback drops new indexes without data loss

4. **Approval Integration**
   - Workflow approval system receives events
   - External approval system can approve/deny grants
   - Task execution layer queries grants by task_id

---

## 11. Deployment Checklist

- [ ] Database migration tested on staging
- [ ] New indexes created concurrently (no table locks)
- [ ] Backward compatibility verified (old code + new schema)
- [ ] New service code deployed (handles NULL fields gracefully)
- [ ] Feature flags created for approval enforcement
- [ ] Audit logging tested with agentic context
- [ ] Grant query endpoints tested with authorization
- [ ] Event emission tested (grants → approval system)
- [ ] Monitoring dashboards created (adoption, performance, errors)
- [ ] Documentation updated (API changes, approval flow)
- [ ] On-call runbook created (rollback procedure)
- [ ] Stakeholder communication sent (launch plan, timeline)

---

## 12. Open Questions for Implementation

1. **Approval Authority**: Which user roles can approve grants? (Recommend: admin role initially, configurable)
2. **Timeout Policy**: If grant pending >7 days, auto-deny or stay pending? (Recommend: configurable, default auto-deny)
3. **Default Validity Window**: If `valid_until` not set, use what default? (Recommend: 24 hours, configurable)
4. **Event Delivery**: Should events be delivered reliably (with retries) or fire-and-forget? (Recommend: reliable delivery via queue)
5. **Resource Scoping P2**: Should resource filters be validated in P1 or left for P2? (Recommend: stored but not enforced in P1)
