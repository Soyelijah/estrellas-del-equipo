-- Purpose: apply the agreed rule that head waiters can evaluate coworkers but cannot be evaluated.
-- Table affected: evaluation_participations. Existing evaluations are preserved.
UPDATE `evaluation_participations`
SET `can_be_evaluated` = 0,
    `exclusion_reason` = 'head_waiter_excluded',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `membership_id` IN (
  SELECT `id`
  FROM `memberships`
  WHERE `role` <> 'admin' AND `job_title` = 'head_waiter'
);
