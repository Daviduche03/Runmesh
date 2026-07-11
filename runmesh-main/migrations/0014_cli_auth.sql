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

CREATE INDEX IF NOT EXISTS idx_cli_auth_codes_device_code
  ON cli_auth_codes (device_code);

CREATE INDEX IF NOT EXISTS idx_cli_auth_codes_user_code
  ON cli_auth_codes (user_code);

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
