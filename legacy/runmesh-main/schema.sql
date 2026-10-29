-- Runmesh schema snapshot.
-- Generated from the applied migrations (0001-0042); the migrations are the
-- source of truth. Regenerate by dumping sqlite_master from a migrated D1.

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('tool.call','tool.result','model.request','model.response','policy.decision','error','log')),
  name TEXT NOT NULL DEFAULT '',
  args TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL DEFAULT '{}',
  truncated INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  created_at TEXT NOT NULL, connect_user_id TEXT,
  UNIQUE (run_id, seq)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  parent_run_id TEXT REFERENCES agent_runs(id),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  input TEXT,
  usage TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, thread_id TEXT, connect_user_id TEXT, agent_version_id TEXT, mode TEXT NOT NULL DEFAULT 'live', replay_of_run_id TEXT);

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

CREATE TABLE IF NOT EXISTS agent_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  version INTEGER NOT NULL,
  framework TEXT,
  model TEXT,
  system_prompt TEXT,
  tools TEXT NOT NULL DEFAULT '[]',
  fingerprint TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (agent_id, version)
);

CREATE TABLE IF NOT EXISTS "agents" (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  parent_agent_id TEXT,
  project_id TEXT,
  environment TEXT CHECK (environment IN ('dev','staging','prod')),
  public_key TEXT,
  key_fingerprint TEXT,
  key_rotated_at TEXT,
  suspended_at TEXT,
  suspended_reason TEXT,
  suspended_by_user_id TEXT,
  last_seen_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, framework TEXT, external_key TEXT, fingerprint TEXT, model TEXT, system_prompt TEXT, tools TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1, current_version_id TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT 'read', 
  is_active INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT, workspace_id TEXT REFERENCES workspaces(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cli_auth_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  device_code TEXT NOT NULL UNIQUE,
  user_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS connect_account_sessions (
  id TEXT PRIMARY KEY,
  connect_user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (connect_user_id) REFERENCES connect_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS connect_app_users (
  id TEXT PRIMARY KEY,
  connect_app_id TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  connect_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connect_app_id) REFERENCES connect_apps(id) ON DELETE CASCADE,
  FOREIGN KEY (connect_user_id) REFERENCES connect_users(id) ON DELETE CASCADE,
  UNIQUE (connect_app_id, external_user_id),
  UNIQUE (connect_app_id, connect_user_id)
);

CREATE TABLE IF NOT EXISTS connect_apps (
  id TEXT PRIMARY KEY,
  developer_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  client_secret_hash TEXT NOT NULL,
  redirect_uris TEXT NOT NULL DEFAULT '[]',
  allowed_providers TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, workspace_id TEXT REFERENCES workspaces(id),
  FOREIGN KEY (developer_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (developer_user_id, slug)
);

CREATE TABLE IF NOT EXISTS connect_audit_events (
  id TEXT PRIMARY KEY,
  connect_user_id TEXT,
  connect_app_id TEXT,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  resource_type TEXT,
  resource_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, agent_id TEXT, task_id TEXT, workflow_run_id TEXT, approval_required INTEGER DEFAULT 0, denial_reason TEXT, token_issued_at TEXT, token_expires_at TEXT, result TEXT DEFAULT 'success', error_code TEXT, error_message TEXT, request_id TEXT, workspace_id TEXT REFERENCES workspaces(id),
  FOREIGN KEY (connect_user_id) REFERENCES connect_users(id) ON DELETE SET NULL,
  FOREIGN KEY (connect_app_id) REFERENCES connect_apps(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS connect_connections (
  id TEXT PRIMARY KEY,
  connect_user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  scopes TEXT NOT NULL DEFAULT '[]',
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at TEXT,
  provider_account_id TEXT,
  provider_account_label TEXT,
  identity_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT, workspace_id TEXT REFERENCES workspaces(id),
  FOREIGN KEY (connect_user_id) REFERENCES connect_users(id) ON DELETE CASCADE,
  FOREIGN KEY (identity_id) REFERENCES connect_identities(id) ON DELETE SET NULL,
  UNIQUE (connect_user_id, provider)
);

CREATE TABLE IF NOT EXISTS "connect_grants" (
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

CREATE TABLE IF NOT EXISTS connect_identities (
  id TEXT PRIMARY KEY,
  connect_user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connect_user_id) REFERENCES connect_users(id) ON DELETE CASCADE,
  UNIQUE (provider, provider_subject)
);

CREATE TABLE IF NOT EXISTS "connect_otp_challenges" (
  id TEXT PRIMARY KEY,
  connect_app_id TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  connect_session_id TEXT,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  connect_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (connect_app_id) REFERENCES connect_apps(id) ON DELETE CASCADE,
  FOREIGN KEY (connect_session_id) REFERENCES connect_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (connect_user_id) REFERENCES connect_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS connect_sessions (
  id TEXT PRIMARY KEY,
  connect_app_id TEXT NOT NULL,
  external_user_id TEXT,
  mode TEXT NOT NULL,
  provider TEXT,
  scopes TEXT NOT NULL DEFAULT '[]',
  redirect_uri TEXT NOT NULL,
  state TEXT NOT NULL UNIQUE,
  connect_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL, email TEXT, workspace_id TEXT REFERENCES workspaces(id),
  FOREIGN KEY (connect_app_id) REFERENCES connect_apps(id) ON DELETE CASCADE,
  FOREIGN KEY (connect_user_id) REFERENCES connect_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS connect_users (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, primary_email TEXT, primary_email_verified INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  key TEXT NOT NULL,
  status INTEGER NOT NULL,
  response TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS policy_decisions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  rule_id TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('allow','escalate','consent','deny')),
  mode TEXT NOT NULL DEFAULT 'none' CHECK (mode IN ('enforce','log-only','none')),
  enforced INTEGER NOT NULL DEFAULT 0,
  default_applied INTEGER NOT NULL DEFAULT 0,
  action TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '',
  resource TEXT NOT NULL DEFAULT '',
  agent_id TEXT,
  agent_label TEXT NOT NULL DEFAULT '',
  connect_user_id TEXT,
  user_label TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'grant',
  grant_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
, enforcement TEXT NOT NULL DEFAULT 'cooperative', run_id TEXT);

CREATE TABLE IF NOT EXISTS policy_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  priority INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  conditions TEXT NOT NULL DEFAULT '[]',
  action TEXT NOT NULL DEFAULT 'escalate' CHECK (action IN ('allow','escalate','consent','deny')),
  scope TEXT NOT NULL DEFAULT 'all scopes',
  mode TEXT NOT NULL DEFAULT 'log-only' CHECK (mode IN ('enforce','log-only')),
  caps TEXT NOT NULL DEFAULT '{}',
  reversibility TEXT NOT NULL DEFAULT 'reversible' CHECK (reversibility IN ('reversible','undoable','irreversible')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, priority)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workflow_id TEXT
, step_order INTEGER DEFAULT 0, payload_template TEXT, url_template TEXT, response_body TEXT, response_status INTEGER, action_kind TEXT NOT NULL DEFAULT 'http', action_name TEXT, agent_id TEXT, agent_session_id TEXT, thread_id TEXT, tool_name TEXT, actor_user_id TEXT, approval_status TEXT NOT NULL DEFAULT 'not_required', approval_id TEXT, connect_app_id TEXT, connect_grant_id TEXT, connect_session_id TEXT, workspace_project_id TEXT, metadata TEXT NOT NULL DEFAULT '{}', signing_secret TEXT, workspace_id TEXT REFERENCES workspaces(id));

CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,                    
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  agent_id TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'local' CHECK (kind IN ('local','managed')),
  provider TEXT,
  action TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT 'POST' CHECK (method IN ('GET','POST','PUT','PATCH','DELETE')),
  url TEXT,
  auth_scheme TEXT NOT NULL DEFAULT 'none' CHECK (auth_scheme IN ('none','bearer','api_key','basic')),
  auth_header TEXT NOT NULL DEFAULT 'Authorization',
  auth_format TEXT NOT NULL DEFAULT 'Bearer {token}',
  resource_param TEXT,
  schema_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, base_url TEXT,
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, github_id TEXT, avatar_url TEXT);

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
  created_at TEXT NOT NULL
, workspace_id TEXT REFERENCES workspaces(id));

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT 'task.completed',
  status TEXT NOT NULL DEFAULT 'active',
  secret TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, workspace_id TEXT REFERENCES workspaces(id));

CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    triggered_by TEXT NOT NULL DEFAULT 'manual',
    current_step INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    user_id TEXT NOT NULL
, agent_session_id TEXT, thread_id TEXT, metadata TEXT NOT NULL DEFAULT '{}');

CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    trigger_config TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
, graph TEXT, agent_id TEXT, thread_id TEXT, workspace_project_id TEXT, connect_app_id TEXT, metadata TEXT NOT NULL DEFAULT '{}', workspace_id TEXT REFERENCES workspaces(id));

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

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'personal'
  CHECK (type IN ('personal','work')), slug TEXT, avatar_url TEXT, plan TEXT NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free','pro','enterprise')), seats INTEGER NOT NULL DEFAULT 1
  CHECK (seats >= 1),
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_events_run
  ON agent_events (run_id, seq);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent
  ON agent_runs (agent_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_runs_parent
  ON agent_runs (parent_run_id) WHERE parent_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_replay_of
  ON agent_runs (replay_of_run_id) WHERE replay_of_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_thread
  ON agent_runs (workspace_id, thread_id);

CREATE INDEX IF NOT EXISTS idx_agent_runs_version
  ON agent_runs (agent_version_id);

CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace
  ON agent_runs (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent
  ON agent_sessions (user_id, agent_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_thread
  ON agent_sessions (user_id, thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user
  ON agent_sessions (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_agent
  ON agent_sessions (user_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_versions_agent
  ON agent_versions (agent_id, version);

CREATE INDEX IF NOT EXISTS idx_agent_versions_fingerprint
  ON agent_versions (agent_id, fingerprint) WHERE fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents (parent_agent_id) WHERE parent_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agents_project ON agents (project_id, environment) WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agents_user ON agents (user_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents (workspace_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_workspace_external
  ON agents (workspace_id, external_key) WHERE external_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agents_workspace_fingerprint
  ON agents (workspace_id, fingerprint) WHERE fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_workspace
  ON api_keys (workspace_id, is_active);

CREATE INDEX IF NOT EXISTS idx_cli_auth_codes_device_code
  ON cli_auth_codes (device_code);

CREATE INDEX IF NOT EXISTS idx_cli_auth_codes_user_code
  ON cli_auth_codes (user_code);

CREATE INDEX IF NOT EXISTS idx_connect_account_sessions_user
  ON connect_account_sessions (connect_user_id);

CREATE INDEX IF NOT EXISTS idx_connect_app_users_connect_user
  ON connect_app_users (connect_user_id);

CREATE INDEX IF NOT EXISTS idx_connect_apps_developer
  ON connect_apps (developer_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_apps_workspace
  ON connect_apps (workspace_id) WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_workspace
  ON connect_audit_events (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS idx_connect_audit_app
  ON connect_audit_events (connect_app_id, created_at);

CREATE INDEX IF NOT EXISTS idx_connect_audit_grant_id ON connect_audit_events(resource_id) WHERE resource_type = 'grant';

CREATE INDEX IF NOT EXISTS idx_connect_audit_user
  ON connect_audit_events (connect_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_connect_connections_user
  ON connect_connections (connect_user_id);

CREATE INDEX IF NOT EXISTS idx_connections_workspace
  ON connect_connections (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS idx_connect_grants_app_user
  ON connect_grants (connect_app_id, connect_user_id);

CREATE INDEX IF NOT EXISTS idx_connect_grants_connection
  ON connect_grants (connection_id);

CREATE INDEX IF NOT EXISTS idx_grants_agent_id
  ON connect_grants(agent_id) WHERE agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grants_approval_status
  ON connect_grants(approval_status) WHERE approval_status = 'pending_approval';

CREATE INDEX IF NOT EXISTS idx_grants_max_uses
  ON connect_grants(max_uses) WHERE max_uses IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grants_project_env
  ON connect_grants(project_id, environment) WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grants_task_id
  ON connect_grants(created_by_task_id) WHERE created_by_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grants_user_agent
  ON connect_grants(connect_user_id, agent_id) WHERE agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grants_user_task
  ON connect_grants(connect_user_id, created_by_task_id) WHERE created_by_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grants_user_workflow
  ON connect_grants(connect_user_id, created_by_workflow_run_id) WHERE created_by_workflow_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grants_valid_until
  ON connect_grants(valid_until) WHERE valid_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grants_workflow_run_id
  ON connect_grants(created_by_workflow_run_id) WHERE created_by_workflow_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grants_workspace
  ON connect_grants (workspace_id, approval_status);

CREATE INDEX IF NOT EXISTS idx_grants_workspace_created
  ON connect_grants(workspace_id, created_at);

CREATE INDEX IF NOT EXISTS idx_connect_identities_email
  ON connect_identities (email)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_connect_identities_user
  ON connect_identities (connect_user_id);

CREATE INDEX IF NOT EXISTS idx_connect_otp_challenges_app_user
  ON connect_otp_challenges (connect_app_id, external_user_id, status);

CREATE INDEX IF NOT EXISTS idx_connect_sessions_state
  ON connect_sessions (state);

CREATE INDEX IF NOT EXISTS idx_sessions_workspace
  ON connect_sessions (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_connect_users_primary_email
  ON connect_users (primary_email)
  WHERE primary_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_policy_decisions_grant
  ON policy_decisions (grant_id) WHERE grant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_policy_decisions_rule
  ON policy_decisions (workspace_id, rule_id);

CREATE INDEX IF NOT EXISTS idx_policy_decisions_run
  ON policy_decisions (run_id) WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_policy_decisions_workspace
  ON policy_decisions (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS idx_policy_rules_workspace
  ON policy_rules (workspace_id, priority);

CREATE INDEX IF NOT EXISTS idx_tasks_agent
  ON tasks (user_id, agent_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tasks_connect_grant
  ON tasks (user_id, connect_grant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tasks_thread
  ON tasks (user_id, thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tasks_tool
  ON tasks (user_id, tool_name, created_at);

CREATE INDEX IF NOT EXISTS idx_tasks_workspace
  ON tasks (workspace_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_project
  ON tasks (user_id, workspace_project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tools_workspace
  ON tools (workspace_id, name);

CREATE INDEX IF NOT EXISTS idx_users_github_id ON users (github_id);

CREATE INDEX IF NOT EXISTS idx_dead_letters_workspace
  ON webhook_dead_letters (workspace_id);

CREATE INDEX IF NOT EXISTS idx_webhooks_workspace
  ON webhooks (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_agent_session
  ON workflow_runs (user_id, agent_session_id, started_at);

CREATE INDEX IF NOT EXISTS idx_workflows_agent
  ON workflows (user_id, agent_id, created_at);

CREATE INDEX IF NOT EXISTS idx_workflows_workspace
  ON workflows (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_workflows_workspace_project
  ON workflows (user_id, workspace_project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_invites_token
  ON workspace_invites (token_hash);

CREATE INDEX IF NOT EXISTS idx_invites_workspace
  ON workspace_invites (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user
  ON workspace_members (user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_projects_user
  ON workspace_projects (user_id);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner
  ON workspaces (owner_user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_owner_personal
  ON workspaces (owner_user_id) WHERE type = 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_slug
  ON workspaces (slug) WHERE slug IS NOT NULL;
