CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text,
	`phone` text,
	`bio` text,
	`hired_on` text,
	`avatar_mime_type` text,
	`avatar_base64` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by_membership_id` text,
	CONSTRAINT `user_profiles_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `user_profiles_updated_by_fk` FOREIGN KEY (`updated_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `user_profiles_email_length_check` CHECK (`email` IS NULL OR length(`email`) <= 254),
	CONSTRAINT `user_profiles_phone_length_check` CHECK (`phone` IS NULL OR length(`phone`) <= 32),
	CONSTRAINT `user_profiles_bio_length_check` CHECK (`bio` IS NULL OR length(`bio`) <= 500),
	CONSTRAINT `user_profiles_hired_on_check` CHECK (`hired_on` IS NULL OR (`hired_on` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(`hired_on`) IS NOT NULL)),
	CONSTRAINT `user_profiles_avatar_mime_check` CHECK (`avatar_mime_type` IS NULL OR `avatar_mime_type` IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT `user_profiles_avatar_pair_check` CHECK ((`avatar_mime_type` IS NULL) = (`avatar_base64` IS NULL)),
	CONSTRAINT `user_profiles_avatar_size_check` CHECK (`avatar_base64` IS NULL OR length(`avatar_base64`) <= 218456)
);
--> statement-breakpoint
CREATE INDEX `idx_user_profiles_updated_by` ON `user_profiles` (`updated_by_membership_id`);
