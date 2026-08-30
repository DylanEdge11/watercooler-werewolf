# Watercooler Werewolf

Watercooler Werewolf is a slow-burn, moderator-reviewed Werewolf game for an office or other trusted group. The current source is the Phase 6 preparation build. The exact source checkpoint is always available with `git log -1 --oneline`; the current private MVP deployment is Sites version 2 from commit `9141753a0845fbf9a26c4419ab12807ca8fce5de` and is recorded in [BUILD_STATUS.md](BUILD_STATUS.md).

## Run and verify

Use Node.js 22.13 or newer. The project uses npm and Vinext.

```text
npm install
npm run dev
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm audit --omit=dev
```

`npm run dev` starts the local Vinext/Cloudflare preview. The app creates its local D1 schema on the first request. Do not put passwords, invite codes, tokens, or production values in this repository.

## Local D1 and fictional data

The logical D1 binding is `DB`, configured in `.openai/hosting.json`. Wrangler/Miniflare keeps local state under the project `.wrangler` directory. `ensureDatabase()` applies the checked-in migrations, including the Bodyguard compatibility migration, before application queries run. The schema source is `db/schema.ts`; after schema changes, generate and inspect a Drizzle migration with `npm run db:generate` and keep the resulting SQL under `drizzle/`.

Game deadlines are entered as local `datetime-local` values and converted on the server using the game's IANA timezone (including daylight-saving transitions). The stored `*_at` values are UTC ISO timestamps; displayed times use the viewer's locale.

Use [fixtures/roster-20.csv](fixtures/roster-20.csv) only with disposable `.test` accounts. A safe rehearsal is documented in [fixtures/README.md](fixtures/README.md). Never mix the fictional fixture with a real roster.

## User types and pilot scope

- **Game owner/moderator:** creates games, imports the roster, chooses the composition, previews and releases roles, opens and resolves phases, publishes announcements, manages rooms, exports backups, and can Stop or Reset a game.
- **Co-moderator:** can run the assigned game and its communications/operations controls, but cannot perform the owner-only Reset action.
- **Invited player:** claims one private seat with an invite link and a six-digit PIN, then signs in with the private seat code and PIN.

The pilot supports one game with 20–80 seats, weekday day/night cycles, server-authoritative D1 state, private role information, moderator review, polling updates, private faction rooms, in-app announcements, and JSON backups with checksums. Announcements currently create email-ready copy; the app does not send email.

## Roles

The canonical protective role key is `BODYGUARD`; “Doctor” is not a separate role. Older D1 rows containing `DOCTOR` are migrated to `BODYGUARD`.

| Role | Faction | Exact behavior |
| --- | --- | --- |
| Villager | Village | Has no night power. Participates in the Day/final ballot and wins when every Werewolf is eliminated. |
| Werewolf | Werewolf | Sees the pack room and submits a night attack ballot. A Werewolf cannot target themself or another Werewolf. Werewolves win at parity with the living Village faction. |
| Seer | Village | Once per night, investigates one other living player and receives that player’s exact role privately after publication. |
| Bodyguard | Village | Once per night, protects one other living player. One Werewolf attack against that player is prevented; the Bodyguard cannot protect themself, a dead player, or multiple targets. |
| Hunter | Village | Has no ordinary night action. When eliminated, receives a final shot at one living player not already eliminated in that resolution. A missed deadline means no shot. |
| Mason | Village | Knows the other Masons and can use the private Mason room. Mason groups require at least two seats. |

## Composition and limits

The roster must contain 20–80 unique email addresses. Every claimed seat receives exactly one role. The default composition uses the nearest whole number to one Werewolf per six players, plus one Seer, one Bodyguard, one Hunter, two Masons, and Villagers for the remainder. The moderator may edit counts before release.

Seer, Bodyguard, and Hunter are unique and capped at one each. Masons must be zero or at least two. At least one Werewolf is required. Counts must equal the claimed roster size. Role release is one-way until the game is Reset.

## Phase order and resolution

After roles are released, the first legal phase is **DAY**. Ordinary phases must alternate `DAY → NIGHT → DAY`. The moderator opens a phase with a future deadline; eligible players can submit and revise their latest response until the phase is locked. The deadline monitor runs whenever the Operations panel refreshes and can also be triggered with **Check deadlines**; due phases become locked without publishing an outcome.

The normal resolution sequence is:

1. Moderator opens the legal phase.
2. Players submit or revise actions until the deadline.
3. Moderator locks responses and the deterministic engine proposes an outcome.
4. If a Hunter was eliminated, the Hunter receives a separate response window.
5. Moderator approves the proposal or publishes a reasoned override.
6. Publication applies eliminations, private Seer results, room membership changes, timeline events, and win evaluation.

