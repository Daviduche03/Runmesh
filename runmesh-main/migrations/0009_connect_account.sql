ALTER TABLE connect_users ADD COLUMN primary_email TEXT;
ALTER TABLE connect_users ADD COLUMN primary_email_verified INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_connect_users_primary_email
  ON connect_users (primary_email)
  WHERE primary_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS connect_account_sessions (
  id TEXT PRIMARY KEY,
  connect_user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (connect_user_id) REFERENCES connect_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_connect_account_sessions_user
  ON connect_account_sessions (connect_user_id);

CREATE TABLE IF NOT EXISTS connect_otp_challenges (
  id TEXT PRIMARY KEY,
  connect_session_id TEXT NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  connect_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (connect_session_id) REFERENCES connect_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (connect_user_id) REFERENCES connect_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_connect_otp_challenges_session
  ON connect_otp_challenges (connect_session_id, status);
