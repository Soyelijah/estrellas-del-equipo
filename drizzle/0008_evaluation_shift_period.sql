ALTER TABLE `shifts` ADD COLUMN `period_id` text REFERENCES evaluation_periods(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX `idx_shifts_period_starts_at` ON `shifts` (`period_id`,`starts_at`);
--> statement-breakpoint
UPDATE `shifts`
SET `period_id` = (
  SELECT es.period_id
  FROM evaluation_submissions es
  WHERE es.shift_id = shifts.id
  ORDER BY es.submitted_at
  LIMIT 1
)
WHERE `period_id` IS NULL;