Day and final ballots use the configured elimination-slot count. Only the latest revision from each actor/action is counted. Self-targets, dead targets, duplicate targets, and illegal faction targets are rejected server-side. A no-vote round eliminates nobody and continues the alternating sequence. If a boundary tie determines a slot, the recorded random draw is included in the proposal/audit trail.

### Final showdown

Final showdown is entered explicitly by a moderator after the configured final cutoff and after the latest ordinary Day or Night phase has been published. Entering it changes the game status to `FINAL_SHOWDOWN`; it is not inferred from an arbitrary phase request.

While in final showdown, the only legal phase is `FINAL_BALLOT`. It uses the Day-style ballot and the same review, tie, no-vote, Hunter, elimination, and win rules. If publication produces a Village or Werewolf winner, the game becomes `COMPLETED`. If it produces no winner (including a no-vote), the game remains in `FINAL_SHOWDOWN` and the moderator may open another final ballot. A completed game cannot accept further phases.

## Win conditions

After each published resolution, living players are recalculated. Village wins when no living Werewolves remain. Werewolves win when living Werewolves are at least as numerous as all living Village players. Otherwise the campaign continues.

## Privacy and permissions

Moderator sessions and player seat sessions are opaque, HTTP-only cookies stored as hashes in D1. Passwords and six-digit PINs are hashed; invite exports contain only the one-time claim URL/code needed for delivery. Every mutation checks same-origin policy and performs server-side authorization and role/phase validation.

Players receive only their own role, legal candidates, private results, permitted teammates, permitted rooms, and published events. Werewolf, Mason, and Afterlife rooms enforce membership on the server. Eliminated faction members become read-only in their former room and receive the Afterlife room. No role, PIN hash, claim hash, session token, or password is included in a moderator JSON backup.

Pilot abuse controls return HTTP 429 with `Retry-After`: moderator login is limited to 5 attempts per 15 minutes, bootstrap to 3 per 15 minutes, player sign-in to 8 per 15 minutes, seat claiming to 3 per hour, and player actions/private chat to 30 per 10 minutes. Buckets are stored in D1 and updated atomically so a worker restart or simultaneous requests do not silently remove or overwrite the limit.

## Rooms, announcements, backups, and audit

Moderators can lock/reopen rooms, remove a message with a reason, purge messages past the configured retention period, and publish in-app announcements. Announcement records include email-ready subject/body text but are not delivered by an email provider.

JSON backups include the recoverable game state, roles, phases, actions, proposals, events, rooms, announcements, notifications, pilot feedback, and operational events. Each backup has a SHA-256 checksum and is stored as a moderator-only backup record. Stop/Reset operations also create operational and game audit events. A local service restart rehydrates the same D1 state; the moderator can export a backup before any recovery operation.

## Stop and Reset

**Stop** is available to an authorized game moderator. It requires an explicit confirmation and a reason of at least five characters. Stop changes the game to `STOPPED`, marks scheduled/open/review phases superseded, makes every room read-only, and blocks player actions and further gameplay. Players see a clear stopped message. Repeating Stop on an already stopped game is idempotent and does not add conflicting state. Completed and cancelled games cannot be stopped.

**Reset** is an owner-only recovery action. It requires explicit confirmation and typing the exact game name. A recoverable backup is created before destructive changes. Reset is isolated to the selected game, invalidates all player sessions and old claim codes, restores seats to invited/living setup state, removes role assignments, role counts, assignment batches, phases, submissions, proposals, notifications, room memberships, and chat messages, reopens the empty rooms, and changes the game to `DRAFT`. The game’s existing event/audit history and the pre-reset backup remain. Repeating Reset on a clean draft is harmless; cancelled games cannot be reset. Re-import the roster before configuring roles again.

## Phase 6 scope

Phase 6 is intentionally resumable. The current preparation build already includes timezone/DST conversion, atomic D1-backed auth/action/chat rate limits, due-phase reconciliation, late-attempt logging, activity health metrics, and moderator feedback capture. Remaining pilot work is:

- scheduling automation, timezone/DST handling, reminders, missed-deadline recovery, and idempotent jobs;
- rate limits and abuse resistance for moderator/player authentication, claiming, actions, and chat;
- feedback and operational instrumentation for participation, missed actions, errors, overrides, and pilot surveys;
- late-submission and deadline monitoring;
- hosted end-to-end, authorization, concurrency, recovery, and accessibility regression coverage;
- backup restoration tooling and a moderator recovery runbook;
- a fictional 20-player pilot followed by a feedback-driven backlog.

## Explicitly out of scope for this build

Do not claim performance readiness. Dedicated performance/load testing is intentionally deferred until the MVP is complete and the functional/security pilot gates pass. Real email delivery, external SSO, public/open access, native mobile clients, and production invitations are also outside this local verification scope unless separately approved and implemented.
