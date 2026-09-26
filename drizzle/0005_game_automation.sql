ALTER TABLE `games` ADD `review_window_minutes` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `automation_paused_at` text;