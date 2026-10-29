ALTER TABLE users ADD COLUMN github_id TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;

CREATE INDEX IF NOT EXISTS idx_users_github_id ON users (github_id);
