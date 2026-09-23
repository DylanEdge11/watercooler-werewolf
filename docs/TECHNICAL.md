# Technical reference

Maintainer reference for the current Next.js/Vercel build. For user instructions, see [How to Use Watercooler Werewolf](HOW_TO_USE_WATERCOOLER_WEREWOLF.md); for installation, see [Operator setup](../VERCEL_SETUP_GUIDE.md).

## Runtime and database

Use Node.js 24.x LTS and npm. The package supports Node.js `>=24`; CI verifies Node 24.x. The application uses Next.js App Router, React, Drizzle, and libSQL. Local development uses a disposable SQLite file; deployed Vercel functions require a remote Turso/libSQL URL and token. Keep Preview and Production databases and secrets separate.

`npm run db:migrate` explicitly applies checked-in migrations. `ensureDatabase()` verifies the migration ledger; requests do not run DDL. `npm run owner:bootstrap` creates the first moderator from a trusted operator environment and displays recovery codes once. Public bootstrap is disabled. Do not put credentials or production values in the repository.

The schema is `db/schema.ts`. After schema changes, run `npm run db:generate`, inspect the SQL and metadata under `drizzle/`, and run `npx drizzle-kit check`. Do not apply duplicate migrations or infer repairs for a partial schema. Legacy `DOCTOR` rows are migrated to canonical `BODYGUARD`; Doctor is not a separate role.

## Rules and phase state

Role behavior and user workflows are maintained in the [user guide](HOW_TO_USE_WATERCOOLER_WEREWOLF.md). The implementation sources are:

| Concern | Source |
| --- | --- |
| Role catalog and presets | `lib/game/catalog.ts`, `lib/game/balance.ts` |
| Action eligibility and targets | `lib/game/actions.ts` |
| Tallies, protection, Hunter, wins | `lib/game/engine.ts` |
| Legal phase sequence | `lib/game/phase-policy.ts` |
| Live review/publication | `app/api/games/[gameId]/phases/route.ts` |
| Setup cancellation, Stop, Reset, restore | `app/api/games/[gameId]/operations/route.ts` |

After release, Day is first; ordinary phases alternate Day/Night. Each opened phase snapshots its elimination slots: `max(1, ceil(living / divisor))`. New games use divisor 30 for both Day and Night, a 60-minute Hunter window, and seven-day chat retention. Seer, Apprentice Seer, Bodyguard, and Hunter special actions each allow one target; Cupid pairs two seats once, and Mayor ballots count double.

Only the latest revision per actor/action counts. Targets must be living, unique, and legal for the role. Boundary ties use recorded random draws. The engine retains `proposedOutcome`, any `reviewedOutcome` during Hunter follow-up, and authoritative `publishedOutcome` separately. Overrides retain their reason, reviewer, and timestamp.

Publication applies eliminations, role reveals, private investigation and lover notices, room changes, timeline events, and victory evaluation. Apprentice Seers gain action access and the eliminated Seer's saved investigation history. Cupid pairings persist in game events after publication; a lover's elimination adds the partner to the same outcome. If that eliminates the Hunter, the normal Hunter follow-up still applies. Bodyguard protection blocks pack attacks only, and the public timeline reports a blocked attack without naming its protected target. Final showdown requires explicit entry after cutoff and a published ordinary phase; only Final ballots are then legal. A no-winner publication stays in showdown.

## Time and deadline monitoring

Deadline inputs are interpreted in the game's IANA timezone, stored as UTC ISO timestamps, and displayed in the viewer's locale or the explicitly labelled game timezone. Impossible calendar values and DST-gap times are rejected; an ambiguous fall-back time uses the earlier occurrence.

Weekday/day-night settings describe cadence. They do not automatically open phases, enforce weekdays, or publish results. Stored `AUTOMATIC` publication and final-round duration do not drive the review workflow.

The Operations panel polls and reconciles due deadlines every ten seconds and offers **Check deadlines**. Submissions are deadline-enforced server-side even when the console is closed. Locking and publication are separate steps.

An optional scheduler uses `CRON_SECRET` and `GET` or `POST /api/scheduler/deadlines` with `Authorization: Bearer <token>`. Without the secret, it returns HTTP 503. No Vercel Cron is configured in `vercel.json`; configure any external scheduler explicitly. The old `WATERCOOLER_SCHEDULER_TOKEN` name is not used by this build.

## Authentication and privacy

Moderator and player sessions are opaque HTTP-only cookies stored as hashes in libSQL. Passwords and six-digit PINs use salted PBKDF2-SHA256 with 100,000 iterations. Mutations perform origin checks, authorization, and role/phase validation on the server.

Players receive their own role, permitted teammates/rooms, legal candidates, private results, and published events. Players sign in with invitation email and PIN, with the seat code retained as a fallback. Eliminated faction members become read-only in their former room and gain Afterlife. Moderators can inspect assignments and private rooms. Announcements include email-ready copy but no email provider sends it.

Rate limits are stored in libSQL and updated atomically. HTTP 429 includes `Retry-After`. Current limits include moderator login (5/15 minutes), player sign-in (8/15 minutes), claiming (3/hour), actions/chat (30/10 minutes), player feedback (3/hour), and moderator feedback (10/hour). See route implementations for the exact bucket scope.

Backups include private game state and audit evidence, exclude credential/session secrets, and carry a SHA-256 checksum. Restore rebuilds configuration, current roster, and composition in setup; it does not restore gameplay or credentials. See [Operations](OPERATIONS.md) for consequences.

## Verification and deployment records

`package.json` and `package-lock.json` are authoritative for installed dependencies. Use [Pilot testing](PILOT_TESTING.md#release-verification) for checks and [the hosted runbook](PLAYWRIGHT_HOSTED_RUNBOOK.md) for Preview verification. Audit counts are dated observations, not permanent properties.

[Implementation progress](IMPLEMENTATION_PROGRESS.md) and [Hosted QA](PLAYWRIGHT_HOSTED_QA_REPORT.md) record the September 19 Preview checkpoint. [BUILD_STATUS.md](../BUILD_STATUS.md) retains older Sites/Cloudflare history; it is not current hosting guidance. A Preview pass does not certify Production or performance/load readiness.
