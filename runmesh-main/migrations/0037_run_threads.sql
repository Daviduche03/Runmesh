-- 0037: threads + principals on the agent path.
-- The audit ledger groups by thread, but agent runs never carried one, so
-- everything the wrapper and policy engine wrote landed in "unchained".
-- Runs now open (or inherit) a thread, and record whose authority they act
-- under. Call-time decisions carry the run so they chain into its thread.
ALTER TABLE agent_runs ADD COLUMN thread_id TEXT;
ALTER TABLE agent_runs ADD COLUMN connect_user_id TEXT;
ALTER TABLE policy_decisions ADD COLUMN run_id TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_runs_thread
  ON agent_runs (workspace_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_policy_decisions_run
  ON policy_decisions (run_id) WHERE run_id IS NOT NULL;

-- Backfill: top-level runs open a thread named for themselves.
UPDATE agent_runs
SET thread_id = 'th_' || substr(id, 5, 12)
WHERE parent_run_id IS NULL AND thread_id IS NULL;

-- Children inherit from their parent. Repeated passes cover deeper chains.
UPDATE agent_runs
SET thread_id = (SELECT p.thread_id FROM agent_runs p WHERE p.id = agent_runs.parent_run_id)
WHERE parent_run_id IS NOT NULL AND thread_id IS NULL
  AND (SELECT p.thread_id FROM agent_runs p WHERE p.id = agent_runs.parent_run_id) IS NOT NULL;
UPDATE agent_runs
SET thread_id = (SELECT p.thread_id FROM agent_runs p WHERE p.id = agent_runs.parent_run_id)
WHERE parent_run_id IS NOT NULL AND thread_id IS NULL
  AND (SELECT p.thread_id FROM agent_runs p WHERE p.id = agent_runs.parent_run_id) IS NOT NULL;
UPDATE agent_runs
SET thread_id = (SELECT p.thread_id FROM agent_runs p WHERE p.id = agent_runs.parent_run_id)
WHERE parent_run_id IS NOT NULL AND thread_id IS NULL
  AND (SELECT p.thread_id FROM agent_runs p WHERE p.id = agent_runs.parent_run_id) IS NOT NULL;
