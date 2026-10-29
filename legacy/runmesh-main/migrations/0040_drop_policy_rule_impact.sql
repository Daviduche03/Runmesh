-- 0040: drop the inert `impact` ("blast radius") column from policy rules.
-- It was accepted, validated, stored and returned, but never read by the
-- engine and never shown outside the rule editor. Removed so the policy
-- surface only presents controls that change a decision.
ALTER TABLE policy_rules DROP COLUMN impact;
