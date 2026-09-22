-- Initial schema for Runmesh
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  github_id TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL,
  retries INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  scheduled_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  execution_type TEXT NOT NULL,
  step_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id),
  workflow_id TEXT,
  payload_template TEXT,
  url_template TEXT,
  response_body TEXT,
  response_status INTEGER,
  action_kind TEXT NOT NULL DEFAULT 'http',
  action_name TEXT,
  agent_id TEXT,
  agent_session_id TEXT,
  thread_id TEXT,
  tool_name TEXT,
  actor_user_id TEXT,
  approval_status TEXT NOT NULL DEFAULT 'not_required',
  approval_id TEXT,
  connect_app_id TEXT,
  connect_grant_id TEXT,
  connect_session_id TEXT,
  workspace_project_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  signing_secret TEXT
);

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

CREATE INDEX IF NOT EXISTS idx_tasks_workspace
  ON tasks (workspace_id, status, created_at);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  trigger_config TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  user_id TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  graph TEXT,
  agent_id TEXT,
  thread_id TEXT,
  workspace_project_id TEXT,
  connect_app_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  triggered_by TEXT NOT NULL DEFAULT 'manual',
  current_step INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  user_id TEXT NOT NULL,
  agent_session_id TEXT,
  thread_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_workflows_agent
  ON workflows (user_id, agent_id, created_at);

CREATE INDEX IF NOT EXISTS idx_workflows_workspace_project
  ON workflows (user_id, workspace_project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_workflows_workspace
  ON workflows (workspace_id, status);

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
  FOREIGN KEY (workspace_project_id) REFERENCES workspace_projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id),
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_agents_user
  ON agents (user_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_agents_workspace
  ON agents (workspace_id, status);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  type TEXT NOT NULL DEFAULT 'personal' CHECK (type IN ('personal','work')),
  slug TEXT,
  avatar_url TEXT,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','enterprise')),
  seats INTEGER NOT NULL DEFAULT 1 CHECK (seats >= 1),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner
  ON workspaces (owner_user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_owner_personal
  ON workspaces (owner_user_id) WHERE type = 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_slug
  ON workspaces (slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user
  ON workspace_members (user_id);

CREATE TABLE IF NOT EXISTS workspace_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','expired','revoked')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by_user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_invites_workspace
  ON workspace_invites (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_invites_token
  ON workspace_invites (token_hash);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_agent
  ON agent_sessions (user_id, agent_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id),
  permissions TEXT NOT NULL DEFAULT 'read',
  is_active INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS workspace_projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  prefix TEXT NOT NULL,
  bucket TEXT NOT NULL,
  local_path TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (user_id, prefix)
);

CREATE INDEX IF NOT EXISTS idx_workspace_projects_user
  ON workspace_projects (user_id);

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT 'task.completed',
  status TEXT NOT NULL DEFAULT 'active',
  secret TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_dead_letters (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event TEXT NOT NULL,
  event_id TEXT NOT NULL,
  body TEXT NOT NULL,
  last_status_code INTEGER,
  last_error TEXT,
  attempts INTEGER NOT NULL,
  failed_at TEXT NOT NULL,
  replayed_at TEXT,
  workspace_id TEXT REFERENCES workspaces(id),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_keys_workspace
  ON api_keys (workspace_id, is_active);

CREATE INDEX IF NOT EXISTS idx_webhooks_workspace
  ON webhooks (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_dead_letters_workspace
  ON webhook_dead_letters (workspace_id);
