-- P4: Environment / project scoping for grants
ALTER TABLE connect_grants ADD COLUMN project_id TEXT;
ALTER TABLE connect_grants ADD COLUMN environment TEXT CHECK (environment IN ('dev','staging','prod'));
CREATE INDEX IF NOT EXISTS idx_grants_project_env ON connect_grants(project_id, environment) WHERE project_id IS NOT NULL;
