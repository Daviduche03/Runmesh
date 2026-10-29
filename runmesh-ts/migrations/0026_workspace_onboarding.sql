-- 0026: Workspace onboarding fields + invites.
-- type/slug/avatar/plan/seats on workspaces; one personal workspace per owner;
-- workspace_invites for email invites (token returned once at creation; only
-- the hash is stored). Email delivery is out of scope: callers receive the
-- invite link to send themselves.

ALTER TABLE workspaces ADD COLUMN type TEXT NOT NULL DEFAULT 'personal'
  CHECK (type IN ('personal','work'));
ALTER TABLE workspaces ADD COLUMN slug TEXT;
ALTER TABLE workspaces ADD COLUMN avatar_url TEXT;
ALTER TABLE workspaces ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free','pro','enterprise'));
ALTER TABLE workspaces ADD COLUMN seats INTEGER NOT NULL DEFAULT 1
  CHECK (seats >= 1);

-- Existing rows predate the column and take the default; make it explicit.
UPDATE workspaces SET type = 'personal' WHERE type IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_owner_personal
  ON workspaces (owner_user_id) WHERE type = 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_slug
  ON workspaces (slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS workspace_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','expired','revoked')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by_user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_invites_workspace
  ON workspace_invites (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_invites_token
  ON workspace_invites (token_hash);
