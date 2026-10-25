-- Agentic Connect Layer: agent/task context + approval gating
-- No backward compat: new grants are pending until explicitly approved

ALTER TABLE connect_grants ADD COLUMN created_by_task_id TEXT;
ALTER TABLE connect_grants ADD COLUMN created_by_workflow_run_id TEXT;
ALTER TABLE connect_grants ADD COLUMN agent_id TEXT;
ALTER TABLE connect_grants ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (approval_status IN ('pending_approval','approved','denied','expired'));
ALTER TABLE connect_grants ADD COLUMN valid_from TEXT;
ALTER TABLE connect_grants ADD COLUMN valid_until TEXT;
ALTER TABLE connect_grants ADD COLUMN resource_filters TEXT;

CREATE INDEX idx_grants_task_id ON connect_grants(created_by_task_id) WHERE created_by_task_id IS NOT NULL;
CREATE INDEX idx_grants_workflow_run_id ON connect_grants(created_by_workflow_run_id) WHERE created_by_workflow_run_id IS NOT NULL;
CREATE INDEX idx_grants_agent_id ON connect_grants(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_grants_approval_status ON connect_grants(approval_status) WHERE approval_status = 'pending_approval';
CREATE INDEX idx_grants_valid_until ON connect_grants(valid_until) WHERE valid_until IS NOT NULL;
CREATE INDEX idx_grants_user_agent ON connect_grants(connect_user_id, agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_grants_user_task ON connect_grants(connect_user_id, created_by_task_id) WHERE created_by_task_id IS NOT NULL;
CREATE INDEX idx_grants_user_workflow ON connect_grants(connect_user_id, created_by_workflow_run_id) WHERE created_by_workflow_run_id IS NOT NULL;

ALTER TABLE connect_audit_events ADD COLUMN agent_id TEXT;
ALTER TABLE connect_audit_events ADD COLUMN task_id TEXT;
ALTER TABLE connect_audit_events ADD COLUMN workflow_run_id TEXT;
ALTER TABLE connect_audit_events ADD COLUMN approval_required INTEGER DEFAULT 0;
ALTER TABLE connect_audit_events ADD COLUMN denial_reason TEXT;
ALTER TABLE connect_audit_events ADD COLUMN token_issued_at TEXT;
ALTER TABLE connect_audit_events ADD COLUMN token_expires_at TEXT;
ALTER TABLE connect_audit_events ADD COLUMN result TEXT DEFAULT 'success';
ALTER TABLE connect_audit_events ADD COLUMN error_code TEXT;
ALTER TABLE connect_audit_events ADD COLUMN error_message TEXT;
ALTER TABLE connect_audit_events ADD COLUMN request_id TEXT;

CREATE INDEX idx_connect_audit_grant_id ON connect_audit_events(resource_id) WHERE resource_type = 'grant';
