CREATE TABLE `spectator_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`spectator_id` text NOT NULL,
	`body` text,
	`deleted_by_moderator_id` text,
	`deleted_at` text,
	`purged_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `chat_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`spectator_id`) REFERENCES `spectators`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deleted_by_moderator_id`) REFERENCES `moderator_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_spectator_messages_room_time` ON `spectator_messages` (`room_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `spectator_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`spectator_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`session_version` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`spectator_id`) REFERENCES `spectators`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_spectator_sessions_token` ON `spectator_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_spectator_sessions_owner` ON `spectator_sessions` (`spectator_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `spectators` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`status` text DEFAULT 'INVITED' NOT NULL,
	`claim_code_hash` text NOT NULL,
	`pin_hash` text,
	`session_version` integer DEFAULT 1 NOT NULL,
	`added_by_moderator_id` text,
	`claimed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by_moderator_id`) REFERENCES `moderator_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_spectators_claim_code` ON `spectators` (`claim_code_hash`);--> statement-breakpoint
CREATE INDEX `idx_spectators_game_status` ON `spectators` (`game_id`,`status`);