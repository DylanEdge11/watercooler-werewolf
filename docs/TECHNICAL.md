# Technical reference

For developers. Installation is in [Setup](SETUP.md), verification in [Testing](TESTING.md), and player-facing rules in the in-app guide (`app/guide/page.tsx`).

## Stack

- Next.js App Router with React, on Vercel's Node.js runtime (Node 24.x).
- Turso/libSQL through `@libsql/client`: the web (HTTP) client in deployed functions, and the Node client with its native SQLite binary only for local `file:` and `:memory:` URLs (`db/index.ts`; `next.config.ts` keeps the binaries out of the function bundles). Routes use a small database contract (`db/contracts.ts`) implemented in `db/libsql.ts`; multi-statement writes go through `batch()`, which runs as one transaction.
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
| Co-moderators: add, remove, transfer ownership | `app/api/games/[gameId]/moderators/`, `lib/auth/game-moderators.ts` |
| Origin checks and rate limits | `lib/http/` |
| Layout and base styles | `app/globals.css` |
| Paper Theatre look (dashboard, sign-in, claim, `/guide`) | `app/paper-theatre.css` |
| Backstage look (moderator console, Player View Studio) | `app/paper-theatre-backstage.css` |
| Emblem and favicon | `app/brand-mark.tsx`, `public/favicon.svg` |
| Signed-out landing page | `app/landing/` |

## Game rules as implemented

- Creating a game and editing its schedule share one validator, `validateGameSetup` in `lib/game/game-setup.ts`: name 3–80 characters, a valid timezone and dates with the end on or after the start, a final cutoff whose date in the game timezone falls between the start and end dates, at least one active weekday, and valid `dayCloses` and `nightCloses` times. Only those two schedule times are stored.
- Before roles are randomized (game `DRAFT` or `REGISTRATION`), a moderator can add one player (`POST /api/games/[gameId]/seats`) or remove one unclaimed player (`DELETE /api/games/[gameId]/seats/[seatId]`) without touching other seats. The rules are in `lib/game/roster-edit.ts`: the roster stays within 6–80 players, claimed seats cannot be removed, and the change is absorbed by one Villager; if that would leave the counts invalid (for example, no Villager left), they reset to the standard preset for the new size. Each edit bumps `setup_revision`, discards any stale preview, rewrites the role counts, and records `SEAT_ADDED` or `SEAT_REMOVED` in one transaction that first re-checks the game state, roster size, and (for removal) that the seat is still unclaimed. A removed seat is archived as `REMOVED` with a new random claim hash, so its link stops working. Once a preview exists (`ASSIGNMENT_PREVIEW`) the roster is locked; saving the composition discards the preview and reopens it. Nothing can be added after release.
- After roles are released, the first phase is a Day; Day and Night then alternate. Each phase records its elimination slots when it opens: `max(1, ceil(living / divisor))`. Days and Nights have separate divisors (`day_divisor`, `night_divisor`), 30 by default, set per game under "Advanced: eliminations per phase" in the schedule form. They must be whole numbers from 1 to 80 and can change only while setup is editable (`lib/game/game-settings.ts`).
- Only each player's latest saved response counts. Targets must be living, unique, and legal for the role.
- The highest vote totals fill the slots. A tie across the last slot is resolved by a cryptographically random draw that is stored with the result.
- The Mayor's Day and Final ballot votes count twice. Bodyguard protection blocks only the pack's attack. Cupid pairs once; when one lover is eliminated, the other is added to the same result. The Apprentice Seer has no action while the Seer lives; afterwards they investigate each Night and see the Seer's past results.
- If the result eliminates a Hunter, the phase waits for the Hunter's shot before it can be published. The window is `hunter_window_minutes`: new games get 480 (8 hours) from the create-game route, and the schedule form edits it in hours (0.25 to 168) while setup is editable. The column default stays 60, so games created before version 1.4 keep 60 minutes unless changed during setup.
- `final_round_minutes` is stored, backed up, and restored but not used. It is reserved for a possible timed Final ballot and has no setting in the console.
- A Hunter's shot is checked again when the follow-up is finalized. A shot that is no longer valid counts as no shot, with a warning. An override that leaves a Hunter eliminated clears any saved shot and gives the Hunter a fresh window to choose against the corrected result. Finalizing calculates first and then saves in one transaction that also checks the saved shot is unchanged, so an error or a shot saved at the same moment never leaves the phase half-finalized; a phase left in `HUNTER_FINALIZING` by an older build can be finalized again.
- Each result is stored three ways: the engine's `proposedOutcome`, a `reviewedOutcome` after Hunter follow-up or override, and the authoritative `publishedOutcome`. Overrides record the reason, reviewer, and time.
- The Mayor's extra vote is never published. The public ballot lists one line per voter and players' vote counts are unweighted, so they can differ from the result. A Bodyguard save is announced ("Bodyguard protection stopped a pack attack") without naming who was protected.
- The "N of M submitted" counter (`participationCounter` in `lib/game/actions.ts`) counts across players only for Day ballots and the pack's vote. Every other action is counted for the reader alone, so the counter cannot reveal how many players hold another Night role.
- Publishing applies eliminations, reveals roles, delivers Seer and lover notifications, updates room access, and checks for a winner in one transaction.
- Final showdown requires the final cutoff to have passed and the latest phase to be published. After that, only Final ballots are allowed until a team wins.
- Legacy `DOCTOR` rows are read as `BODYGUARD`.

