-- 0031: sessions carry workspace_id so the code -> session -> grant chain
-- binds to workspaces, not apps. Backfill from each session's app
-- (apps are workspace-scoped since 0030). Pending sessions expire within
-- SESSION_TTL_MINUTES, so legacy NULLs age out on their own.
ALTER TABLE connect_sessions ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);

UPDATE connect_sessions SET workspace_id = (
  SELECT workspace_id FROM connect_apps
  WHERE id = connect_sessions.connect_app_id
) WHERE workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_workspace
  ON connect_sessions (workspace_id, status);
