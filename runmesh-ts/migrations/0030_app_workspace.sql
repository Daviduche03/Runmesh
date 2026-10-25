-- 0030: the OAuth client is workspace config, not a user-managed collection.
-- Sessions auto-provision a singleton app per workspace (see
-- ensure_workspace_app); backfill existing rows from their developer's
-- earliest workspace like 0024 did for grants.
ALTER TABLE connect_apps ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);

UPDATE connect_apps SET workspace_id = (
  SELECT workspace_id FROM workspace_members
  WHERE user_id = connect_apps.developer_user_id
  ORDER BY created_at LIMIT 1
) WHERE workspace_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_apps_workspace
  ON connect_apps (workspace_id) WHERE workspace_id IS NOT NULL;
