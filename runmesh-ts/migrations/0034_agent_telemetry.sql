-- 0034: agent telemetry collection (phase 1: directory + audit).
-- Agents gain definition fields (framework, external key, fingerprint,
-- model, prompt, tools manifest, version). Runs and events record
-- executions; full prompt text and tool schemas live on the agent row
-- once per version, referenced by runs, never duplicated per event.
ALTER TABLE agents ADD COLUMN framework TEXT;
ALTER TABLE agents ADD COLUMN external_key TEXT;
ALTER TABLE agents ADD COLUMN fingerprint TEXT;
ALTER TABLE agents ADD COLUMN model TEXT;
ALTER TABLE agents ADD COLUMN system_prompt TEXT;
ALTER TABLE agents ADD COLUMN tools TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agents ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_workspace_external
  ON agents (workspace_id, external_key) WHERE external_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agents_workspace_fingerprint
  ON agents (workspace_id, fingerprint) WHERE fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  parent_run_id TEXT REFERENCES agent_runs(id),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  input TEXT,
  usage TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace
  ON agent_runs (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent
  ON agent_runs (agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_parent
  ON agent_runs (parent_run_id) WHERE parent_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('tool.call','tool.result','model.request','model.response','policy.decision','error','log')),
  name TEXT NOT NULL DEFAULT '',
  args TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL DEFAULT '{}',
  truncated INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_agent_events_run
  ON agent_events (run_id, seq);
