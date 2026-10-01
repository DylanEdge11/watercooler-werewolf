CREATE TABLE `moderator_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`moderator_id` text NOT NULL,
	`body` text,
	`deleted_by_moderator_id` text,
	`deleted_at` text,
	`purged_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `chat_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`moderator_id`) REFERENCES `moderator_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_moderator_id`) REFERENCES `moderator_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_moderator_messages_room_time` ON `moderator_messages` (`room_id`,`created_at`);