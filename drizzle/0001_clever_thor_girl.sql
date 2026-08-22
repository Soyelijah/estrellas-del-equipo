CREATE TABLE `evaluation_participations` (
	`id` text PRIMARY KEY NOT NULL,
	`period_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`can_evaluate` integer DEFAULT true NOT NULL,
	`can_be_evaluated` integer DEFAULT true NOT NULL,
	`exclusion_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`period_id`) REFERENCES `evaluation_periods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_evaluation_participation_period_member_unique` ON `evaluation_participations` (`period_id`,`membership_id`);--> statement-breakpoint
CREATE INDEX `idx_evaluation_participation_membership` ON `evaluation_participations` (`membership_id`);