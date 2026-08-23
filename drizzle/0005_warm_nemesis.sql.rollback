PRAGMA foreign_keys=OFF;
CREATE TABLE `__old_rating_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`criterion_id` text NOT NULL,
	`value` integer NOT NULL,
	`evidence_note` text,
	`moderation_status` text DEFAULT 'not_required' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `evaluation_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`criterion_id`) REFERENCES `criteria`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rating_observations_value_check" CHECK("__old_rating_observations"."value" BETWEEN 1 AND 5),
	CONSTRAINT "rating_observations_moderation_check" CHECK("__old_rating_observations"."moderation_status" IN ('not_required', 'pending', 'approved', 'redacted', 'rejected'))
);
INSERT INTO `__old_rating_observations`("id", "submission_id", "criterion_id", "value", "evidence_note", "moderation_status", "created_at") SELECT "id", "submission_id", "criterion_id", "value", "evidence_note", "moderation_status", "created_at" FROM `rating_observations` WHERE "response_status" = 'rated';
DROP TABLE `rating_observations`;
ALTER TABLE `__old_rating_observations` RENAME TO `rating_observations`;
PRAGMA foreign_keys=ON;
CREATE UNIQUE INDEX `idx_rating_observation_submission_criterion_unique` ON `rating_observations` (`submission_id`,`criterion_id`);
CREATE INDEX `idx_rating_observations_criterion` ON `rating_observations` (`criterion_id`);
