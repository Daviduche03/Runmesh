-- 0027: Agent identity for the control plane.
-- Agents are principals: registered keys (sender-constrained/DPoP tokens),
-- a suspendable lifecycle, delegation parentage, and environment bounds.
-- Authority stays in grants/policy/audit — never on this row.
--
-- SQLite cannot ALTER a CHECK constraint, so agents is rebuilt to extend
-- status with 'suspended'. All existing rows are carried across untouched.
-- Every new column is nullable or defaulted; nothing existing breaks.

-- 1. full-shape table
CREATE TABLE agents_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  parent_agent_id TEXT,
  project_id TEXT,
  environment TEXT CHECK (environment IN ('dev','staging','prod')),
  public_key TEXT,
  key_fingerprint TEXT,
  key_rotated_at TEXT,
  suspended_at TEXT,
  suspended_reason TEXT,
  suspended_by_user_id TEXT,
  last_seen_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 2. carry every existing row across
INSERT INTO agents_new (
  id, workspace_id, user_id, name, status, metadata, created_at, updated_at
)
SELECT id, workspace_id, user_id, name, status, metadata, created_at, updated_at
FROM agents;

-- 3. swap (prior indexes were dropped with the old table — recreated below)
DROP TABLE agents;
ALTER TABLE agents_new RENAME TO agents;

-- 4. indexes: the two carried over, plus the new links
CREATE INDEX IF NOT EXISTS idx_agents_user ON agents (user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents (parent_agent_id) WHERE parent_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agents_project ON agents (project_id, environment) WHERE project_id IS NOT NULL;
