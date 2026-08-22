PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rating_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`criterion_id` text NOT NULL,
	`response_status` text DEFAULT 'rated' NOT NULL,
	`value` integer,
	`evidence_note` text,
	`moderation_status` text DEFAULT 'not_required' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `evaluation_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`criterion_id`) REFERENCES `criteria`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rating_observations_response_check" CHECK(("__new_rating_observations"."response_status" = 'rated' AND "__new_rating_observations"."value" BETWEEN 1 AND 5) OR ("__new_rating_observations"."response_status" = 'not_observed' AND "__new_rating_observations"."value" IS NULL)),
	CONSTRAINT "rating_observations_moderation_check" CHECK("__new_rating_observations"."moderation_status" IN ('not_required', 'pending', 'approved', 'redacted', 'rejected'))
);
--> statement-breakpoint
INSERT INTO `__new_rating_observations`("id", "submission_id", "criterion_id", "response_status", "value", "evidence_note", "moderation_status", "created_at") SELECT "id", "submission_id", "criterion_id", 'rated', "value", "evidence_note", "moderation_status", "created_at" FROM `rating_observations`;--> statement-breakpoint
DROP TABLE `rating_observations`;--> statement-breakpoint
ALTER TABLE `__new_rating_observations` RENAME TO `rating_observations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rating_observation_submission_criterion_unique` ON `rating_observations` (`submission_id`,`criterion_id`);--> statement-breakpoint
CREATE INDEX `idx_rating_observations_criterion` ON `rating_observations` (`criterion_id`);
