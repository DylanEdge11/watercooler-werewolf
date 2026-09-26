# Technical reference

For developers. Installation is in [Setup](SETUP.md), verification in [Testing](TESTING.md), and player-facing rules in the in-app guide (`app/guide/page.tsx`).

## Stack

- Next.js App Router with React, on Vercel's Node.js runtime (Node 24.x).
- Turso/libSQL through `@libsql/client`. Routes use a small database contract (`db/contracts.ts`) implemented in `db/libsql.ts`; multi-statement writes go through `batch()`, which runs as one transaction.
- Drizzle is used only for the schema (`db/schema.ts`) and for generating migrations. Queries are hand-written SQL with bound parameters.
- Local development and tests use a SQLite file or in-memory database. Deployed functions refuse `file:` URLs.
- Builds compile from source every time (`experimental.turbopackFileSystemCacheForBuild: false` in `next.config.ts`). With Turbopack's build cache on, a Vercel build restored from an older deployment served stale `globals.css` under a chunk name already published to Vercel's shared immutable asset store, so the page got the wrong styles. Don't turn it back on.

Requests never change the schema. `ensureDatabase()` checks that every version in `db/readiness.ts` is recorded in `__app_migrations` and fails otherwise. Migrations run only through `npm run db:migrate` (see [Setup](SETUP.md#schema-changes)).

## Where things live

| Concern | Source |
| --- | --- |
| Role catalog and default compositions | `lib/game/catalog.ts`, `lib/game/balance.ts` |
| Who may act, and on whom | `lib/game/actions.ts` |
| Tallies, protection, lovers, Hunter, win check | `lib/game/engine.ts` |
| Legal phase order and Final showdown entry | `lib/game/phase-policy.ts` |
| Deadlines and timezones | `lib/game/scheduling.ts` |
| Phase open, lock, Hunter, publish | `app/api/games/[gameId]/phases/route.ts` |
| Player submissions | `app/api/phases/[phaseId]/actions/route.ts` |
| Player dashboard data | `app/api/player/route.ts` |
| Stop, reset, restore, cancel, PIN reset | `app/api/games/[gameId]/operations/route.ts`, `lib/backup/` |
| Sessions, hashing, authorization | `lib/auth/` |
| Origin checks and rate limits | `lib/http/` |
| Layout and base styles | `app/globals.css` |
| Paper Theatre look (dashboard, sign-in, claim, `/guide`) | `app/paper-theatre.css` |
| Backstage look (moderator console, Player View Studio) | `app/paper-theatre-backstage.css` |
| Emblem and favicon | `app/brand-mark.tsx`, `public/favicon.svg` |
| Signed-out landing page | `app/landing/` |

## Game rules as implemented

- Before roles are randomized (game `DRAFT` or `REGISTRATION`), a moderator can add one player (`POST /api/games/[gameId]/seats`) or remove one unclaimed player (`DELETE /api/games/[gameId]/seats/[seatId]`) without touching other seats. The rules are in `lib/game/roster-edit.ts`: the roster stays within 6–80 players, claimed seats cannot be removed, and the change is absorbed by one Villager; if that would leave the counts invalid (for example, no Villager left), they reset to the standard preset for the new size. Each edit bumps `setup_revision`, discards any stale preview, rewrites the role counts, and records `SEAT_ADDED` or `SEAT_REMOVED` in one transaction that first re-checks the game state, roster size, and (for removal) that the seat is still unclaimed. A removed seat is archived as `REMOVED` with a new random claim hash, so its link stops working. Once a preview exists (`ASSIGNMENT_PREVIEW`) the roster is locked; saving the composition discards the preview and reopens it. Nothing can be added after release.
- After roles are released, the first phase is a Day; Day and Night then alternate. Each phase records its elimination slots when it opens: `max(1, ceil(living / divisor))`. Days and Nights have separate divisors (`day_divisor`, `night_divisor`), 30 by default, set per game under "Advanced: eliminations per phase" in the schedule form. They must be whole numbers from 1 to 80 and can change only while setup is editable (`lib/game/game-settings.ts`).
- Only each player's latest saved response counts. Targets must be living, unique, and legal for the role.
- The highest vote totals fill the slots. A tie across the last slot is resolved by a cryptographically random draw that is stored with the result.
- The Mayor's Day and Final ballot votes count twice. Bodyguard protection blocks only the pack's attack. Cupid pairs once; when one lover is eliminated, the other is added to the same result. The Apprentice Seer has no action while the Seer lives; afterwards they investigate each Night and see the Seer's past results.
- If the result eliminates a Hunter, the phase waits for the Hunter's shot before it can be published. The window is `hunter_window_minutes`: new games get 480 (8 hours) from the create-game route, and the schedule form edits it in hours (0.25 to 168) while setup is editable. The column default stays 60, so games created before version 1.4 keep 60 minutes unless changed during setup.
- `final_round_minutes` is stored, backed up, and restored but not used. It is reserved for a possible timed Final ballot and has no setting in the console.
- Each result is stored three ways: the engine's `proposedOutcome`, a `reviewedOutcome` after Hunter follow-up or override, and the authoritative `publishedOutcome`. Overrides record the reason, reviewer, and time.
- The Mayor's extra vote is never published. The public ballot lists one line per voter and players' vote counts are unweighted, so they can differ from the result. A Bodyguard save is announced ("Bodyguard protection stopped a pack attack") without naming who was protected.
- The "N of M submitted" counter (`participationCounter` in `lib/game/actions.ts`) counts across players only for Day ballots and the pack's vote. Every other action is counted for the reader alone, so the counter cannot reveal how many players hold another Night role.
- Publishing applies eliminations, reveals roles, delivers Seer and lover notifications, updates room access, and checks for a winner in one transaction.
- Final showdown requires the final cutoff to have passed and the latest phase to be published. After that, only Final ballots are allowed until a team wins.
- Legacy `DOCTOR` rows are read as `BODYGUARD`.

## Time

Deadlines are entered in the game's IANA timezone and stored as UTC. Impossible dates and times that fall in a daylight-saving gap are rejected; an ambiguous fall-back time uses the earlier instant. The weekday cadence on a game is informational. Nothing opens or publishes phases automatically, and the stored `AUTOMATIC` publication mode is unused.

## Authentication and privacy

- Moderator and player sessions are random tokens in HTTP-only, SameSite=Lax cookies (`ww_mod_session`, `ww_player_session`), stored as SHA-256 hashes. They last seven days.
- Passwords, PINs, and recovery codes are hashed with salted PBKDF2-SHA256 (100,000 iterations). Claim codes are 72-bit random tokens stored as SHA-256 hashes.
- Roster emails must be one plain address (`lib/roster/email-address.ts`): lists like `a@x.com;b@y.com` and `Name <a@x.com>` are rejected at import and when adding a player, because mail libraries split them and would send one player's claim link to several recipients. The invite route re-checks each stored address and reports any older or restored seat that fails as "Not a single email address" without changing its link.
- Invite email (`POST /api/games/[gameId]/invites`, optional `seatIds`) works only before roles are released and only on `INVITED` seats. It signs in to SMTP first, then replaces each seat's claim hash with a compare-and-swap on the old hash, emails the new link, and records an `INVITE_EMAILED` event (`{ seatId }`) only while that link is still current. The response never contains a claim link. The roster reports `invitationEmailedAt` from events newer than the seat's `updated_at`, so a later send, reset, or restore clears it. Settings are in `lib/email/settings.ts`.
- Every write checks the `Origin` header against `SITE_ORIGIN`, then authorization, then game state. The final write repeats the state checks inside the same statement, so concurrent requests cannot slip past them.
- Moderator-only reads added for the console: `GET /api/games/[gameId]/feedback` returns ratings, comments, respondent type, and time, with the average (`summarizeFeedback` in `lib/game/feedback.ts`); the table stores no respondent id. The phases `GET` adds `outstanding` to the open phase: living players who still owe a response, following the same permission rule players see (`lib/game/outstanding.ts`). The console's nudge text (`lib/game/moderator-copy.ts`) names players only for Day and Final ballots.
- Players receive only their own role, permitted teammates and rooms, legal targets, their own private results, and published events. `e2e/readiness/browser-fixture.ts` lists the fields that must never reach a player.
- Rate limits are stored in the database and return HTTP 429 with `Retry-After`: moderator login and recovery 5 per 15 minutes, player sign-in 8 per 15 minutes, seat claim 3 per hour, actions and chat 30 per 10 minutes each, feedback 3 per hour (players) or 10 per hour (moderators), invite email 30 bulk sends per hour per game plus 5 single-player resends per hour per player.

## Polling

The player dashboard, open chat rooms, and moderator panels each refresh every ten seconds. There are no WebSockets.
