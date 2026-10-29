-- 0033: policy rules, workspace-scoped and ordered.
-- Prose is the source of truth; conditions are stored as JSON and compiled
-- to Rego on read. Evaluation is dry-run only (no enforcement path yet) —
-- metrics stay zero until the execution layer evaluates live traffic.
CREATE TABLE IF NOT EXISTS policy_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  priority INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  conditions TEXT NOT NULL DEFAULT '[]',
  action TEXT NOT NULL DEFAULT 'escalate' CHECK (action IN ('allow','escalate','consent','deny')),
  scope TEXT NOT NULL DEFAULT 'all scopes',
  mode TEXT NOT NULL DEFAULT 'log-only' CHECK (mode IN ('enforce','log-only')),
  caps TEXT NOT NULL DEFAULT '{}',
  reversibility TEXT NOT NULL DEFAULT 'reversible' CHECK (reversibility IN ('reversible','undoable','irreversible')),
  impact TEXT NOT NULL DEFAULT 'internal' CHECK (impact IN ('low','internal','external','consequential')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, priority)
);

CREATE INDEX IF NOT EXISTS idx_policy_rules_workspace
  ON policy_rules (workspace_id, priority);
