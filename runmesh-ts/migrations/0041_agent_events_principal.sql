-- 0041: per-event principal on agent telemetry. Managed tool steps record the
-- connection identity actually used, so a step is attributed to its principal
-- even when it differs from the run's. Nullable: SDK-ingested local events
-- predate it and fall back to the run's principal at read time.
ALTER TABLE agent_events ADD COLUMN connect_user_id TEXT;
