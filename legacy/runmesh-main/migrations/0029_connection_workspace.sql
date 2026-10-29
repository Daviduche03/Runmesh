-- 0029: connections go workspace-first, matching grants (0024/0028).
-- Backfill from each connection's earliest grant; ungranted connections
-- stay NULL until their next OAuth callback stamps workspace_id.
ALTER TABLE connect_connections ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);

UPDATE connect_connections SET workspace_id = (
  SELECT workspace_id FROM connect_grants
  WHERE connection_id = connect_connections.id AND workspace_id IS NOT NULL
  ORDER BY created_at LIMIT 1
) WHERE workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_connections_workspace
  ON connect_connections (workspace_id, created_at);
