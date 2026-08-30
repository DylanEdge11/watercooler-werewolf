-- Canonicalize the protective role introduced in the first MVP.
UPDATE game_role_counts SET role_key = 'BODYGUARD' WHERE role_key = 'DOCTOR';
--> statement-breakpoint
UPDATE role_assignments SET role_key = 'BODYGUARD' WHERE role_key = 'DOCTOR';
--> statement-breakpoint
UPDATE assignment_batches SET assignments_json = REPLACE(assignments_json, '"DOCTOR"', '"BODYGUARD"');
--> statement-breakpoint
UPDATE resolution_proposals SET outcome_json = REPLACE(outcome_json, '"DOCTOR"', '"BODYGUARD"'), override_json = REPLACE(override_json, '"DOCTOR"', '"BODYGUARD"');
--> statement-breakpoint
UPDATE game_events SET payload_json = REPLACE(payload_json, 'DOCTOR', 'BODYGUARD');
--> statement-breakpoint

ALTER TABLE games ADD COLUMN stopped_at TEXT;
--> statement-breakpoint
ALTER TABLE games ADD COLUMN stopped_by_moderator_id TEXT REFERENCES moderator_accounts(id);
--> statement-breakpoint
ALTER TABLE games ADD COLUMN stop_reason TEXT;
--> statement-breakpoint
ALTER TABLE games ADD COLUMN reset_at TEXT;
--> statement-breakpoint
ALTER TABLE games ADD COLUMN reset_by_moderator_id TEXT REFERENCES moderator_accounts(id);
--> statement-breakpoint
ALTER TABLE backup_exports ADD COLUMN payload_json TEXT;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY NOT NULL,
  window_started_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pilot_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  respondent_type TEXT NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pilot_feedback_game_time ON pilot_feedback(game_id, created_at);
