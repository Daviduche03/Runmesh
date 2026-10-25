-- 0038: idempotency dedup for managed tool calls.
-- Timeouts invite retries; retries must never double-execute (e.g. a second
-- charge). When the caller supplies an idempotency key, the completed upstream
-- response is cached and replayed verbatim on duplicate delivery. Only
-- completed upstream responses are cached — never policy decisions, which must
-- be re-evaluated every time.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  key TEXT NOT NULL,
  status INTEGER NOT NULL,
  response TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, key)
);
