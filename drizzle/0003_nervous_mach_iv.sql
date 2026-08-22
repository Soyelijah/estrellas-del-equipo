ALTER TABLE `users` ADD `auth_subject` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_auth_subject_unique` ON `users` (`auth_subject`);