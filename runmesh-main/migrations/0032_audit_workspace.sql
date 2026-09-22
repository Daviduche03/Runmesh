-- 0032: audit events go workspace-first, matching grants (0024/0028),
-- connections (0029), apps (0030), and sessions (0031).
-- Backfill from the referenced row; unstamped rows stay NULL (invisible
-- to workspace queries) rather than guessed.
ALTER TABLE connect_audit_events ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);

UPDATE connect_audit_events SET workspace_id = (
  SELECT workspace_id FROM connect_grants WHERE id = connect_audit_events.resource_id
) WHERE workspace_id IS NULL AND resource_type = 'grant';

UPDATE connect_audit_events SET workspace_id = (
  SELECT workspace_id FROM connect_sessions WHERE id = connect_audit_events.resource_id
) WHERE workspace_id IS NULL AND resource_type = 'connect_session';

UPDATE connect_audit_events SET workspace_id = (
  SELECT workspace_id FROM connect_connections WHERE id = connect_audit_events.resource_id
) WHERE workspace_id IS NULL AND resource_type = 'connect_connection';

CREATE INDEX IF NOT EXISTS idx_audit_workspace
  ON connect_audit_events (workspace_id, created_at);
