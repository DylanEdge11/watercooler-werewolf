CREATE TABLE `moderator_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`setup_code_hash` text,
	`setup_used_at` text,
	`moderator_id` text,
	`decided_by_moderator_id` text,
	`decided_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`moderator_id`) REFERENCES `moderator_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_moderator_id`) REFERENCES `moderator_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_moderator_applications_game_email` ON `moderator_applications` (`game_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_moderator_applications_game_status` ON `moderator_applications` (`game_id`,`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_moderator_applications_setup_code` ON `moderator_applications` (`setup_code_hash`);--> statement-breakpoint
CREATE TABLE `signups` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`seat_id` text,
	`decided_by_moderator_id` text,
	`decided_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seat_id`) REFERENCES `seats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_moderator_id`) REFERENCES `moderator_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_signups_game_email` ON `signups` (`game_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_signups_game_status` ON `signups` (`game_id`,`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `games` ADD `signup_state` text DEFAULT 'NOT_OPEN' NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `signup_code` text;--> statement-breakpoint
ALTER TABLE `games` ADD `signup_note` text;--> statement-breakpoint
ALTER TABLE `games` ADD `moderator_applications_open` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_games_signup_code` ON `games` (`signup_code`);