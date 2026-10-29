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
);
