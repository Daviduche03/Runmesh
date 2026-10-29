-- 0036: tool registry + enforcement label on decisions.
-- Managed tools (no local execute) are registered here at agents:resolve and
-- executed by Runmesh, which injects the connection credential. Local tools
-- stay cooperative. The `enforcement` column records which one applied, so the
-- product never overstates a control.
CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,                    -- the ref the wrapper calls
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
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tools_workspace
  ON tools (workspace_id, name);

ALTER TABLE policy_decisions ADD COLUMN enforcement TEXT NOT NULL DEFAULT 'cooperative';
