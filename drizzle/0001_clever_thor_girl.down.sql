-- Rollback: per-period evaluation participation settings.
-- Data loss: YES. This removes participation flags created by the up migration.
BEGIN;
DROP TABLE IF EXISTS evaluation_participations;
COMMIT;
