# Watercooler Werewolf

Watercooler Werewolf is a slow-burn, moderator-reviewed Werewolf game for an office or other trusted group. The current source is the Phase 6 pilot-hardening build. The exact source checkpoint is always available with `git log -1 --oneline`; the current deployment version and commit are recorded in [BUILD_STATUS.md](BUILD_STATUS.md).

## Run and verify

Use Node.js 22.13 or newer. The project uses npm and Vinext.

```text
npm install
npm run dev
npm run pilot:setup
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm audit --omit=dev
```

`npm run dev` starts the local Vinext/Cloudflare preview. The app creates its local D1 schema on the first request. Do not put passwords, invite codes, tokens, or production values in this repository.

`npm run pilot:setup` creates a disposable local game from the fictional 20-player fixture and writes a one-time invite CSV under `outputs/`. It is deliberately mutation-gated: set `PILOT_ALLOW_MUTATION=yes` and provide a fictional `PILOT_MODERATOR_PASSWORD` (at least 12 characters). Use `PILOT_BASE_URL` to point at a local or explicitly approved environment. Never run it against production data. In PowerShell:

```powershell
$env:PILOT_ALLOW_MUTATION = 'yes'
$env:PILOT_MODERATOR_PASSWORD = 'a-fictional-12-character-password'
npm run pilot:setup
```

## Local D1 and fictional data

The logical D1 binding is `DB`, configured in `.openai/hosting.json`. Wrangler/Miniflare keeps local state under the project `.wrangler` directory. `ensureDatabase()` applies the checked-in migrations, including the Bodyguard compatibility migration, before application queries run. Hosted deployments may provision those same checked-in migrations before the Worker starts; the bootstrap recognizes a complete pre-provisioned schema, records it in the application ledger, and only applies missing additive columns. It refuses to guess at or overwrite a partial initial schema. The schema source is `db/schema.ts`; after schema changes, generate and inspect a Drizzle migration with `npm run db:generate` and keep the resulting SQL under `drizzle/`.

Game deadlines are entered as local `datetime-local` values and converted on the server using the game's IANA timezone (including daylight-saving transitions). The stored `*_at` values are UTC ISO timestamps; displayed times use the viewer's locale.

Use [fixtures/roster-20.csv](fixtures/roster-20.csv) only with disposable `.test` accounts. A safe rehearsal is documented in [fixtures/README.md](fixtures/README.md). Never mix the fictional fixture with a real roster.

## Pilot show-and-play checklist

The hosted MVP has a public landing and credential screens so pilot participants do not need ChatGPT accounts. Gameplay remains closed: moderators use an app password, and each invited player must claim a private seat and choose a six-digit PIN before signing in with their seat code. The public surface does not list games, rosters, roles, rooms, or audit data. Keep claim links private and use fictional `.test` accounts for rehearsals.

Use a disposable game and keep the moderator console in one browser profile and each test player in a separate profile (or private window):

1. Run the mutation-gated `pilot:setup` helper (PowerShell example above; POSIX shells can prefix `PILOT_ALLOW_MUTATION=yes PILOT_MODERATOR_PASSWORD="a-fictional-12-character-password"`) against a disposable local preview, or bootstrap a fictional moderator manually. Set the game's IANA timezone to the timezone used by the facilitator.
2. Import [fixtures/roster-20.csv](fixtures/roster-20.csv), download the one-time invite CSV, and claim every seat with unique six-digit test PINs. Keep the invite CSV private; it contains the only claim links.
3. Review the default 20-player composition (12 Villagers, 3 Werewolves, 1 Seer, 1 Bodyguard, 1 Hunter, and 2 Masons), randomize, inspect the assignment evidence, and release roles. Verify that each player can see only their own role and permitted teammates/room.
4. Open a Day ballot. Have a player submit, revise, and submit again; verify that the latest revision is the one counted. Lock and propose, then publish the reviewed outcome. Confirm the timeline, living count, eliminated-role reveal, and Hunter follow-up when a Hunter is eliminated.
5. Open the next legal Night phase. Exercise the Werewolf attack, Bodyguard protection, and Seer investigation with known fixture seats. Publish and verify that a protected target survives and the Seer receives a private exact-role notification.
6. Exercise a no-vote or tie, a reasoned moderator override, private-room messaging, message moderation, and an in-app announcement. Check the Operations panel after each mutation and use **Check deadlines** for an expired test phase.
7. After an ordinary published phase and a test final cutoff in the past, enter **Final Showdown** and run a **Final Ballot**. Confirm that invalid phase kinds are rejected, a no-vote keeps the showdown open, and a winning publication completes the game and freezes rooms.
8. Export a verified JSON backup. Before teardown, test **Stop** with a reason and confirmation, verify the player stopped message/read-only rooms, then test owner-only **Reset** by typing the exact game name. Confirm the backup/audit record remains, sessions and old claim links no longer work, and the game returns to setup.
9. Ask players to submit the private pilot feedback form. Record defects and rule questions before using any real roster.

