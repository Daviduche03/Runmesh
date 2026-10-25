-- Unify Runmesh products around durable agent actions without renaming the
-- existing tasks table. Tasks remain the execution primitive; these columns
-- add the action/agent envelope used by Workflows, Connect, and Workspace.

ALTER TABLE tasks ADD COLUMN action_kind TEXT NOT NULL DEFAULT 'http';
ALTER TABLE tasks ADD COLUMN action_name TEXT;
ALTER TABLE tasks ADD COLUMN agent_id TEXT;
ALTER TABLE tasks ADD COLUMN agent_session_id TEXT;
ALTER TABLE tasks ADD COLUMN thread_id TEXT;
ALTER TABLE tasks ADD COLUMN tool_name TEXT;
ALTER TABLE tasks ADD COLUMN actor_user_id TEXT;
ALTER TABLE tasks ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE tasks ADD COLUMN approval_id TEXT;
ALTER TABLE tasks ADD COLUMN connect_app_id TEXT;
ALTER TABLE tasks ADD COLUMN connect_grant_id TEXT;
ALTER TABLE tasks ADD COLUMN connect_session_id TEXT;
ALTER TABLE tasks ADD COLUMN workspace_project_id TEXT;
ALTER TABLE tasks ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';

ALTER TABLE workflows ADD COLUMN agent_id TEXT;
ALTER TABLE workflows ADD COLUMN thread_id TEXT;
ALTER TABLE workflows ADD COLUMN workspace_project_id TEXT;
ALTER TABLE workflows ADD COLUMN connect_app_id TEXT;
ALTER TABLE workflows ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';

ALTER TABLE workflow_runs ADD COLUMN agent_session_id TEXT;
ALTER TABLE workflow_runs ADD COLUMN thread_id TEXT;
ALTER TABLE workflow_runs ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_tasks_agent
  ON tasks (user_id, agent_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tasks_thread
  ON tasks (user_id, thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tasks_tool
  ON tasks (user_id, tool_name, created_at);

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_project
  ON tasks (user_id, workspace_project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tasks_connect_grant
  ON tasks (user_id, connect_grant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_workflows_agent
  ON workflows (user_id, agent_id, created_at);

CREATE INDEX IF NOT EXISTS idx_workflows_workspace_project
  ON workflows (user_id, workspace_project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_agent_session
  ON workflow_runs (user_id, agent_session_id, started_at);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_id TEXT,
  thread_id TEXT,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  workflow_id TEXT,
  connect_app_id TEXT,
  workspace_project_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE SET NULL,
  FOREIGN KEY (connect_app_id) REFERENCES connect_apps(id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_project_id) REFERENCES workspace_projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user
  ON agent_sessions (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_thread
  ON agent_sessions (user_id, thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent
  ON agent_sessions (user_id, agent_id, created_at);
