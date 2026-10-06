CREATE INDEX `idx_operational_events_game_time` ON `operational_events` (`game_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_seats_email_lower` ON `seats` (lower("email"));--> statement-breakpoint
CREATE INDEX `idx_spectators_email_lower` ON `spectators` (lower("email"));