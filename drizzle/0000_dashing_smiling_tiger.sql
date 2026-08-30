CREATE TABLE `action_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`phase_id` text NOT NULL,
	`actor_seat_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_ids_json` text NOT NULL,
	`version` integer NOT NULL,
	`submitted_at` text NOT NULL,
	`superseded_at` text,
	FOREIGN KEY (`phase_id`) REFERENCES `phases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_seat_id`) REFERENCES `seats`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_actions_revision` ON `action_submissions` (`phase_id`,`actor_seat_id`,`kind`,`version`);--> statement-breakpoint
CREATE INDEX `idx_actions_current` ON `action_submissions` (`phase_id`,`kind`,`superseded_at`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`moderator_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`email_subject` text NOT NULL,
	`email_body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`moderator_id`) REFERENCES `moderator_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_announcements_game_time` ON `announcements` (`game_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `assignment_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`revision` integer NOT NULL,
	`assignments_json` text NOT NULL,
	`random_evidence_hash` text NOT NULL,
	`released_at` text,
	`created_by_moderator_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_moderator_id`) REFERENCES `moderator_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_assignment_batches_revision` ON `assignment_batches` (`game_id`,`revision`);--> statement-breakpoint
CREATE TABLE `backup_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`moderator_id` text NOT NULL,
	`schema_version` integer NOT NULL,
	`checksum` text NOT NULL,
	`exported_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`moderator_id`) REFERENCES `moderator_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_backup_exports_game_time` ON `backup_exports` (`game_id`,`exported_at`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`author_seat_id` text NOT NULL,
	`body` text,
	`deleted_by_moderator_id` text,
	`deleted_at` text,
	`purged_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `chat_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_seat_id`) REFERENCES `seats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_moderator_id`) REFERENCES `moderator_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_room_time` ON `chat_messages` (`room_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `chat_room_members` (
	`room_id` text NOT NULL,
	`seat_id` text NOT NULL,
	`access` text NOT NULL,
	`granted_at` text NOT NULL,
	`revoked_at` text,
	PRIMARY KEY(`room_id`, `seat_id`),
	FOREIGN KEY (`room_id`) REFERENCES `chat_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seat_id`) REFERENCES `seats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_members_seat` ON `chat_room_members` (`seat_id`,`access`);--> statement-breakpoint
CREATE TABLE `chat_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chat_rooms_game_type` ON `chat_rooms` (`game_id`,`type`);--> statement-breakpoint
CREATE TABLE `game_events` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`phase_id` text,
	`event_type` text NOT NULL,
	`actor_moderator_id` text,
	`actor_seat_id` text,
	`payload_json` text NOT NULL,
	`supersedes_event_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`phase_id`) REFERENCES `phases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_moderator_id`) REFERENCES `moderator_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_seat_id`) REFERENCES `seats`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_game_events_timeline` ON `game_events` (`game_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_game_events_phase` ON `game_events` (`phase_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `game_moderators` (
	`game_id` text NOT NULL,
	`moderator_id` text NOT NULL,
	`role` text NOT NULL,
	`added_at` text NOT NULL,
	PRIMARY KEY(`game_id`, `moderator_id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`moderator_id`) REFERENCES `moderator_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_game_moderators_moderator` ON `game_moderators` (`moderator_id`);--> statement-breakpoint
CREATE TABLE `game_role_counts` (
	`game_id` text NOT NULL,
	`role_key` text NOT NULL,
	`count` integer NOT NULL,
	`power_snapshot` integer NOT NULL,
	PRIMARY KEY(`game_id`, `role_key`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`timezone` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`active_weekdays_json` text NOT NULL,
	`schedule_json` text NOT NULL,
	`day_divisor` integer DEFAULT 30 NOT NULL,
	`night_divisor` integer DEFAULT 30 NOT NULL,
	`hunter_window_minutes` integer DEFAULT 60 NOT NULL,
	`final_round_minutes` integer DEFAULT 60 NOT NULL,
	`chat_retention_days` integer DEFAULT 7 NOT NULL,
	`final_cutoff_at` text NOT NULL,
	`publication_mode` text DEFAULT 'REVIEW' NOT NULL,
	`created_by_moderator_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by_moderator_id`) REFERENCES `moderator_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_games_status` ON `games` (`status`);--> statement-breakpoint
CREATE INDEX `idx_games_owner` ON `games` (`created_by_moderator_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `moderator_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`recovery_codes_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_moderator_accounts_email` ON `moderator_accounts` (`email`);--> statement-breakpoint
CREATE TABLE `moderator_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`moderator_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`moderator_id`) REFERENCES `moderator_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_moderator_sessions_token` ON `moderator_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_moderator_sessions_owner` ON `moderator_sessions` (`moderator_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`seat_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`read_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`seat_id`) REFERENCES `seats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_seat_unread` ON `notifications` (`seat_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `operational_events` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text,
	`severity` text NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`details_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_operational_events_recent` ON `operational_events` (`severity`,`created_at`);--> statement-breakpoint
CREATE TABLE `phases` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'SCHEDULED' NOT NULL,
	`opens_at` text NOT NULL,
	`closes_at` text NOT NULL,
	`slots` integer NOT NULL,
	`divisor_snapshot` integer NOT NULL,
	`hunter_deadline_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`published_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_phases_game_sequence` ON `phases` (`game_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_phases_due` ON `phases` (`status`,`closes_at`);--> statement-breakpoint
CREATE INDEX `idx_phases_game_status` ON `phases` (`game_id`,`status`);--> statement-breakpoint
CREATE TABLE `resolution_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`phase_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`engine_version` text NOT NULL,
	`outcome_json` text NOT NULL,
	`random_rolls_json` text NOT NULL,
	`status` text DEFAULT 'PROPOSED' NOT NULL,
	`override_reason` text,
	`override_json` text,
	`reviewed_by_moderator_id` text,
	`reviewed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`phase_id`) REFERENCES `phases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by_moderator_id`) REFERENCES `moderator_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_resolution_phase_input` ON `resolution_proposals` (`phase_id`,`input_hash`);--> statement-breakpoint
CREATE INDEX `idx_resolution_phase_status` ON `resolution_proposals` (`phase_id`,`status`);--> statement-breakpoint
CREATE TABLE `role_assignments` (
	`game_id` text NOT NULL,
	`seat_id` text NOT NULL,
	`role_key` text NOT NULL,
	`assignment_batch_id` text NOT NULL,
	`revealed_at` text,
	PRIMARY KEY(`game_id`, `seat_id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seat_id`) REFERENCES `seats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignment_batch_id`) REFERENCES `assignment_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_role_assignments_game_role` ON `role_assignments` (`game_id`,`role_key`);--> statement-breakpoint
CREATE TABLE `seat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`seat_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`session_version` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`seat_id`) REFERENCES `seats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_seat_sessions_token` ON `seat_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_seat_sessions_owner` ON `seat_sessions` (`seat_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `seats` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`status` text DEFAULT 'INVITED' NOT NULL,
	`claim_code_hash` text NOT NULL,
	`pin_hash` text,
	`session_version` integer DEFAULT 1 NOT NULL,
	`alive` integer DEFAULT true NOT NULL,
	`predecessor_seat_id` text,
	`claimed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_seats_game_email` ON `seats` (`game_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_seats_claim_code` ON `seats` (`claim_code_hash`);--> statement-breakpoint
CREATE INDEX `idx_seats_game_status` ON `seats` (`game_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_seats_game_alive` ON `seats` (`game_id`,`alive`);