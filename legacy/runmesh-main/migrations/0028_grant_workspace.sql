-- 0028: grants go workspace-first.
-- 1. connect_access_requests has zero writers in src/ (superseded by
--    connect_grants.approval_status) — drop it.
-- 2. connect_app_id becomes nullable. Grants are keyed by workspace_id;
--    the app row survives only as OAuth client config for the session
--    flows (_ensure_grant still stamps it). Nothing references
--    connect_grants via FK, so a rebuild is safe.
DROP TABLE IF EXISTS connect_access_requests;

CREATE TABLE IF NOT EXISTS connect_grants_new (
  id TEXT PRIMARY KEY,
  connect_app_id TEXT REFERENCES connect_apps(id) ON DELETE CASCADE,
  connect_user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_task_id TEXT,
  created_by_workflow_run_id TEXT,
  agent_id TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (approval_status IN ('pending_approval','approved','denied','expired')),
  valid_from TEXT,
  valid_until TEXT,
  resource_filters TEXT,
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  project_id TEXT,
  environment TEXT CHECK (environment IN ('dev','staging','prod')),
  workspace_id TEXT REFERENCES workspaces(id),
  FOREIGN KEY (connect_user_id) REFERENCES connect_users(id) ON DELETE CASCADE,
  FOREIGN KEY (connection_id) REFERENCES connect_connections(id) ON DELETE CASCADE,
  UNIQUE (connect_app_id, connect_user_id, connection_id)
);

INSERT OR IGNORE INTO connect_grants_new (
  id, connect_app_id, connect_user_id, connection_id, scopes, status,
  granted_at, revoked_at, created_at, updated_at, created_by_task_id,
  created_by_workflow_run_id, agent_id, approval_status, valid_from,
  valid_until, resource_filters, max_uses, use_count, project_id,
  environment, workspace_id
) SELECT
  id, connect_app_id, connect_user_id, connection_id, scopes, status,
  granted_at, revoked_at, created_at, updated_at, created_by_task_id,
  created_by_workflow_run_id, agent_id, approval_status, valid_from,
  valid_until, resource_filters, max_uses, use_count, project_id,
  environment, workspace_id
FROM connect_grants;

DROP TABLE connect_grants;
ALTER TABLE connect_grants_new RENAME TO connect_grants;

CREATE INDEX IF NOT EXISTS idx_connect_grants_app_user
  ON connect_grants (connect_app_id, connect_user_id);
CREATE INDEX IF NOT EXISTS idx_connect_grants_connection
  ON connect_grants (connection_id);
CREATE INDEX IF NOT EXISTS idx_grants_task_id
  ON connect_grants(created_by_task_id) WHERE created_by_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grants_workflow_run_id
  ON connect_grants(created_by_workflow_run_id) WHERE created_by_workflow_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grants_agent_id
  ON connect_grants(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grants_approval_status
  ON connect_grants(approval_status) WHERE approval_status = 'pending_approval';
CREATE INDEX IF NOT EXISTS idx_grants_valid_until
  ON connect_grants(valid_until) WHERE valid_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grants_user_agent
  ON connect_grants(connect_user_id, agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grants_user_task
  ON connect_grants(connect_user_id, created_by_task_id) WHERE created_by_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grants_user_workflow
  ON connect_grants(connect_user_id, created_by_workflow_run_id) WHERE created_by_workflow_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grants_max_uses
  ON connect_grants(max_uses) WHERE max_uses IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grants_project_env
  ON connect_grants(project_id, environment) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grants_workspace
  ON connect_grants (workspace_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_grants_workspace_created
  ON connect_grants(workspace_id, created_at);
