-- 0022: Workspace tenancy boundary.
-- workspaces own shared resources; workspace_members governs who may act.
-- No behavior change: nothing references these tables yet.

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner
  ON workspaces (owner_user_id, status);

CREATE TABLE IF NOT EXISTS workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user
  ON workspace_members (user_id);

-- Backfill: one Personal workspace per existing user, with an owner row each.
INSERT OR IGNORE INTO workspaces (id, name, owner_user_id, status, metadata, created_at, updated_at)
SELECT 'ws_' || lower(hex(randomblob(16))), 'Personal', id, 'active', '{}',
       strftime('%Y-%m-%dT%H:%M:%f+00:00','now'),
       strftime('%Y-%m-%dT%H:%M:%f+00:00','now')
FROM users;

INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at)
SELECT 'wsm_' || lower(hex(randomblob(16))), w.id, w.owner_user_id, 'owner',
       strftime('%Y-%m-%dT%H:%M:%f+00:00','now'),
       strftime('%Y-%m-%dT%H:%M:%f+00:00','now')
FROM workspaces w;
