-- 0021: First-class agents table.
-- agent_id is a free-form string on tasks, workflows, connect_grants, and
-- agent_sessions. agents(id) is now the canonical key those columns reference.
-- SQLite cannot add FOREIGN KEY constraints to existing tables without a
-- rebuild, so (consistent with 0015/0018/0019/0020) the links stay as indexed
-- plain columns; only the new table carries an inline REFERENCES clause.

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_agents_user
  ON agents (user_id, status, created_at);

-- Backfill one agent row per distinct agent_id already referenced.
-- If the same free-form id appears under several users, the row keeps the
-- lexicographically smallest user_id; new writes must target one owner.
-- Rows whose user_id has no users row are skipped: agents.user_id carries a
-- real FOREIGN KEY (enforced by D1), so an agent cannot be owned by a
-- nonexistent user. Those orphaned references need their owner onboarded first.
INSERT OR IGNORE INTO agents (id, user_id, name, status, metadata, created_at, updated_at)
SELECT agent_id, user_id, '', 'active', '{}',
       strftime('%Y-%m-%dT%H:%M:%f+00:00','now'),
       strftime('%Y-%m-%dT%H:%M:%f+00:00','now')
FROM (
  SELECT agent_id, MIN(user_id) AS user_id FROM (
    SELECT agent_id, user_id FROM tasks WHERE agent_id IS NOT NULL AND agent_id != ''
    UNION ALL
    SELECT agent_id, user_id FROM workflows WHERE agent_id IS NOT NULL AND agent_id != ''
    UNION ALL
    SELECT agent_id, connect_user_id AS user_id FROM connect_grants WHERE agent_id IS NOT NULL AND agent_id != ''
    UNION ALL
    SELECT agent_id, user_id FROM agent_sessions WHERE agent_id IS NOT NULL AND agent_id != ''
  ) GROUP BY agent_id
)
WHERE user_id IN (SELECT id FROM users);

-- agent_sessions.agent_id had no index; add it so every link is indexed.
CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_agent
  ON agent_sessions (user_id, agent_id);
