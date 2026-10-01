CREATE TABLE `email_preferences` (
	`seat_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`unsubscribe_token` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`seat_id`) REFERENCES `seats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_email_preferences_token` ON `email_preferences` (`unsubscribe_token`);--> statement-breakpoint
ALTER TABLE `phases` ADD `closing_reminder_at` text;