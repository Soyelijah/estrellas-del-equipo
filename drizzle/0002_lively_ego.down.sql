-- Rollback: restore the original percentage-based column.
-- Data loss: NO. Existing weight values are copied back into the former column.
PRAGMA foreign_keys=OFF;
CREATE TABLE `__old_tip_agreement_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`agreement_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`percentage_basis_points` integer NOT NULL,
	`accepted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`agreement_id`) REFERENCES `tip_agreements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tip_agreement_percentage_check" CHECK("__old_tip_agreement_participants"."percentage_basis_points" >= 0 AND "__old_tip_agreement_participants"."percentage_basis_points" <= 10000)
);
INSERT INTO `__old_tip_agreement_participants`("id", "agreement_id", "membership_id", "percentage_basis_points", "accepted_at", "created_at") SELECT "id", "agreement_id", "membership_id", "weight_points", "accepted_at", "created_at" FROM `tip_agreement_participants`;
DROP TABLE `tip_agreement_participants`;
ALTER TABLE `__old_tip_agreement_participants` RENAME TO `tip_agreement_participants`;
PRAGMA foreign_keys=ON;
CREATE UNIQUE INDEX `idx_tip_agreement_participant_unique` ON `tip_agreement_participants` (`agreement_id`,`membership_id`);
CREATE INDEX `idx_tip_agreement_participants_membership` ON `tip_agreement_participants` (`membership_id`);
