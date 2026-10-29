-- Drop tables that never had a reader: agent_sessions was scaffolded for a
-- session concept that never shipped, and connect_account_sessions has an ORM
-- model but no service ever created or read rows through it.
DROP TABLE IF EXISTS agent_sessions;
DROP TABLE IF EXISTS connect_account_sessions;
