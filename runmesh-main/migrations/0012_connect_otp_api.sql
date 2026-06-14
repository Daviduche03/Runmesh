PRAGMA foreign_keys = OFF;

CREATE TABLE connect_otp_challenges_new (
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

INSERT INTO connect_otp_challenges_new (
  id,
  connect_app_id,
  external_user_id,
  connect_session_id,
  email,
  code_hash,
  connect_user_id,
  status,
  expires_at,
  attempts,
  verified_at,
  created_at
)
SELECT
  c.id,
  s.connect_app_id,
  COALESCE(s.external_user_id, ''),
  c.connect_session_id,
  c.email,
  c.code_hash,
  c.connect_user_id,
  c.status,
  c.expires_at,
  c.attempts,
  c.verified_at,
  c.created_at
FROM connect_otp_challenges c
LEFT JOIN connect_sessions s ON s.id = c.connect_session_id;

DROP TABLE connect_otp_challenges;

ALTER TABLE connect_otp_challenges_new RENAME TO connect_otp_challenges;

CREATE INDEX IF NOT EXISTS idx_connect_otp_challenges_app_user
  ON connect_otp_challenges (connect_app_id, external_user_id, status);

PRAGMA foreign_keys = ON;