## Time

Deadlines are entered in the game's IANA timezone and stored as UTC. Impossible dates and times that fall in a daylight-saving gap are rejected; an ambiguous fall-back time uses the earlier instant. The weekday cadence on a game is informational: phases never open on their own.

## Automatic results

- `games.publication_mode` is `AUTOMATIC` or `REVIEW`. New games get `REVIEW` with `review_window_minutes` 60 unless the create request chooses `AUTOMATIC`; existing games keep the column defaults (`REVIEW`, 60). `automation_paused_at` is set while paused. Both new columns come from migration `0005_game_automation`.
- `lib/game/automation.ts` holds the rule (`nextAutomaticStep`). It acts only for an `ACTIVE` or `FINAL_SHOWDOWN` game in `AUTOMATIC` mode that is not paused. An `OPEN` phase past `closes_at`, or a `LOCKED` phase, gets `LOCK_AND_PROPOSE`. A `PENDING_HUNTER` phase gets `FINALIZE_HUNTER` once a `HUNTER_SHOT` is saved, or once `hunter_deadline_at` has passed (then skipping the shot). A `PENDING_APPROVAL` phase gets `PUBLISH` once `phases.updated_at` (when the result became ready for review) is at least the review window old. `automaticStepDueAt` gives the time for the console and the player's deadline card.
- `lib/game/phase-transitions.ts` runs `LOCK_AND_PROPOSE`, `FINALIZE_HUNTER`, and `PUBLISH` for both the phases route and the sweep, with an actor that is a moderator or the `SCHEDULER` (no moderator id). An automatic `PUBLISH` never applies an override. Its claim re-checks, inside the same conditional write, that the phase is still `PENDING_APPROVAL` at the expected version, that `updated_at` is at or before the review cutoff, and that the game is still `AUTOMATIC` and unpaused; a moderator publish, override, pause, or mode change that lands first makes it change zero rows. Events from these transitions carry `source` (`MODERATOR` or `SCHEDULER`). The player timeline shows `publishedAutomatically` for `PHASE_PUBLISHED` events from the scheduler; the console derives it from a published proposal with no reviewing moderator.
- `lib/game/automation-sweep.ts` applies due steps in order for one game (`advanceGame`), reading one indexed row per pass, so an idle game costs one query. It runs on the moderator phases `GET` (the console's ten-second refresh), on `GET /api/player` (the dashboard's refresh), and on `/api/scheduler/deadlines` (`sweepAutomation` for all automatic games). Polls use `advanceGameSafely`, which never fails the page and records an `AUTOMATION` operational warning instead. Concurrent sweeps and moderator actions produce one lock, one proposal, and one publication (`lib/api-automation.test.ts`).
- `POST /api/games/[gameId]/automation` (moderator, same-origin) handles `PAUSE`, `RESUME`, and `SETTINGS` (`publicationMode`, `reviewWindowMinutes` 0–1440) until a game is completed, stopped, or cancelled, recording `AUTOMATION_PAUSED`, `AUTOMATION_RESUMED`, or `AUTOMATION_SETTINGS_UPDATED`. Reset and restore clear the pause.

