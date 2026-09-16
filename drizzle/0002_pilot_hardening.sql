ALTER TABLE games ADD COLUMN setup_revision INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE assignment_batches ADD COLUMN setup_revision INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE assignment_batches ADD COLUMN roster_fingerprint TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE assignment_batches ADD COLUMN composition_fingerprint TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE resolution_proposals ADD COLUMN published_outcome_json TEXT;
