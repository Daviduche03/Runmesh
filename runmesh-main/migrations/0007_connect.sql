CREATE TABLE IF NOT EXISTS connect_users (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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

CREATE INDEX IF NOT EXISTS idx_connect_identities_user
  ON connect_identities (connect_user_id);

CREATE INDEX IF NOT EXISTS idx_connect_identities_email
  ON connect_identities (email)
  WHERE email IS NOT NULL;

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
  updated_at TEXT NOT NULL,
  FOREIGN KEY (developer_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (developer_user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_connect_apps_developer
  ON connect_apps (developer_user_id);

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

CREATE INDEX IF NOT EXISTS idx_connect_app_users_connect_user
  ON connect_app_users (connect_user_id);

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
  revoked_at TEXT,
  FOREIGN KEY (connect_user_id) REFERENCES connect_users(id) ON DELETE CASCADE,
  FOREIGN KEY (identity_id) REFERENCES connect_identities(id) ON DELETE SET NULL,
  UNIQUE (connect_user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_connect_connections_user
  ON connect_connections (connect_user_id);

CREATE TABLE IF NOT EXISTS connect_grants (
  id TEXT PRIMARY KEY,
  connect_app_id TEXT NOT NULL,
  connect_user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connect_app_id) REFERENCES connect_apps(id) ON DELETE CASCADE,
  FOREIGN KEY (connect_user_id) REFERENCES connect_users(id) ON DELETE CASCADE,
  FOREIGN KEY (connection_id) REFERENCES connect_connections(id) ON DELETE CASCADE,
  UNIQUE (connect_app_id, connect_user_id, connection_id)
);

CREATE INDEX IF NOT EXISTS idx_connect_grants_app_user
  ON connect_grants (connect_app_id, connect_user_id);

CREATE INDEX IF NOT EXISTS idx_connect_grants_connection
  ON connect_grants (connection_id);

CREATE TABLE IF NOT EXISTS connect_access_requests (
  id TEXT PRIMARY KEY,
  connect_app_id TEXT NOT NULL,
  connect_user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  external_user_id TEXT,
  scopes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (connect_app_id) REFERENCES connect_apps(id) ON DELETE CASCADE,
  FOREIGN KEY (connect_user_id) REFERENCES connect_users(id) ON DELETE CASCADE,
  FOREIGN KEY (connection_id) REFERENCES connect_connections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_connect_access_requests_pending
  ON connect_access_requests (connect_user_id, status);

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
  created_at TEXT NOT NULL,
  FOREIGN KEY (connect_app_id) REFERENCES connect_apps(id) ON DELETE CASCADE,
  FOREIGN KEY (connect_user_id) REFERENCES connect_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_connect_sessions_state
  ON connect_sessions (state);

CREATE TABLE IF NOT EXISTS connect_identity_link_requests (
  id TEXT PRIMARY KEY,
  primary_connect_user_id TEXT NOT NULL,
  secondary_connect_user_id TEXT NOT NULL,
  matched_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (primary_connect_user_id) REFERENCES connect_users(id) ON DELETE CASCADE,
  FOREIGN KEY (secondary_connect_user_id) REFERENCES connect_users(id) ON DELETE CASCADE
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
  created_at TEXT NOT NULL,
  FOREIGN KEY (connect_user_id) REFERENCES connect_users(id) ON DELETE SET NULL,
  FOREIGN KEY (connect_app_id) REFERENCES connect_apps(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_connect_audit_user
  ON connect_audit_events (connect_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_connect_audit_app
  ON connect_audit_events (connect_app_id, created_at);