## Authentication and privacy

- Moderator and player sessions are random tokens in HTTP-only, SameSite=Lax cookies (`ww_mod_session`, `ww_player_session`), stored as SHA-256 hashes. They last seven days.
- Passwords, PINs, and recovery codes are hashed with salted PBKDF2-SHA256 (100,000 iterations). Claim codes are 72-bit random tokens stored as SHA-256 hashes.
- Roster emails must be one plain address (`lib/roster/email-address.ts`): lists like `a@x.com;b@y.com` and `Name <a@x.com>` are rejected at import and when adding a player, because mail libraries split them and would send one player's claim link to several recipients. The invite route re-checks each stored address and reports any older or restored seat that fails as "Not a single email address" without changing its link.
- Invite email (`POST /api/games/[gameId]/invites`, optional `seatIds`) works only before roles are released and only on `INVITED` seats. It signs in to SMTP first, then replaces each seat's claim hash with a compare-and-swap on the old hash, emails the new link, and records an `INVITE_EMAILED` event (`{ seatId }`) only while that link is still current. The response never contains a claim link. The roster reports `invitationEmailedAt` from events newer than the seat's `updated_at`, so a later send, reset, or restore clears it. Settings are in `lib/email/settings.ts`.
- Routes answer errors through `routeError` (`lib/http/errors.ts`): 401 when signed out, 403 for a cross-origin write or a moderator of another game, 404 for a missing game, phase, seat, or message, 409 for a lost race, 429 with `Retry-After` for a rate limit, 503 while the database is unconfigured or not migrated, and 400 for invalid input. Any other error (a database or library failure) is logged and answered with a generic 500, so internal details never reach the browser.
- Every write checks the `Origin` header against `SITE_ORIGIN`, then authorization, then game state. The final write repeats the state checks inside the same statement, so concurrent requests cannot slip past them.
- Moderator-only reads added for the console: `GET /api/games/[gameId]/feedback` returns ratings, comments, respondent type, and time, with the average (`summarizeFeedback` in `lib/game/feedback.ts`). The `pilot_feedback` table has no respondent id, but each submission's `operational_events` row records the sender's seat or moderator id, so feedback is not anonymous to moderators or in backups. The phases `GET` adds `outstanding` to the open phase: living players who still owe a response, following the same permission rule players see (`lib/game/outstanding.ts`). The console's nudge text (`lib/game/moderator-copy.ts`) names players only for Day and Final ballots.
- Each game has one `OWNER` and any number of `CO_MODERATOR`s in `game_moderators`. The owner adds (`POST /api/games/[gameId]/moderators`), removes (`DELETE …/moderators/[moderatorId]`), or hands over ownership (`PATCH …/moderators/[moderatorId]` with `{ role: 'OWNER' }`, after which the old owner is a co-moderator). Each write inserts its audit event (`CO_MODERATOR_ADDED`, `CO_MODERATOR_REMOVED`, `OWNERSHIP_TRANSFERRED`) first, only while the caller still owns the game and the target's membership is as expected; the membership change then runs only if that event exists, so a lost race is a 409 that changes nothing. Removal ends access to that game at the next request; the account stays.
- Players receive only their own role, permitted teammates and rooms, legal targets, their own private results, and published events. `e2e/readiness/browser-fixture.ts` lists the fields that must never reach a player.
- Rate limits are stored in the database and return HTTP 429 with `Retry-After`: moderator login and recovery 5 per 15 minutes, player sign-in 8 per 15 minutes, seat claim 3 per hour, actions and chat 30 per 10 minutes each, feedback 3 per hour (players) or 10 per hour (moderators), invite email 30 bulk sends per hour per game plus 5 single-player resends per hour per player. These limits are per client address. In addition, a seat locks after 10 wrong PINs in a row (`lib/auth/pin-lockout.ts`, counted in `rate_limit_buckets` under `pin-failures:<seatId>`) and answers 423 until a moderator resets its PIN; a correct PIN or a new claim clears the count.
- Expired sessions and stale rate-limit buckets are deleted by the scheduler route and after each moderator sign-in (`lib/maintenance.ts`). An unknown moderator email is checked against a throwaway hash, so it takes as long as a wrong password.

## Polling

The player dashboard, open chat rooms, and moderator panels each refresh every ten seconds. There are no WebSockets.
