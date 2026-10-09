# Technical reference

For developers: the rules and data flow as implemented. Installation is in [Setup](SETUP.md), verification in [Testing](TESTING.md), and player-facing rules in the in-app guide (`app/guide/page.tsx`).

## Stack and data access

- **App:** Next.js App Router with React, on Vercel's Node.js runtime (Node 24.x).
- **Database:** Turso/libSQL through `@libsql/client`. Deployed functions use the web (HTTP) client and refuse `file:` URLs. The Node client, with its native SQLite binary, is used only for local `file:` and `:memory:` URLs (`db/index.ts`; `next.config.ts` keeps the binaries out of the function bundles). Local development and tests use a SQLite file or an in-memory database.
- **Queries:** hand-written SQL with bound parameters, through a small database contract (`db/contracts.ts`, implemented in `db/libsql.ts`). Multi-statement writes use `batch()`, which runs as one transaction. Drizzle supplies only the schema (`db/schema.ts`) and generated migrations.
- **Migrations:** requests never change the schema. `ensureDatabase()` checks that every version in `db/readiness.ts` is recorded in `__app_migrations` and fails otherwise. Migrations run only through `npm run db:migrate` (see [Setup](SETUP.md#schema-changes)).
- **Builds** compile from source every time (`experimental.turbopackFileSystemCacheForBuild: false` in `next.config.ts`). With Turbopack's build cache on, a Vercel build restored from an older deployment served stale `globals.css` under a chunk name already published to Vercel's shared immutable asset store, so pages got the wrong styles. Don't turn it back on.

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
| Player dashboard data | `lib/player/dashboard-data.ts` (`loadDashboard`), served by `app/api/player/route.ts` |
| Signed-in dashboard page | `app/(player)/page.tsx`, `app/(player)/loading.tsx`, `app/player-dashboard.tsx` |
| Village stats: counting rules | `lib/game/game-stats.ts` (`buildGameStats`, `chatRhythm`), unit-tested beside it |
| Village stats: data and routes | `lib/player/game-stats-data.ts` (`loadGameStats`), served by `app/api/stats/route.ts` (players, spectators) and `app/api/games/[gameId]/stats/route.ts` (moderators) |
| Village stats: screens | `app/village-stats.tsx`, `app/village-stats-charts.tsx`, `app/village-stats.css`; the console panel is `app/moderator/stats-panel.tsx` |
| Moderator player choices | `lib/game/moderator-choices.ts` (`buildModeratorChoices`, `groupPhaseChoices`, `describeChoiceCounts`, unit-tested beside it), `lib/game/moderator-choices-data.ts` (`loadModeratorChoices`), served by `app/api/games/[gameId]/choices/route.ts`; the console panel is `app/moderator/player-choices-panel.tsx` |
| Stop, reset, restore, cancel, PIN reset | `app/api/games/[gameId]/operations/route.ts`, `lib/backup/` |
| Sessions, hashing, authorization | `lib/auth/` |
| Co-moderators: add, remove, transfer ownership | `app/api/games/[gameId]/moderators/`, `lib/auth/game-moderators.ts` |
| Player sign-ups: rules and wording | `lib/game/signups.ts` (state, limits, form parsing, acceptance plan), `lib/game/join-copy.ts` (every word on the public page and in the approval emails), unit-tested beside them |
| Player sign-ups: routes and data | `app/api/games/[gameId]/signups/` (state, link, note; `review/` accepts, declines, puts back), `lib/roster/accept-signups.ts`, `lib/roster/signup-store.ts`; the public `/join/<code>` page is `app/join/[code]/`, backed by `app/api/join/[code]/` and `lib/join/lookup.ts` |
| Moderator applications | `lib/game/moderator-applications.ts` (rules), `app/api/games/[gameId]/applications/`, `lib/auth/application-approval.ts` (the owner's decision), `lib/auth/moderator-setup.ts` and `app/api/moderators/join/[code]/` (the one-time setup link), `app/moderator/join/[code]/` (its page) |
| Email | `lib/email/` (SMTP settings, invite email), `lib/notify/` (player email) |
| Origin checks and rate limits | `lib/http/` |
| Layout and base styles | `app/globals.css` |
| Paper Theatre look (dashboard, sign-in, claim, `/guide`) | `app/paper-theatre.css` |
| Backstage look (moderator console, Player View Studio) | `app/paper-theatre-backstage.css` |
| Emblem and favicon | `app/brand-mark.tsx`, `public/favicon.svg` |
| Signed-out landing page | `app/landing/` |

## Game rules as implemented

### Setup and schedule

- **Validation.** Creating a game and editing its schedule share one validator, `validateGameSetup` (`lib/game/game-setup.ts`): a name of 3–80 characters; a valid timezone; an end date on or after the start date; a final cutoff whose date in the game timezone falls between the start and end dates; at least one active weekday; and valid `dayCloses` and `nightCloses` times. Only those two schedule times are stored.
- **Time.** Deadlines are entered in the game's IANA timezone and stored as UTC. Impossible dates, and times that fall in a daylight-saving gap, are rejected; an ambiguous fall-back time uses the earlier instant.

### Phases, slots, and deadlines

- **Order.** After roles are released the first phase is a Day, then Day and Night alternate. Final showdown is covered below.
- **Slots.** Each phase records its elimination slots when it opens: `max(1, ceil(living / divisor))`. Days and Nights have separate divisors (`day_divisor`, `night_divisor`), 30 by default, set per game under "Advanced: eliminations per phase" in the schedule form. They must be whole numbers from 1 to 80 and can change only while setup is editable (`lib/game/game-settings.ts`).
- **Elimination schedule.** A game can use a schedule instead of divisors (`games.elimination_schedule_json`, migration `0009_elimination_schedule`; rules in `lib/game/elimination-schedule.ts`).
  - It is an ordered list of up to 12 stages, each `{ day, night, days }`: Day eliminations and Night kills (whole numbers 1–79) for `days` game days (1–365). The last stage has `days: null` and runs until the game ends.
  - Game day N is Day N and Night N, so it follows phase sequence (`cycleNumber`), not the calendar.
  - When a Day or Night opens, `phaseSlots` takes the stage for its game day and caps it to `max(1, min(stage value, living − 1))`, so a phase never eliminates every living player.
  - Final ballots, and every phase of a game with no schedule, use the divisor formula; `divisor_snapshot` still records the divisor. Unreadable stored JSON counts as no schedule.
- **Editing the schedule.** It is editable from creation until the game is completed, stopped, or cancelled: in setup through `POST /api/games` and `PATCH …/schedule` (`eliminationSchedule`: an array or JSON text, `''` or `null` to remove, omitted to keep), and at any editable status through `PATCH /api/games/[gameId]/elimination-schedule` (the field is required; `null` removes it).
  - Each change writes an `ELIMINATION_SCHEDULE_UPDATED` audit event with `previous` and `schedule` in the same guarded transaction. An unchanged save writes nothing. The event is not a public timeline type, so players are not told.
  - A change applies only to phases opened after it; every phase keeps the `slots` it recorded.
  - Opening a phase inserts only while `elimination_schedule_json` still matches what it read, so a schedule saved in between answers 409 instead of using the old schedule. A schedule save guarded on `updated_at` answers 409 if the game changed first.
  - Restore puts back the backup's schedule (none for older backups).
- **Suggested deadline.** The console proposes each new phase's deadline from the game's `schedule_json` close times and active weekdays (`nextScheduledClose` in `lib/game/scheduling.ts`): Day ballots and the Final ballot use `dayCloses`, Night actions use `nightCloses`, at least 15 minutes ahead. With no usable schedule it falls back to an hour from now.
- **Extending a deadline.** `EXTEND_DEADLINE` on the phases `POST` moves an `OPEN` phase's `closes_at` later only, and only while `closes_at` is still in the future (`validateDeadlineExtension` in `lib/game/phase-policy.ts`). The update re-checks the status and the deadline it read, clears `closing_reminder_at` so the closing-soon email is sent again, and records `PHASE_DEADLINE_EXTENDED` (`{ from, to }`).
- **Final showdown** requires the final cutoff to have passed and the latest phase to be published. After that, only Final ballots are allowed until a team wins.

### Votes, ties, and results

- **Responses.** Only each player's latest saved response counts. Targets must be living, unique, and legal for the role.
- **Tallies.** The highest vote totals fill the slots. Night ties are always a random draw.
- **Afterlife tiebreak.** A tie across the last slot on a Day or Final ballot goes first to the Afterlife.
  - Eliminated players may save an optional `AFTERLIFE_VOTE` (one vote each, up to the slot count, for living players) while the ballot is open (`afterlifePermission` in `lib/game/actions.ts`).
  - `selectFromTally` in `lib/game/engine.ts` ranks the tied players by their Afterlife votes and takes them in that order. Only what the Afterlife can't settle (it tied too, or gave the tied players no votes) goes to a cryptographically random draw stored with the result.
  - Day and Final results carry `afterlifeTally` and, when the Afterlife voted for a tied player, `afterlifeTiebreak` (`candidates`, `afterlifeVotes`, `selected`, `decided`). An override clears `afterlifeTiebreak`.
  - Players see only `afterlifeBrokeTie` on the published timeline event, and only when the Afterlife settled every tied slot (`decided`); never the Afterlife's votes. The console counts Afterlife votes separately (`afterlifeSubmissions`) from `currentSubmissions`.
- **Role effects.** The Mayor's Day and Final ballot votes count twice. Bodyguard protection blocks only the pack's attack. Cupid pairs once; when one lover is eliminated, the other is added to the same result. The Apprentice Seer has no action while the Seer lives; afterwards they investigate each Night and see the Seer's past results. Legacy `DOCTOR` rows are read as `BODYGUARD`.
- **Three stored outcomes.** The engine's `proposedOutcome`, a `reviewedOutcome` after Hunter follow-up or override, and the authoritative `publishedOutcome`. Overrides record the reason, reviewer, and time.
- **What is never published.** The Mayor's extra vote: the public ballot lists one line per voter and players' vote counts are unweighted, so they can differ from the result. A Bodyguard save is announced ("Bodyguard protection stopped a pack attack") without naming who was protected.
- **Participation counter.** The "N of M submitted" counter (`participationCounter` in `lib/game/actions.ts`) counts across players only for Day ballots, the pack's vote, and the Afterlife ballot (out of all eliminated players). Every other action is counted for the reader alone, so the counter cannot reveal how many players hold another Night role.
- **Publishing** applies eliminations, reveals roles, delivers Seer and lover notifications, updates room access, and checks for a winner, all in one transaction.

### Hunter

- If a result eliminates a Hunter, the phase waits for the Hunter's shot before it can be published. The window is `hunter_window_minutes`: new games get 480 (8 hours) from the create-game route, and the schedule form edits it in hours (0.25 to 168) while setup is editable. The column default stays 60, so games created before version 1.4 keep 60 minutes unless changed during setup.
- The shot is checked again when the follow-up is finalized. A shot that is no longer valid counts as no shot, with a warning.
- An override that leaves a Hunter eliminated clears any saved shot and gives the Hunter a fresh window to choose against the corrected result.
- Finalizing calculates first and then saves in one transaction that also checks the saved shot is unchanged, so an error, or a shot saved at the same moment, never leaves the phase half-finalized. A phase left in `HUNTER_FINALIZING` by an older build can be finalized again.

## Chat rooms

- Each game has four rooms: the Town Hall (`TOWN_HALL`) and the private Pack, Mason, and Afterlife rooms. Every claimed seat is a Town Hall member, with `WRITE` while alive and `READ_ONLY` once eliminated; the message insert also re-checks that the author is alive. The Town Hall is open day and night.
- Room membership (`roomSyncStatements` in `lib/chat/rooms.ts`) is written only inside the role-release and publish transactions, because those are the only writes that change roles or who is alive. A seat claim also adds that one seat to an existing Town Hall (`townHallJoinStatement`, for late Villagers). Player, chat, and moderator reads never write it. The player and moderator room reads only check, with one query, that the game's four rooms exist, and create any that are missing (for example, the Town Hall of a game started before it existed).
- Moderators read any room of their game through `GET /api/games/[gameId]/rooms/[roomId]/messages`: the newest 100 messages from all three message tables, oldest first, and `earlierCursor` for `?before=<createdAt>~<id>` to page back (`lib/chat/room-messages.ts`).
- `POST` on the same path writes to `moderator_messages`, only while the room is `OPEN` and the game is `ACTIVE` or `FINAL_SHOWDOWN` (`moderatorCanPost` in `lib/game/moderator-chat.ts`), re-checked in the insert. It records `MODERATOR_CHAT_MESSAGE_SENT` with the moderator's id.
- Every reader sees the author as "Moderator"; players get `byModerator: true` and `authorSeatId: null`, never the moderator's email. Removal, retention purges, Reset, and Restore cover `moderator_messages`, and backups include it as `moderatorMessages`.

## Roster, sign-ups, and applications

### Roster edits

- **Before randomizing** (game `DRAFT` or `REGISTRATION`), a moderator can add one player (`POST /api/games/[gameId]/seats`) or remove one unclaimed player (`DELETE /api/games/[gameId]/seats/[seatId]`) without touching other seats. The rules are in `lib/game/roster-edit.ts`.
  - Adding stops at 80 players. Removal is refused at exactly 6 (`canRemoveSeat`), because a roster still being built from sign-ups can hold fewer than 6 and a mistaken acceptance should be removable. Claimed seats cannot be removed.
  - One Villager absorbs the change. If that would leave the counts invalid (for example, no Villager left), they reset to the standard preset for the new size.
  - Each edit bumps `setup_revision`, discards any stale preview, rewrites the role counts, and records `SEAT_ADDED` or `SEAT_REMOVED` in one transaction that first re-checks the game state, roster size, and (for removal) that the seat is still unclaimed.
  - A removed seat is archived as `REMOVED` with a new random claim hash, so its link stops working.
  - Once a preview exists (`ASSIGNMENT_PREVIEW`) the roster is locked; saving the composition discards the preview and reopens it. Nothing can be added after release except a late Villager.
- **Late Villager.** `POST /api/games/[gameId]/late-villagers` adds a seat to a running game while the latest phase sequence is 2 or less (the first Day and Night; `canAddLateVillager` in `lib/game/roster-edit.ts`). In one transaction it inserts an `INVITED` seat, a `VILLAGER` role assignment against the released batch, one more Villager in `game_role_counts`, and a moderator-only `LATE_VILLAGER_ADDED` event. Nothing is announced. Like every seat, it counts toward votes, slots, and win conditions only once `CLAIMED`. A Villager has no private room, so room membership is unchanged.
- **Serialised seat changes.** Every change that adds or removes seats (`SEAT_ADDED`, `SEAT_REMOVED`, `SIGNUPS_ACCEPTED`, `ROSTER_APPENDED`) goes through `applySeatChange`. Its first statement inserts the change's own event only if the roster is still as it was read, and every later statement requires that event. Of two requests that read the same roster, only one writes. (The setup revision alone is not enough: the loser would see the winner's new revision.)
- **Role counts follow the roster** (`adjustCompositionForRosterChange`): below 6 players every count is zero; a roster reaching 6 starts from the standard preset; a change of one player moves one Villager; a change of more than one player starts from the preset for the new size.

### Public sign-up

- **Opening.** A moderator opens it with `POST /api/games/[gameId]/signups` (`OPEN`), which creates `games.signup_code` once and sets `signup_state` to `OPEN`. The code is a random token in the public `/join/<code>` link. `CLOSE` sets `CLOSED`; `OPEN` again reopens with the same link; `ROTATE_LINK` replaces it and the old link stops working.
- **When it is available.** It can be opened only while the game is `DRAFT` or `REGISTRATION` with no roles released (`canOpenSignups`). The public page treats an open link as closed whenever the game is in any other status, so randomizing roles pauses sign-ups and unlocking the roster resumes them (`publicSignupAvailability`). Each change is one guarded write with its audit event (`SIGNUPS_OPENED`, `SIGNUPS_CLOSED`, `SIGNUP_LINK_REPLACED`).
- **A visitor's sign-up** (`POST /api/join/[code]/signup`, same-origin, no account) goes into `signups` as `PENDING`: a name (up to 80 characters) and one plain address, checked as roster emails are.
  - The reply is the same whether the email is new, already on the list, or already on the roster, so the page cannot be used to learn who has signed up. A person a moderator declined, or removed from the roster, stays declined when they sign up again and gets the same reply; the moderator can put them back.
  - The only other replies are an unknown or replaced link (404), closed (409), full (409), a bad field (400), and a rate limit (429).
  - The insert re-checks inside itself that sign-ups are open and the game still editable, that the list holds fewer than 300 pending and accepted rows (declined ones don't count, so junk can be cleared), and that the email isn't on the roster.
  - A hidden `website` field that a bot fills in gets the success reply and no row.
  - The per-address allowance is 60 an hour (an office shares one address) and a game-wide one is 300 an hour.
  - Nothing is emailed to a sign-up's address. A stranger cannot use the form to mail someone else, and a person receives their private seat link only after a moderator accepts them and sends invitations.

### Reviewing and accepting

`POST …/signups/review` (any moderator of the game):

- `DECLINE` moves waiting rows to `DECLINED` and `RESTORE` moves declined rows back. Both stamp the time and moderator, which ties the audit event to that request, so a repeat is a 409 that records nothing.
- `ACCEPT` runs `acceptSignups` (`lib/roster/accept-signups.ts`). It plans first (`planAcceptance`: oldest first; an email already on the roster is marked accepted without a second seat; the roster stops at 80 and the rest keep waiting). It then writes all new seats, the matching role counts, and the rows' new status in one transaction through `applySeatChange`, which also checks that every chosen sign-up is still `PENDING`. A roster edit, a randomize, or a sign-up declined in between leaves nothing changed (409).
- The new seats are ordinary `INVITED` seats with a hashed claim code, so invitation email (`/api/games/[gameId]/invites`), the invite CSV, and claiming with a PIN work as for any seat. The response carries each new seat's link once, for the CSV.

### Imported list, sign-ups, or both

A game can use an imported list, sign-ups, or both (`lib/api-signups.test.ts`, `e2e/readiness/browser-signups.spec.ts`).

- `POST /api/games/[gameId]/roster` takes `{ csv, mode, expectedSeatCount? }`.
- **Replace** (no `mode`, or `REPLACE`) archives every seat and replaces the roster. It returns accepted sign-ups to `PENDING` so they can be accepted again. A replace that sends `expectedSeatCount` (the console always does: the number of players its page shows, 0 for a first import) is a 409 that changes nothing when the roster has a different number of non-removed seats, so a console that missed another moderator's change cannot wipe it. The console asks for confirmation (**Replace the whole roster**) and uses replace for a first import on an empty roster.
- **Add** (`ADD`, `lib/roster/append-roster.ts`) is the console's choice once anyone is on the roster. People already on the roster are skipped and reported as `skipped`; a sign-up with the same email is marked `ACCEPTED` with that seat. A list may have any size from 1 (`parseRosterCsv` with `minPlayers`), the result may not pass 80, and a list of only people already on the roster is a 409.
- Accepting sign-ups adds them to whatever seats exist, so import-then-accept and accept-then-import keep both groups.
- **Invite file.** `createInviteExport` quotes every cell. It guards only text a person typed (name, email) against spreadsheet formulas, with a leading apostrophe (`csvTextCell`), and writes links, seat codes, and message text exactly (`csvExactCell`), because about 1 seat code in 64 starts with `-`.

### Consistency, and upgrading existing games

- Removing an unclaimed seat marks its sign-up `DECLINED`. Importing a CSV, which archives every seat, returns accepted sign-ups to `PENDING` and then marks anyone on the new list `ACCEPTED` with their new seat. A list added with `ADD`, and a player added by hand, do the same for a matching sign-up.
- The sign-up list is not part of backups (like spectators). Reset keeps every seat, so it leaves the sign-up list alone. Restore archives the seats that are not in the backup, so accepted sign-ups whose seat did not come back return to `PENDING` in the same transaction and can be accepted again.
- The player timeline shows only whitelisted event types, so none of these audit events reach players.
- **Migration `0012_sign_ups_and_moderator_applications`** leaves existing games unchanged: the new `games` columns default to `NOT_OPEN`, no link, and applications closed; the new tables start empty; a running game can't be opened for sign-ups; and a game without a link has no public page. `lib/api-signups-upgrade.test.ts` proves it by writing games with the schema as of 0011, applying 0012, and exercising them, including restoring a backup made before the migration.

### Moderator applications

- **Opening.** The owner (`requireGameOwner`) opens or closes applications with `POST /api/games/[gameId]/applications` (`moderator_applications_open`, sharing the game's `/join/<code>` link and creating it if needed; audited as `MODERATOR_APPLICATIONS_OPENED` / `_CLOSED`) and reads the list with `GET` on the same path. Only the owner can read it, as only the owner adds co-moderators. It is allowed until the game is `CANCELLED`, `STOPPED`, or `COMPLETED`.
- **Applying.** An applicant (`POST /api/join/[code]/apply`, same-origin, no account) is stored `PENDING` with a name, an email, and an optional note of up to 500 characters. As with sign-ups, the reply never says whether the email already applied or already moderates the game, and a hidden field catches bots. The list holds at most 50 pending and approved rows, and the allowances are 10 an hour per address and 40 an hour per game. Nothing is emailed until approval.
- **Deciding.** The owner decides with `POST …/applications/[applicationId]` (`decideApplication`): `APPROVE`, `DECLINE`, or `RECONSIDER` (declined back to waiting). Every write is conditional on the application still being unused and the caller still owning the game, so a double click or a second tab changes nothing.
  - Approving an email that already has a moderator account adds it as `CO_MODERATOR` in one batch (event first, then membership, as for a co-moderator added by hand).
  - Approving one that has no account stores a one-time setup code as a SHA-256 hash (never the code), returns the link to the owner once, and emails it when the site can send mail (`sendOneEmail`; reserved test addresses are skipped). Approving again replaces the link, and declining withdraws it.
- **Setup link.** `/moderator/join/<code>` (`lib/auth/moderator-setup.ts`) works once and for seven days from the approval, and only while the game is not over and no account exists for the email. `POST /api/moderators/join/[code]` (8 tries per 15 minutes per address) takes the applicant's own password (12 or more characters) and, in one transaction conditional on all of that, creates the account, adds it as co-moderator, marks the application used, and records `CO_MODERATOR_ADDED`. Two uses at once create one account. The route then signs them in and returns their recovery codes once. A person who is approved and reaches the link only to find an account now exists for the email is told to sign in and ask the owner to approve again, which adds them directly.
- **Trust.** Accounts are global: a moderator account can create games of its own (`POST /api/games` asks only for a signed-in moderator). Approving an applicant therefore extends the same trust as adding a co-moderator by hand; limiting who may create games is not part of this feature.

### Co-moderators

Each game has one `OWNER` and any number of `CO_MODERATOR`s in `game_moderators`. The owner adds (`POST /api/games/[gameId]/moderators`), removes (`DELETE …/moderators/[moderatorId]`), or hands over ownership (`PATCH …/moderators/[moderatorId]` with `{ role: 'OWNER' }`, after which the old owner is a co-moderator). Each write inserts its audit event (`CO_MODERATOR_ADDED`, `CO_MODERATOR_REMOVED`, `OWNERSHIP_TRANSFERRED`) first, only while the caller still owns the game and the target's membership is as expected. The membership change then runs only if that event exists, so a lost race is a 409 that changes nothing. Removal ends access to that game at the next request; the account stays.

## Automatic results

- **Settings.** `games.publication_mode` is `AUTOMATIC` or `REVIEW`, and `automation_paused_at` is set while paused. Both columns come from migration `0005_game_automation`. New games get `REVIEW` with `review_window_minutes` 60 unless the create request chooses `AUTOMATIC`; existing games keep the column defaults (`REVIEW`, 60).
- **Opening the next phase.** `auto_open_next_phase` (migration `0011_auto_open_next_phase`, default off) makes the sweep open the next phase. It is set through `POST /api/games/[gameId]/automation`, audited in `AUTOMATION_SETTINGS_UPDATED`, and is not part of game creation or the setup form. Reset and Restore set it back to off in the same write that clears `automation_paused_at`, because the checkbox only appears once roles are released and a leftover tick would otherwise be invisible.
- **The rule.** `lib/game/automation.ts` holds `nextAutomaticStep`. It acts only for an `ACTIVE` or `FINAL_SHOWDOWN` game in `AUTOMATIC` mode that is not paused.
  - An `OPEN` phase past `closes_at`, or a `LOCKED` phase, gets `LOCK_AND_PROPOSE`.
  - A `PENDING_HUNTER` phase gets `FINALIZE_HUNTER` once a `HUNTER_SHOT` is saved, or once `hunter_deadline_at` has passed (then skipping the shot).
  - A `PENDING_APPROVAL` phase gets `PUBLISH` once `phases.updated_at` (when the result became ready for review) is at least the review window old. `automaticStepDueAt` gives the time for the console and the player's deadline card.
  - With `auto_open_next_phase` on, a game with no unpublished phase whose newest phase is a `PUBLISHED` Day or Night gets `OPEN_NEXT`: the other kind, closing at `nextScheduledClose` (the game's Day or Night close time, active weekdays, at least 15 minutes ahead). Nothing is opened for the first Day, the final ballot, a game that is not `ACTIVE` (so none after a win or in final showdown), or a close time after `final_cutoff_at`.
- **Opening.** `openPhase` (`lib/game/phase-open.ts`) serves both the Open button and the sweep: the same checks and one conditional insert, `PHASE_OPENED` with `source`, and the phase-opened email. A moderator who opens the phase first makes the sweep's attempt a lost race, not a warning. An automatic opening also re-checks inside that insert that the game is still `AUTOMATIC`, not paused, and has `auto_open_next_phase` on; a moderator who pauses, switches to review mode, or unticks the option at the same moment makes it change zero rows (a 409, so nothing opens and no email goes out).
- **Transitions.** `lib/game/phase-transitions.ts` runs `LOCK_AND_PROPOSE`, `FINALIZE_HUNTER`, and `PUBLISH` for both the phases route and the sweep, with an actor that is a moderator or the `SCHEDULER` (no moderator id).
  - An automatic `PUBLISH` never applies an override. Its claim re-checks, inside the same conditional write, that the phase is still `PENDING_APPROVAL` at the expected version, that `updated_at` is at or before the review cutoff, and that the game is still `AUTOMATIC` and unpaused. A moderator publish, override, pause, or mode change that lands first makes it change zero rows.
  - Events from these transitions carry `source` (`MODERATOR` or `SCHEDULER`). The player timeline shows `publishedAutomatically` for `PHASE_PUBLISHED` events from the scheduler; the console derives it from a published proposal with no reviewing moderator.
- **The sweep.** `advanceGame` (`lib/game/automation-sweep.ts`) applies due steps in order for one game, reading one indexed row per pass, so an idle game costs one query. It runs on the moderator phases `GET` (the console's live-game refresh), on `GET /api/player` (the dashboard's refresh), and on `/api/scheduler/deadlines` (`sweepAutomation` for all automatic games). Polls use `advanceGameSafely`, which never fails the page and records an `AUTOMATION` operational warning instead. Concurrent sweeps and moderator actions produce one lock, one proposal, and one publication (`lib/api-automation.test.ts`).
- **Controls.** `POST /api/games/[gameId]/automation` (moderator, same-origin) handles `PAUSE`, `RESUME`, and `SETTINGS` (`publicationMode`, `reviewWindowMinutes` 0–1440) until a game is completed, stopped, or cancelled, recording `AUTOMATION_PAUSED`, `AUTOMATION_RESUMED`, or `AUTOMATION_SETTINGS_UPDATED`.

## Authentication, privacy, and limits

### Sessions and secrets

- Moderator, player, and spectator sessions are random tokens in HTTP-only, SameSite=Lax cookies (`ww_mod_session`, `ww_player_session`, `ww_spectator_session`), stored as SHA-256 hashes. They last seven days. Signing in as a player ends a spectator cookie on that device and the other way round.
- Passwords, PINs, and recovery codes are hashed with salted PBKDF2-SHA256 (100,000 iterations). Claim codes are 72-bit random tokens stored as SHA-256 hashes.
- An unknown moderator email is checked against a throwaway hash, so it takes as long as a wrong password.

### Requests and errors

- Every write checks the `Origin` header against `SITE_ORIGIN`, then authorization, then game state. The final write repeats the state checks inside the same statement, so concurrent requests cannot slip past them.
- Routes answer errors through `routeError` (`lib/http/errors.ts`): 401 when signed out, 403 for a cross-origin write or a moderator of another game, 404 for a missing game, phase, seat, or message, 409 for a lost race, 429 with `Retry-After` for a rate limit, 503 while the database is unconfigured or not migrated, and 400 for invalid input. Any other error (a database or library failure) is logged and answered with a generic 500, so internal details never reach the browser.

### What players can see

- Players receive only their own role, permitted teammates and rooms, legal targets, their own private results, and published events. `e2e/readiness/browser-fixture.ts` lists the fields that must never reach a player (`FORBIDDEN_PLAYER_KEYS`).

### Player and spectator sign-in

- **Lookup across games.** `POST /api/seats/login` looks an email up among claimed seats and `ACTIVE` spectators, joins `games` to get each candidate's game name and status, and checks the PIN. An `INVITED` spectator has no PIN yet and cannot sign in by email.
- **Ended games.** It sets aside every match in a game that has ended (`COMPLETED`, `STOPPED`, or `CANCELLED`) whenever at least one match is in a game that has not (`withoutEndedGames` in `lib/auth/login-matches.ts`; it applies to seats and spectators alike). When every match is in an ended game they are all kept, and a lone match always signs in.
- **Choosing a game.** If more than one match remains, the route answers 409 with `error` and `choices`, an array of `{ id, kind, gameName, displayName }`. This is sent only after the email and PIN were both proven, and holds no role, seat code, hash, email, or session. The sign-in screens then post the same email and PIN again with `choiceId` set to one choice's `id`. It must be one of that email's own candidates (anything else is the generic 401); the PIN is verified again for that candidate only; wrong PINs are counted against that candidate only; and a locked candidate stays locked (423).
- **Locked seats.** If the PIN fits only seats in ended games while a seat the same email holds in a game that has not ended is locked, the route answers 423 with the locked message instead of quietly signing in to the old game (`lockedSeatHiddenByEndedGame`).
- **One error for every miss.** Every wrong email, seat code, or PIN gets the same 401 (`SIGN_IN_NOT_ACCEPTED_MESSAGE` in `lib/auth/pin-lockout.ts`), which also says a seat locks after ten wrong PINs. An identifier longer than 254 characters gets that 401 at once, before the email pattern and the rate limiter. `isSingleEmailAddress` (`lib/roster/email-address.ts`) refuses anything over 254 characters and runs in linear time; moderator recovery applies the same cap.
- **Claiming.** `POST /api/seats/claim/[code]` refuses (409) a seat whose game has ended, in the read and again inside the conditional write, so a leftover invitation to a finished game cannot be claimed later.

### Rate limits and cleanup

- Limits are stored in the database and return HTTP 429 with `Retry-After`. They are per client address:
  - moderator login and recovery: 5 per 15 minutes
  - player sign-in: 8 per 15 minutes
  - seat claim: 3 per hour
  - actions and chat: 30 per 10 minutes each
  - feedback: 3 per hour (players) or 10 per hour (moderators)
  - invite email: 30 bulk sends per hour per game, plus 5 single-player resends per hour per player
- **PIN lockout.** In addition, a seat locks after 10 wrong PINs in a row (`lib/auth/pin-lockout.ts`, counted in `rate_limit_buckets` under `pin-failures:<seatId>`) and answers 423 until a moderator resets its PIN. A correct PIN or a new claim clears the count.
- **Public link routes** (player sign-up, moderator application, moderator setup) count the visitor's address first, under a key that never contains the code in the URL, and only then look the code up, so guessing codes cannot create `rate_limit_buckets` rows. The game-wide allowance is keyed by the game's id, not by the typed code, and counts only a request that is about to write: a form with the hidden bot field filled, an invalid form, or a closed link does not use any of it. Anyone holding a link can still use up its game-wide allowance with enough different addresses; the moderator can replace the link. The seat-claim and spectator links still key by code (3 per hour and 8 per 15 minutes, per address).
- **Cleanup.** Expired sessions, stale rate-limit buckets, and late-attempt log rows (`operational_events` with source `DEADLINE_MONITOR`) older than 30 days are deleted by the scheduler route and after each moderator sign-in (`lib/maintenance.ts`, which reports the last as `lateAttemptEvents`). The late-attempt delete names severity `WARNING` so it uses the `(severity, created_at)` index instead of scanning every game's events. Every other `operational_events` row is kept, as the audit trail.

## Email

### Roster and invite email

- **One address per seat.** Roster emails must be one plain address (`lib/roster/email-address.ts`): lists like `a@x.com;b@y.com` and `Name <a@x.com>` are rejected at import and when adding a player, because mail libraries split them and would send one player's claim link to several recipients. The invite route re-checks each stored address and reports any older or restored seat that fails as "Not a single email address" without changing its link.
- **Invite email** (`POST /api/games/[gameId]/invites`, optional `seatIds`) works only before roles are released and only on `INVITED` seats. It signs in to SMTP first, then replaces each seat's claim hash with a compare-and-swap on the old hash, emails the new link, and records an `INVITE_EMAILED` event (`{ seatId }`) only while that link is still current. The response never contains a claim link. The roster reports `invitationEmailedAt` from events newer than the seat's `updated_at`, so a later send, reset, or restore clears it. Settings are in `lib/email/settings.ts`.

### Player email (`lib/notify/`)

- **Preferences.** `email_preferences` holds one row per seat that has ever chosen: `enabled` (off by default) and a random `unsubscribe_token` created once and never rotated. It is outside backups and cascades with the seat.
- **Entry points.** `notifyPhaseOpened` runs after the phases `POST` opens a phase. `notifyResultPublished` runs after the one `PUBLISH` batch that commits (`runPhaseAction`, so moderator and automatic publishes both send, and an idempotent repeat does not). `notifyClosingSoon` runs from `advanceGameSafely` (any page visit) and `sweepClosingReminders` (the scheduler route). Each returns quietly unless SMTP and a site address are set, never throws, and runs through `runAfterResponse` (Next's `after`, or inline outside a request), so a slow mail server never delays a response.
- **Closes-soon is at most once.** The send is claimed with `UPDATE phases SET closing_reminder_at = ? … WHERE status = 'OPEN' AND closing_reminder_at IS NULL`; zero changed rows means another caller sent it. The mark comes before the send, so a failed send is reported in the Operations event log and not retried: a retry could mail some players twice, and a broken mail account would be retried on every page visit. A poll only reaches that write inside the last 30 minutes of a phase longer than an hour, decided in memory from the row it already read (`closingReminderDue`).
- **Who is emailed.** Opened and closes-soon go to opted-in claimed seats that `outstandingResponders` (`lib/game/outstanding.ts`) says still owe a response, the same rule as the moderator's outstanding list, so a Night reaches only players with a Night action. Result goes to every opted-in claimed seat. Message wording (`lib/notify/messages.ts`) never names a role or an action and is tested for that. Receiving a phase email on a Night does show the recipient (and anyone who sees their inbox) that they hold a Night action; this is the chosen trade-off for emailing only players who have something to do.
- **Delivery.** `deliver` sends three at a time through the pooled mailer, skips reserved test domains, adds `List-Unsubscribe` headers, and writes one `operational_events` row per batch (source `EMAIL`, id `email-<kind>-<phaseId>`), a warning if any send failed.
- **Result story** (`lib/notify/story.ts`). Input is built from the stored `PHASE_PUBLISHED` payload through the same fields the player Timeline exposes (`storyInputFromPublishedEvent`, `protectedAttackBlocked` in `lib/game/public-result.ts`); investigations, protections, overrides, and draws are never read. With `ANTHROPIC_API_KEY`, one `messages.create` call (model `STORY_MODEL`, default `claude-opus-5-5`, low effort, one attempt with a 20 s timeout) writes the story. An answer that is not `end_turn`, is the wrong length, has a link or markup, or omits an eliminated player's name is discarded for `templateStory`. Roster names are cut to one 60-character line, and the prompt tells the model that names are data. The story text and its source (`AI` or `TEMPLATE`) are kept in the batch's event details for moderators.
- **Unsubscribe.** `/email/unsubscribe?token=…` is a page that changes nothing when opened (mail scanners open links); its button posts to `POST /api/email/unsubscribe`. That route also accepts the mail app's one-click POST (RFC 8058) and so has no `Origin` check: the unguessable token is the only credential, and it can only switch that seat's email off. It is rate limited to 60 per hour per client address. `POST /api/player/email` is the player's own switch (same-origin, signed in, 20 per hour); enabling it answers 503 when the site cannot send.

## Spectators

- **Separate from seats.** Spectators (`spectators`, `spectator_sessions`, `spectator_messages`, migration `0008_spectators`) are separate from seats, so no game rule, count, or role query can include them. The rules are in `lib/game/spectators.ts`.
- **Adding and removing.** A moderator adds one (`POST /api/games/[gameId]/spectators`) only while the game is `ACTIVE` or `FINAL_SHOWDOWN`, never with the email of a non-removed seat in the game, and not twice with one email; the insert re-checks all three. The response carries the private `/spectate/<code>` link once. `DELETE …/spectators/[spectatorId]` archives the spectator as `REMOVED`, bumps `session_version`, and deletes their sessions. Both record `SPECTATOR_ADDED` or `SPECTATOR_REMOVED`. Reset and Restore remove every spectator and their Afterlife messages (`lib/roster/spectators.ts`); backups don't include spectators.
- **Link and PIN.** `POST /api/spectate/[code]` sets the PIN on the first visit (conditional on the spectator still being `INVITED`) and later checks it, locking the link after 10 wrong PINs in a row. Either way it starts a spectator session. Once a spectator has chosen a PIN they can also sign in from the home page with email and PIN (see [Player and spectator sign-in](#player-and-spectator-sign-in)); the wrong-PIN count is the same counter the link uses, so the two share one lockout. Sign-in starts a spectator session through `startSpectatorSession` (`lib/auth/spectator-link.ts`).
- **Reset PIN.** `POST /api/games/[gameId]/spectators/[spectatorId]/reset-pin` (`assertSameOrigin`, then `requireGameModerator`) gives an `ACTIVE` spectator a new moderator-chosen six-digit PIN, with a reason of at least five characters. One batch updates `pin_hash`, bumps `session_version`, deletes the spectator's sessions, clears the `pin-failures:spectator:<id>` counter, and writes an `operational_events` warning (`SPECTATOR_ACCESS`, with the reason and moderator, never the PIN). The later statements are guarded on the update having applied, so a spectator who changed in between answers 409. An `INVITED` spectator (no PIN yet) answers 409, and a removed or foreign one 404. `GET …/spectators` adds `locked` (10 wrong PINs in a row) to each row, for the console's "locked" marker.
- **What they see.** `GET /api/player` and `/` fall back to the spectator session and return `loadSpectatorDashboard` (`lib/player/dashboard-data.ts`) with `viewer: 'SPECTATOR'`: the same public roster, timeline, and published ballots as players, the Day vote count while a Day is open, no role, permission, candidates, or notifications, and the game's Afterlife and (read-only) Town Hall. `GET /api/phases/[phaseId]/votes` also accepts a spectator.
- **Chat.** Spectators read and post in their game's Afterlife through `/api/rooms/[roomId]/messages`, only while the room is open and the game is `ACTIVE` or `FINAL_SHOWDOWN`. Their messages live in `spectator_messages` and are shown with "(spectator)" after the name. The moderator's room list, message removal, and retention purge cover both tables. Spectators can read the Town Hall but not post in it, and can't reach the Pack or Mason room.

## Village stats

The dashboard's **Village stats** tab (a third view beside Today and Timeline, for players and spectators) and the console's **Village stats** panel show the same numbers: votes received per player for each published Day or all days together, the most voted player, ballot turnout and close calls, players alive and werewolves left after each result with a ledger of who left, chat activity, and a grid of who voted for whom. Nothing is stored and there is no migration; `loadGameStats` computes everything on request.

- **Only what players already see.** Votes come from the latest saved `DAY_VOTE` of each player in published Day and Final ballots of the current run, the same rows the Timeline's **View votes** reads, so an open ballot adds nothing until its result is published. Roles appear only for eliminated players, from the `PHASE_PUBLISHED` payload. The living werewolf count is the one the sidebar already shows. Counts are one per voter, so (as with the Timeline) they can differ from the result, which also reflects the Mayor's extra vote and any tiebreak. The response uses `votesReceived`, never `tally`, and is checked against `FORBIDDEN_PLAYER_KEYS` in `lib/api-stats.test.ts`.
- **Run boundary.** Reset and Restore delete the earlier run's phases, votes, and chat, so the stats start from zero. Results and votes also share the Timeline's test for a phase of the current run (`RUN_BOUNDARY` in `lib/player/dashboard-data.ts`).
- **Derived figures.** Players alive when a ballot opened is the claimed seats minus the eliminations published before it. The werewolves who started is the werewolves living now plus those whose role an elimination revealed. Both assume the roster at the time of the read, so a late Villager makes the first points slightly off.
- **Chat.** `summary.chatMessages` counts every message in every room by players, spectators, and moderators, including removed and purged ones (they stay as rows). It is the only figure that includes the private rooms, and no per-room split is sent. Every other chat figure is the Town Hall only: messages per day and per hour of the day (moderator and player messages), and the eight chattiest players (player messages only). SQL groups Town Hall messages by UTC quarter hour; `chatRhythm` converts each bucket to the game's timezone, so half-hour zones such as India land on the right hour. Quiet days between the first and last message show as zero, and at most the newest 60 days are sent.
- **Routes.** `GET /api/stats` (a signed-in player or spectator, for their own game) and `GET /api/games/[gameId]/stats` (`requireGameModerator`) answer `{ ok, stats }` through `respondJsonWithEtag`, so an unchanged poll is a 304. They do not run the automatic-results sweep; the dashboard's own refresh and the console's phase refresh already do.
- **Refresh.** The tab mounts only while it is open. It refetches at once when the newest published event or the game status changes (a result was published), and otherwise polls at the dashboard's pace (see [Polling](#polling-and-read-performance)). A failed refresh keeps the last numbers on screen with a note. The console panel loads only while it is expanded and refetches after the moderator's own changes.
- **Charts.** Drawn in `app/village-stats-charts.tsx` as plain HTML and SVG at the container's real width (no chart library). Every chart has a "View as table" twin, and the column and line charts read out values with the pointer or the arrow keys.
- **Studio.** The Player View Studio passes sample numbers (`createPreviewStats` in `app/moderator/player-preview/scenarios.ts`), so the tab previews without a live game.

## Moderator player choices

The console's **Player choices** panel lists every phase of the current run, newest first, with each player's current action in it: Day and Final ballot votes, Afterlife votes, each Werewolf's targets, the Seer's or Apprentice Seer's investigation, the Bodyguard's protection, Cupid's pair, and the Hunter's shot. Each chooser and target is shown with their role. The panel groups each phase with `groupPhaseChoices`: the special powers (`INVESTIGATE`, `PROTECT`, `CUPID_PAIR`, `HUNTER_SHOT`) are shown, and the pack's `WOLF_VOTE`s, the `DAY_VOTE`s, and the `AFTERLIFE_VOTE`s are lists the moderator opens. The newest phase starts open and older phases closed. This is only layout; the response is unchanged.

- **What counts.** Rows of `action_submissions` with `superseded_at IS NULL`, so a resubmitted choice shows only its latest version, the same one the engine counts. Open and unpublished phases are included. Phases before the latest reset or restore are left out (`RUN_BOUNDARY`). Nothing is stored and there is no migration.
- **Privacy.** The response names every role and private target, so it is served only by `GET /api/games/[gameId]/choices` behind `requireGameModerator` and is never part of a player or spectator response. A moderator who is also playing would see everything; a disguised moderator mode is a possible future enhancement.
- **Refresh.** The panel loads only while expanded, through `respondJsonWithEtag` (an unchanged poll is a 304), polls every 30 seconds with the usual idle pause, and refetches after the moderator's own changes.

## Dashboards and the moderator console

### Player dashboard

The signed-in dashboard (`/`) is rendered on the server with the same data as `GET /api/player` (after the same automatic-results sweep), then refreshes by polling. It stays `inert` until React takes over, so an early tap is never silently lost.

"Hide role" is kept per device in localStorage and mirrored in the `ww_role_visibility` cookie (`<seatId>.hidden` or `.shown`, `lib/player/role-visibility.ts`). The server renders the role only when that cookie says this seat shows it, and otherwise renders it concealed until the browser's own setting is read. While concealed, the dashboard also leaves out private rooms, teammates, and every notification except announcements, and `concealedPermission` replaces any role-only action, and every living player's open Night, with "Your role is hidden". This is display only; the API response is unchanged.

### Moderator console

- **One request to load.** `GET /api/games` returns the games list plus the selected game's roster and assignments (`?gameId=`, or the newest game; `lib/game/setup-view.ts`), and its signed-out 401 carries `needsBootstrap`. The roster view also carries the sign-up summary (whether the link is live, how many people are waiting, how many applications are waiting), which drives the numbers on the Setup and People tabs.
- **Five tabs.** `lib/game/console-guidance.ts` names them, picks the one that opens first from the game's status, and words the next-step notes. Setup opens until roles are released, then Run game. Every tab stays mounted, hidden when not open, so each keeps its drafts and its polling. A tab the moderator picks holds only while the game stays on the same side of release (`resolveConsoleTab`): a reset sends the console back to Setup, and a release moves it to Run game.
- **Shared state.** One `OperationsProvider` (`app/moderator/operations-context.tsx`) owns the operations data and actions, and the parts on the Run game, People, Messages, and Safety & records tabs read it (`app/moderator/ops-sections.tsx`). It refreshes operations and rooms on every tick; the co-moderator list, announcements, and feedback at most once a minute; and everything after the moderator's own changes.
- **Event log.** Under Safety & records it shows the game's last 20 `operational_events` (email batches with `storySource`, warnings, deadline locks). `DEADLINE_MONITOR` late-attempt rows are left out and counted in `activity.lateRejections`. The log marks a moderator's own audited actions (stop, reset, PIN reset) as warnings too, so the number on the Safety & records tab counts only `EMAIL` and `AUTOMATION` warnings logged since the moderator last had that tab open (`attentionEventCount`), the ones that mean something failed.
- **Feedback.** `GET /api/games/[gameId]/feedback` returns ratings, comments, respondent type, and time, with the average (`summarizeFeedback` in `lib/game/feedback.ts`). The `pilot_feedback` table has no respondent id, but each submission's `operational_events` row records the sender's seat or moderator id, so feedback is not anonymous to moderators or in backups.
- **Phases `GET`.** It adds `outstanding` to the open phase: living players who still owe a response, following the same permission rule players see (`lib/game/outstanding.ts`). It sends full results (`proposal`) only for phases not yet published and for the newest phase; older published phases come with `proposal: null` but keep their `publishedAutomatically` mark, since the console shows only the latest result. The console's nudge text (`lib/game/moderator-copy.ts`) names players only for Day and Final ballots.

## Polling and read performance

There are no WebSockets; pages poll. How often:

- The player dashboard and the console's live game panel refresh every 10 seconds while an open phase's deadline is within 15 minutes, and every 30 seconds otherwise (`pollInterval` in `lib/http/poll-interval.ts`).
- A chat room refreshes every 10 seconds while its newest message is under two minutes old, and every 30 seconds otherwise. Player and moderator chat lists show the newest message first.
- The rest of the console (games list and setup, operations, rooms) refreshes every 30 seconds.
- The Village stats tab and the Player choices panel refresh only while open (see [Village stats](#village-stats) and [Moderator player choices](#moderator-player-choices)).
- **Idle pause.** The player and spectator dashboard and the chat rooms stop refreshing after five minutes without a tap, click, scroll, or key press (`IDLE_AFTER_MS`), because a window left open on a second screen still counts as visible. The dashboard then shows "Updates are paused while you're away"; the first input, or coming back to the tab, refreshes at once and restarts the timer. The moderator console pauses the same way, with nothing on screen: the games list, the operations and rooms refresh, the sign-ups and applications lists, an open room's history, and the Player choices panel.
- **The exception** is the Run game tab's phases refresh, which never pauses for idleness while the game has not ended, because each of its requests runs the game's due automatic steps (`advanceGameSafely`), so an unattended console still publishes an automatic result on time.
- **Ended games.** Once the game is `COMPLETED`, `STOPPED`, or `CANCELLED`, the dashboard stops refreshing on its timer, and a chat room stops once it is no longer `OPEN`. Each still refreshes once when the tab comes back. The same three statuses stop every console refresh, the phases refresh included (`useGameEnded` in `app/moderator/use-game-ended.ts` feeds each poll's `stopWhen`). The console has no refresh button, so for an ended game its numbers, such as feedback sent after the game finished, change only when the page is reloaded, the tab is left and returned to, or the moderator makes a change. `e2e/readiness/browser-console-polling.spec.ts` counts the console's requests over minutes of controlled time to check all of this.
- Nothing in the game depends on these refreshes: deadlines are enforced when a response is saved, and automatic steps also run from the console and the scheduler route.
- Replacing polling with Web Push has been proposed but is not built. It would add a subscriptions table, a service worker, and a `web-push` dependency.

**Jitter.** Each wait is the interval give or take 20% (`pollWhileVisible` in `lib/http/poll-while-visible.ts`), so pages opened together, or all sped up by the same deadline, drift apart instead of reaching the server at once.

**Conditional requests.** Every polled `GET` answers through `respondJsonWithEtag` (`lib/http/etag.ts`): the `ETag` is a hash of the JSON body, and a request whose `If-None-Match` matches gets an empty 304. Pollers use `conditionalGet` (`lib/http/conditional-get.ts`) and keep each tag next to the data it describes, so a 304 skips the state update and the re-render, and a response the page drops (a newer request won) never leaves it holding a tag for data it isn't showing. `/api/*` keeps `Cache-Control: private, no-store`: the browser stores nothing, which matters on shared devices, and the tag comes from the page's own memory.

**Ballots.** A dashboard refresh sends who voted for whom only for the newest published ballot in its timeline; every other ballot carries `voteCount`. The Timeline and **View votes** load an older ballot's votes from `GET /api/phases/:phaseId/votes` the first time it is opened (`app/ballot-votes.tsx`). That route answers only a signed-in player of the same game, and only for a published Day or Final ballot of the current run (`loadBallotVotes`).

**Reads and writes.** Timeline reads look up public events through `idx_game_events_type` (`INDEXED BY`), because every saved action also writes an `ACTION_SUBMITTED` audit event to the same table. Saving an action reads the phase, roster, and lover pair in parallel, then counts the attempt against the rate limit (30 per player per phase per 10 minutes) and saves the action in one transaction; an attempt over the limit saves nothing and answers 429.

**Player refresh.** `GET /api/player` runs the automation check, then two read batches (`db.batch(..., 'read')`: each batch is one request and its statements see one snapshot). That is 11 statements in 3 sequential rounds for most players on an open Day, plus one for the session lookup. `lib/player/dashboard-data.test.ts` pins the batches and the statement count.

- **Batch 1** reads the seat, the current phase, the roster, the three public-timeline reads, and the player's rooms. None waits for another because the route passes the seat's `gameId`. Without a `gameId` (tests, other callers) one extra read finds the seat's game first, and a seat that belongs to a different game than the one asked about is answered as not found.
- **Batch 2** reads what needs the open phase and the player's permission: their saved action, the shared submission count where the action counts across players, their notifications, and the Hunter's proposal while one is pending.
- **Two reads are conditional.** A Cupid's lover pair is read only for a Cupid, between the batches (12 statements in 4 rounds), because only a Cupid's permission depends on it. The chat-room repair runs only when the game has fewer rooms than a full set (the count rides along in the seat read), before the rooms are read, so the first answer already includes repaired rooms.

**Indexes.** Migration `0013_event_log_and_sign_in_indexes` adds three indexes and changes no data. `idx_operational_events_game_time` on `(game_id, created_at)` serves the console event log and the 24-hour late-attempt count. The expression indexes `idx_seats_email_lower` and `idx_spectators_email_lower` on `lower(email)` let email sign-in (`lower(email) = ?`) search instead of scanning every game. `lib/db/migrations.test.ts` checks that these lookups use them. The older `(severity, created_at)` index stays: the late-attempt delete uses it.

## Reserved fields

The schema has fields and states that no feature writes. Code may filter on them, but nothing sets them, so don't build on them or add more like them; drop them in a migration when one is next needed.

- Phase status `SCHEDULED`.
- Chat room status `PURGED` and `chat_rooms.expires_at`. Retention purges blank the messages instead.
- Seat status `REPLACED` and `seats.predecessor_seat_id`.
- `game_events.supersedes_event_id`.
- `games.final_round_minutes`: stored, backed up, and restored but not used. It is reserved for a possible timed Final ballot and has no setting in the console.
