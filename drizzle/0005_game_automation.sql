ALTER TABLE `games` ADD `review_window_minutes` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `automation_paused_at` text;--> statement-breakpoint
ALTER TABLE `games` ADD `schedule_mode` text DEFAULT 'MANUAL' NOT NULL;