-- 0035: policy decisions — the evaluation ledger.
-- Every issuance evaluation writes a row: what policy decided, against which
-- rule, and whether it was enforced. This is what turns the Policies page's
-- oversight metrics from zeros into real signal, and it is the tuning input
-- for coverage gaps. log-only (shadow) matches are recorded with enforced = 0
-- so a rule can be watched before it is allowed to act.
CREATE TABLE IF NOT EXISTS policy_decisions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  rule_id TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('allow','escalate','consent','deny')),
  mode TEXT NOT NULL DEFAULT 'none' CHECK (mode IN ('enforce','log-only','none')),
  enforced INTEGER NOT NULL DEFAULT 0,
  default_applied INTEGER NOT NULL DEFAULT 0,
  action TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '',
  resource TEXT NOT NULL DEFAULT '',
  agent_id TEXT,
  agent_label TEXT NOT NULL DEFAULT '',
  connect_user_id TEXT,
  user_label TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'grant',
  grant_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_policy_decisions_workspace
  ON policy_decisions (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_decisions_rule
  ON policy_decisions (workspace_id, rule_id);
CREATE INDEX IF NOT EXISTS idx_policy_decisions_grant
  ON policy_decisions (grant_id) WHERE grant_id IS NOT NULL;
