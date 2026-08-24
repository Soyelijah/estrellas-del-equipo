-- Purpose: remove historical scores for people who are no longer eligible to be evaluated.
-- Data is preserved for audit and can be inspected by the administrator as voided history.
UPDATE `evaluation_submissions`
SET `status` = 'voided'
WHERE `status` <> 'voided'
  AND EXISTS (
    SELECT 1
    FROM `evaluation_participations` participation
    WHERE participation.`period_id` = `evaluation_submissions`.`period_id`
      AND participation.`membership_id` = `evaluation_submissions`.`subject_membership_id`
      AND participation.`can_be_evaluated` = 0
  );
