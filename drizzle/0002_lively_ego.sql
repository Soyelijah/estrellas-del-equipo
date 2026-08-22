PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tip_agreement_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`agreement_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`weight_points` integer NOT NULL,
	`accepted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`agreement_id`) REFERENCES `tip_agreements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tip_agreement_weight_check" CHECK("__new_tip_agreement_participants"."weight_points" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_tip_agreement_participants`("id", "agreement_id", "membership_id", "weight_points", "accepted_at", "created_at") SELECT "id", "agreement_id", "membership_id", "percentage_basis_points", "accepted_at", "created_at" FROM `tip_agreement_participants`;--> statement-breakpoint
DROP TABLE `tip_agreement_participants`;--> statement-breakpoint
ALTER TABLE `__new_tip_agreement_participants` RENAME TO `tip_agreement_participants`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tip_agreement_participant_unique` ON `tip_agreement_participants` (`agreement_id`,`membership_id`);--> statement-breakpoint
CREATE INDEX `idx_tip_agreement_participants_membership` ON `tip_agreement_participants` (`membership_id`);
