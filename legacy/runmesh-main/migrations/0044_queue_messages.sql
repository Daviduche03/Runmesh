-- 0044: transport for the DB-backed queue that replaces Cloudflare Queues.
-- Claiming a message is an atomic DELETE; retries re-insert with backoff.
CREATE TABLE IF NOT EXISTS queue_messages (
  id TEXT PRIMARY KEY,
  queue TEXT NOT NULL,
  body TEXT NOT NULL,
  available_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_queue_due
  ON queue_messages (queue, available_at);
