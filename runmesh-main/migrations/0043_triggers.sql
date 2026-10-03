-- 0043: agent-native triggers (phase 1: schedule + api).
-- A trigger is bound to an agent and, when it fires, opens an agent run and
-- delivers a signed callback to the agent's endpoint. agent_runs.trigger_id
-- carries the origin so the run's thread is one timeline. The agent's endpoint
-- is where the caller's agent app runs the agent (Runmesh does not run it).
CREATE TABLE IF NOT EXISTS triggers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  type TEXT NOT NULL CHECK (type IN ('event','schedule','api')),
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config TEXT NOT NULL DEFAULT '{}',
  last_fired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_triggers_workspace
  ON triggers (workspace_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_triggers_schedule
  ON triggers (workspace_id, type, enabled);

ALTER TABLE agent_runs ADD COLUMN trigger_id TEXT;
ALTER TABLE agents ADD COLUMN endpoint_url TEXT;
ALTER TABLE agents ADD COLUMN endpoint_secret_enc TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_runs_trigger
  ON agent_runs (trigger_id) WHERE trigger_id IS NOT NULL;
