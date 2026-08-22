-- Purpose: store each real worker's current agreed experience factor at account creation.
-- Table affected: memberships. Existing administrator memberships remain NULL.
ALTER TABLE `memberships` ADD `tip_factor_hundredths` integer
  CONSTRAINT `memberships_tip_factor_check`
  CHECK (`tip_factor_hundredths` IS NULL OR (`tip_factor_hundredths` BETWEEN 1 AND 100));
