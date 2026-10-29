-- 0024: Workspace scoping for tasks, workflows, and connect grants.
-- Owner-side columns (tasks.user_id, workflows.user_id, grants' app/developer
-- links) stay through the transition; the API edge now reads and writes by
-- workspace_id with a membership check (see services/workspaces.py).

ALTER TABLE tasks ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace
  ON tasks (workspace_id, status, created_at);

ALTER TABLE workflows ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
CREATE INDEX IF NOT EXISTS idx_workflows_workspace
  ON workflows (workspace_id, status);

ALTER TABLE connect_grants ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
CREATE INDEX IF NOT EXISTS idx_grants_workspace
  ON connect_grants (workspace_id, approval_status);

-- Backfill from each row owner's earliest workspace (Personal first).
UPDATE tasks SET workspace_id = (
  SELECT workspace_id FROM workspace_members
  WHERE user_id = tasks.user_id ORDER BY created_at LIMIT 1
) WHERE workspace_id IS NULL;

UPDATE workflows SET workspace_id = (
  SELECT workspace_id FROM workspace_members
  WHERE user_id = workflows.user_id ORDER BY created_at LIMIT 1
) WHERE workspace_id IS NULL;

UPDATE connect_grants SET workspace_id = (
  SELECT workspace_id FROM workspace_members
  WHERE user_id = (SELECT developer_user_id FROM connect_apps WHERE id = connect_grants.connect_app_id)
  ORDER BY created_at LIMIT 1
) WHERE workspace_id IS NULL;
