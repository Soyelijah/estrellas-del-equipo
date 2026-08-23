-- Rollback for secure account bootstrap persistence.
DROP TABLE IF EXISTS `bootstrap_guards`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_auth_sessions_user_expires_at`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_auth_sessions_token_hash_unique`;
--> statement-breakpoint
DROP TABLE IF EXISTS `auth_sessions`;
