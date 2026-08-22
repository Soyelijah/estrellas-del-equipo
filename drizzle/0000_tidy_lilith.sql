CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_membership_id` text,
	`action` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`reason` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_organization_created_at` ON `audit_events` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_events_object` ON `audit_events` (`object_type`,`object_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_events_actor_created_at` ON `audit_events` (`actor_membership_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `criteria` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_version_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`applicable_job_title` text,
	`measurement_type` text NOT NULL,
	`weight_basis_points` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`policy_version_id`) REFERENCES `policy_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "criteria_measurement_type_check" CHECK("criteria"."measurement_type" IN ('peer_rating', 'leader_observation', 'knowledge_check', 'operational_metric', 'improvement')),
	CONSTRAINT "criteria_weight_check" CHECK("criteria"."weight_basis_points" >= 0 AND "criteria"."weight_basis_points" <= 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_criteria_policy_code_unique` ON `criteria` (`policy_version_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_criteria_policy_category` ON `criteria` (`policy_version_id`,`category`);--> statement-breakpoint
CREATE TABLE `evaluation_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`policy_version_id` text NOT NULL,
	`name` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policy_version_id`) REFERENCES `policy_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "evaluation_periods_dates_check" CHECK("evaluation_periods"."ends_at" > "evaluation_periods"."starts_at"),
	CONSTRAINT "evaluation_periods_status_check" CHECK("evaluation_periods"."status" IN ('draft', 'open', 'closed', 'under_review', 'published'))
);
--> statement-breakpoint
CREATE INDEX `idx_evaluation_periods_organization_status` ON `evaluation_periods` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_evaluation_periods_organization_dates` ON `evaluation_periods` (`organization_id`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `evaluation_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`period_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`rater_membership_id` text NOT NULL,
	`subject_membership_id` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`submitted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`period_id`) REFERENCES `evaluation_periods`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rater_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "evaluation_submissions_no_self_check" CHECK("evaluation_submissions"."rater_membership_id" <> "evaluation_submissions"."subject_membership_id"),
	CONSTRAINT "evaluation_submissions_status_check" CHECK("evaluation_submissions"."status" IN ('submitted', 'reopened', 'voided'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_evaluation_submission_unique` ON `evaluation_submissions` (`period_id`,`shift_id`,`rater_membership_id`,`subject_membership_id`);--> statement-breakpoint
CREATE INDEX `idx_evaluation_submissions_subject_period` ON `evaluation_submissions` (`subject_membership_id`,`period_id`);--> statement-breakpoint
CREATE INDEX `idx_evaluation_submissions_rater_period` ON `evaluation_submissions` (`rater_membership_id`,`period_id`);--> statement-breakpoint
CREATE TABLE `integrity_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`period_id` text NOT NULL,
	`subject_membership_id` text,
	`type` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`evidence_json` text NOT NULL,
	`reviewed_by_membership_id` text,
	`resolved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`period_id`) REFERENCES `evaluation_periods`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "integrity_alerts_status_check" CHECK("integrity_alerts"."status" IN ('open', 'reviewing', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX `idx_integrity_alerts_organization_status` ON `integrity_alerts` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_integrity_alerts_period_subject` ON `integrity_alerts` (`period_id`,`subject_membership_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`job_title` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "memberships_role_check" CHECK("memberships"."role" IN ('worker', 'team_lead', 'admin', 'independent_reviewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memberships_organization_user_unique` ON `memberships` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_memberships_organization_role` ON `memberships` (`organization_id`,`role`);--> statement-breakpoint
CREATE INDEX `idx_memberships_user` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'America/Santiago' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	CONSTRAINT "organizations_status_check" CHECK("organizations"."status" IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE INDEX `idx_organizations_status` ON `organizations` (`status`);--> statement-breakpoint
CREATE TABLE `policy_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`version` integer NOT NULL,
	`effective_from` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`minimum_raters` integer DEFAULT 3 NOT NULL,
	`minimum_shifts` integer DEFAULT 3 NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "policy_versions_version_check" CHECK("policy_versions"."version" > 0),
	CONSTRAINT "policy_versions_minimums_check" CHECK("policy_versions"."minimum_raters" >= 2 AND "policy_versions"."minimum_shifts" >= 1),
	CONSTRAINT "policy_versions_status_check" CHECK("policy_versions"."status" IN ('draft', 'active', 'superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_policy_versions_organization_version_unique` ON `policy_versions` (`organization_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_policy_versions_organization_status` ON `policy_versions` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `rating_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`criterion_id` text NOT NULL,
	`value` integer NOT NULL,
	`evidence_note` text,
	`moderation_status` text DEFAULT 'not_required' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `evaluation_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`criterion_id`) REFERENCES `criteria`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rating_observations_value_check" CHECK("rating_observations"."value" BETWEEN 1 AND 5),
	CONSTRAINT "rating_observations_moderation_check" CHECK("rating_observations"."moderation_status" IN ('not_required', 'pending', 'approved', 'redacted', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rating_observation_submission_criterion_unique` ON `rating_observations` (`submission_id`,`criterion_id`);--> statement-breakpoint
CREATE INDEX `idx_rating_observations_criterion` ON `rating_observations` (`criterion_id`);--> statement-breakpoint
CREATE TABLE `result_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`period_id` text NOT NULL,
	`subject_membership_id` text NOT NULL,
	`criterion_id` text,
	`algorithm_version` integer NOT NULL,
	`score_milli` integer,
	`independent_raters` integer NOT NULL,
	`observed_shifts` integer NOT NULL,
	`confidence` text NOT NULL,
	`computed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`period_id`) REFERENCES `evaluation_periods`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`criterion_id`) REFERENCES `criteria`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "result_snapshots_score_check" CHECK("result_snapshots"."score_milli" IS NULL OR "result_snapshots"."score_milli" BETWEEN 1000 AND 5000),
	CONSTRAINT "result_snapshots_counts_check" CHECK("result_snapshots"."independent_raters" >= 0 AND "result_snapshots"."observed_shifts" >= 0),
	CONSTRAINT "result_snapshots_confidence_check" CHECK("result_snapshots"."confidence" IN ('insufficient', 'publishable'))
);
--> statement-breakpoint
CREATE INDEX `idx_result_snapshots_subject_period` ON `result_snapshots` (`subject_membership_id`,`period_id`);--> statement-breakpoint
CREATE TABLE `review_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`requested_by_membership_id` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reviewer_membership_id` text,
	`resolution` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewer_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "review_requests_status_check" CHECK("review_requests"."status" IN ('open', 'reviewing', 'upheld', 'adjusted', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
CREATE INDEX `idx_review_requests_organization_status` ON `review_requests` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_review_requests_object` ON `review_requests` (`object_type`,`object_id`);--> statement-breakpoint
CREATE TABLE `shift_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`shift_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`role_during_shift` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shift_assignments_shift_membership_unique` ON `shift_assignments` (`shift_id`,`membership_id`);--> statement-breakpoint
CREATE INDEX `idx_shift_assignments_membership` ON `shift_assignments` (`membership_id`);--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`section` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shifts_dates_check" CHECK("shifts"."ends_at" > "shifts"."starts_at"),
	CONSTRAINT "shifts_status_check" CHECK("shifts"."status" IN ('scheduled', 'open', 'closed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `idx_shifts_organization_starts_at` ON `shifts` (`organization_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `tip_agreement_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`agreement_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`percentage_basis_points` integer NOT NULL,
	`accepted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`agreement_id`) REFERENCES `tip_agreements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tip_agreement_percentage_check" CHECK("tip_agreement_participants"."percentage_basis_points" >= 0 AND "tip_agreement_participants"."percentage_basis_points" <= 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tip_agreement_participant_unique` ON `tip_agreement_participants` (`agreement_id`,`membership_id`);--> statement-breakpoint
CREATE INDEX `idx_tip_agreement_participants_membership` ON `tip_agreement_participants` (`membership_id`);--> statement-breakpoint
CREATE TABLE `tip_agreements` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_until` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tip_agreements_version_check" CHECK("tip_agreements"."version" > 0),
	CONSTRAINT "tip_agreements_status_check" CHECK("tip_agreements"."status" IN ('draft', 'active', 'superseded', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tip_agreements_organization_version_unique` ON `tip_agreements` (`organization_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_tip_agreements_organization_status` ON `tip_agreements` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`login_identifier` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text,
	`status` text DEFAULT 'invited' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	CONSTRAINT "users_status_check" CHECK("users"."status" IN ('invited', 'active', 'locked', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_login_identifier_unique` ON `users` (`login_identifier`);--> statement-breakpoint
CREATE INDEX `idx_users_status` ON `users` (`status`);