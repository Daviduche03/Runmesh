-- P2: Resource scoping + use limits
ALTER TABLE connect_grants ADD COLUMN max_uses INTEGER;
ALTER TABLE connect_grants ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_grants_max_uses ON connect_grants(max_uses) WHERE max_uses IS NOT NULL;