The player dashboard polls for phase, result, notification, and stopped-state changes every ten seconds while preserving an unsaved ballot selection. A manual **Check for updates** action remains available. Visual desktop and 390x844 checks still require a connected browser; do not treat this checklist as a substitute for that QA gate.

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

Pilot abuse controls return HTTP 429 with `Retry-After`: moderator login is limited to 5 attempts per 15 minutes, bootstrap to 3 per 15 minutes, player sign-in to 8 per 15 minutes, seat claiming to 3 per hour, player actions/private chat to 30 per 10 minutes, and player feedback to 3 per hour (moderator feedback to 10 per hour). Buckets are stored in D1 and updated atomically so a worker restart or simultaneous requests do not silently remove or overwrite the limit.

## Rooms, announcements, backups, and audit

Moderators can lock/reopen rooms, remove a message with a reason, purge messages past the configured retention period, and publish in-app announcements. Announcement records include email-ready subject/body text but are not delivered by an email provider.

JSON backups include the recoverable game state, roles, phases, actions, proposals, events, rooms, announcements, notifications, pilot feedback, and operational events. Each backup has a SHA-256 checksum and is stored as a moderator-only backup record. Stop/Reset operations also create operational and game audit events. A local service restart rehydrates the same D1 state; the moderator can export a backup before any recovery operation.

The owner-only **Recovery restore** control lists stored snapshots. Restoring requires explicit confirmation and the exact game name, verifies the checksum and game id, creates a safety backup first, and restores only the selected game’s configuration, roster, and composition to `DRAFT`. Active phases, role assignments, submissions, proposals, notifications, announcements, room memberships, messages, and player sessions are cleared. Existing audit/operational history and both backup records remain. Every restored seat gets a new one-time claim link; PINs, old claim links, role secrets, and sessions are never restored. Download the fresh invite CSV immediately—the codes are not shown again.

## Stop and Reset

**Stop** is available to an authorized game moderator. It requires an explicit confirmation and a reason of at least five characters. Stop changes the game to `STOPPED`, marks scheduled/open/review phases superseded, makes every room read-only, and blocks player actions and further gameplay. Players see a clear stopped message. Repeating Stop on an already stopped game is idempotent and does not add conflicting state. Completed and cancelled games cannot be stopped.

**Reset** is an owner-only recovery action. It requires explicit confirmation and typing the exact game name. A recoverable backup is created before destructive changes. Reset is isolated to the selected game, invalidates all player sessions and old claim codes, restores seats to invited/living setup state, removes role assignments, role counts, assignment batches, phases, submissions, proposals, notifications, room memberships, and chat messages, reopens the empty rooms, and changes the game to `DRAFT`. The game's existing event/audit history and the pre-reset backup remain. Repeating Reset on a clean draft is harmless; cancelled games cannot be reset. Re-import the roster before configuring roles again.

**Recovery restore** is the complementary owner-only action for a stored snapshot. It is intentionally a setup restore rather than a secret/session restore: it gives the moderator a clean roster and configuration from the snapshot, then requires players to claim newly generated links and roles to be randomized/released again. This makes a recovery safe after a test, a stale invite, or a local restart without reusing private credentials.

## Phase 6 scope

Phase 6 is intentionally resumable. The current pilot-hardening build includes timezone/DST conversion, D1-backed auth/action/chat/feedback rate limits, due-phase reconciliation, late-attempt logging, activity health metrics, moderator/player feedback capture, a cron-compatible deadline sweep, checksum-verified setup restore, and the fictional pilot setup helper. The Operations panel also polls and reconciles deadlines as a safe fallback when a host scheduler is not configured.

For unattended deadline monitoring, configure a private `WATERCOOLER_SCHEDULER_TOKEN` secret and invoke `POST /api/scheduler/deadlines` once per minute with `Authorization: Bearer <token>`. The endpoint is intentionally disabled with HTTP 503 until the secret exists. It is safe to retry: due phases, audit events, and operational events use conditional writes/stable ids. The owner-only Operations panel’s **Check deadlines** action and ten-second polling remain the supported pilot fallback.

The remaining pilot gate is human verification and operating the first fictional group game:

- hosted end-to-end, authorization, concurrency, recovery, and accessibility regression coverage;
- a fictional 20-player pilot followed by a feedback-driven backlog.

## Explicitly out of scope for this build

Do not claim performance readiness. Dedicated performance/load testing is intentionally deferred until the MVP is complete and the functional/security pilot gates pass. Real email delivery, external SSO, anonymous gameplay, native mobile clients, and production invitations are also outside this local verification scope unless separately approved and implemented.
