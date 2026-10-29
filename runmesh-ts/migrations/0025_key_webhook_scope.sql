-- 0025: Workspace scoping for API keys, webhooks, and dead letters.
-- Credentials and delivery config belong to a workspace, not a user.
-- The API edge reads and writes by workspace_id with a membership check
-- (see services/workspaces.py); user_id columns stay as provenance.

ALTER TABLE api_keys ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
CREATE INDEX IF NOT EXISTS idx_api_keys_workspace
  ON api_keys (workspace_id, is_active);

ALTER TABLE webhooks ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
CREATE INDEX IF NOT EXISTS idx_webhooks_workspace
  ON webhooks (workspace_id, status);

ALTER TABLE webhook_dead_letters ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
CREATE INDEX IF NOT EXISTS idx_dead_letters_workspace
  ON webhook_dead_letters (workspace_id);

-- Backfill keys and webhooks from each row owner's earliest workspace.
UPDATE api_keys SET workspace_id = (
  SELECT workspace_id FROM workspace_members
  WHERE user_id = api_keys.user_id ORDER BY created_at LIMIT 1
) WHERE workspace_id IS NULL;

UPDATE webhooks SET workspace_id = (
  SELECT workspace_id FROM workspace_members
  WHERE user_id = webhooks.user_id ORDER BY created_at LIMIT 1
) WHERE workspace_id IS NULL;

-- Dead letters inherit their parent webhook's workspace.
UPDATE webhook_dead_letters SET workspace_id = (
  SELECT workspace_id FROM webhooks WHERE id = webhook_dead_letters.webhook_id
) WHERE workspace_id IS NULL;
