-- 0023: Re-scope agents to workspaces.
-- agents.workspace_id is the owner now; user_id stays through the transition
-- as provenance and will be dropped once services read workspace_id.
-- Follow-ups (not this file): workspace_id on tasks/workflows/grants, plus a
-- require_membership check on every service entrypoint.

ALTER TABLE agents ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);

CREATE INDEX IF NOT EXISTS idx_agents_workspace
  ON agents (workspace_id, status);

UPDATE agents
SET workspace_id = (SELECT id FROM workspaces WHERE owner_user_id = agents.user_id LIMIT 1)
WHERE workspace_id IS NULL;
