-- 0042: agent definition versions + run replay lineage.
-- resolve_agent used to overwrite the definition in place when the fingerprint
-- changed, bumping an int and losing history. Replay needs the exact definition
-- a run executed, so definitions become immutable: each fingerprint change
-- inserts a new agent_versions row, and runs are pinned to the version they ran.
-- Runs also gain replay lineage (mode, replay_of_run_id).
CREATE TABLE IF NOT EXISTS agent_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  version INTEGER NOT NULL,
  framework TEXT,
  model TEXT,
  system_prompt TEXT,
  tools TEXT NOT NULL DEFAULT '[]',
  fingerprint TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (agent_id, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_versions_agent
  ON agent_versions (agent_id, version);
CREATE INDEX IF NOT EXISTS idx_agent_versions_fingerprint
  ON agent_versions (agent_id, fingerprint) WHERE fingerprint IS NOT NULL;

ALTER TABLE agents ADD COLUMN current_version_id TEXT;

-- Backfill: one version per existing agent from its current fields.
INSERT INTO agent_versions (
  id, workspace_id, agent_id, version, framework, model, system_prompt, tools, fingerprint, created_at
)
SELECT
  'agv_' || substr(id, 4, 12), workspace_id, id, version, framework, model,
  system_prompt, tools, fingerprint, created_at
FROM agents;

UPDATE agents
SET current_version_id = 'agv_' || substr(id, 4, 12)
WHERE current_version_id IS NULL;

-- Runs are pinned to the version they executed; replay runs point at their origin.
ALTER TABLE agent_runs ADD COLUMN agent_version_id TEXT;
ALTER TABLE agent_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'live';
ALTER TABLE agent_runs ADD COLUMN replay_of_run_id TEXT;

UPDATE agent_runs
SET agent_version_id = (
  SELECT current_version_id FROM agents WHERE agents.id = agent_runs.agent_id
)
WHERE agent_version_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_version
  ON agent_runs (agent_version_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_replay_of
  ON agent_runs (replay_of_run_id) WHERE replay_of_run_id IS NOT NULL;
