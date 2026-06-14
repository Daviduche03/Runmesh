-- Migration: Add workflows and workflow_runs tables + step_order to tasks
CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    trigger_config TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    triggered_by TEXT NOT NULL DEFAULT 'manual',
    current_step INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    user_id TEXT NOT NULL
);
