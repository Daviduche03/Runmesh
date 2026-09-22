-- 0039: base_url for mediated egress.
-- A forward-mode managed tool keeps its own request (the dev's SDK builds it);
-- Runmesh forwards it and injects the credential. The host is fixed by the
-- registry, so the caller supplies only a path — no arbitrary-host SSRF.
ALTER TABLE tools ADD COLUMN base_url TEXT;
