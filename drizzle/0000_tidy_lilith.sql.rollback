-- Rollback: foundation schema.
-- Data loss: YES. This removes all product records created by the up migration.
BEGIN;
DROP TABLE IF EXISTS rating_observations;
DROP TABLE IF EXISTS evaluation_submissions;
DROP TABLE IF EXISTS result_snapshots;
DROP TABLE IF EXISTS integrity_alerts;
DROP TABLE IF EXISTS review_requests;
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS shift_assignments;
DROP TABLE IF EXISTS shifts;
DROP TABLE IF EXISTS evaluation_periods;
DROP TABLE IF EXISTS criteria;
DROP TABLE IF EXISTS policy_versions;
DROP TABLE IF EXISTS tip_agreement_participants;
DROP TABLE IF EXISTS tip_agreements;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS organizations;
COMMIT;
