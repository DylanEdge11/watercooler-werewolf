# Watercooler Werewolf Build Status

> Historical build log. For the newer Vercel checkpoint, read [Implementation progress](docs/IMPLEMENTATION_PROGRESS.md) and [Hosted QA](docs/PLAYWRIGHT_HOSTED_QA_REPORT.md). For user instructions, read [How to Use Watercooler Werewolf](docs/HOW_TO_USE_WATERCOOLER_WEREWOLF.md). The dated material below is retained as history; its references to current work, old hosting, pending gates, and resume steps are not current instructions.

The native Next.js/libSQL migration is tracked in [MIGRATION_PROGRESS.md](MIGRATION_PROGRESS.md). The historical Sites/Cloudflare entries below remain as a record of the prior deployment and are not evidence of a Vercel preview or production deployment.

## Current checkpoint

- Current source checkpoint: uncommitted pilot-hardening worktree based on reviewed commit `1db8eb87ba002fdc3468d62bb1f56ebe37ec2545`
- Phase 0 - Sites scaffold and first meaningful player preview: **complete**
- Phase 1 — Domain model, game engine, persistence schema, and engine tests: **complete**
- Phase 2 — Authentication, roster, setup wizard, and role assignment: **complete**
- Phase 3 - Live player actions and moderator resolution workflow: **complete**
- Phase 4 - Private rooms, recap, backups, and operational controls: **complete**
- Phase 5 - Full verification, rehearsal fixtures, and private MVP hosting: **complete**
- Phase 6 — Pilot hardening, scheduling automation, rate limits, and feedback instrumentation: **implementation complete; local release gates passed; hosted/browser gates pending**

## Verified at this checkpoint

- Official Sites scaffold created with D1 persistence binding.
- Responsive player dashboard renders at the local root route.
- Werewolf role, phase deadline, participation status, and two-slot ballot are represented.
- Ballot candidate selection is keyboard-accessible and capped at two choices.
- Local route responds successfully.
- Six-role catalog and agreed signed balance score are implemented.
- Default composition, unique-role constraints, Mason pairing, and one-in-six wolf baseline are tested.
- Day/night slot scaling is tested at 20, 30, 31, 40, 60, 61, and 80 living players.
- Day, night, Bodyguard, Seer, Hunter, random tie, and faction victory rules pass the engine regression tests.
- D1 schema and initial migration cover identities, games, seats, assignments, phases, actions, resolutions, events, rooms, notifications, and backups.
- Moderator bootstrap/sign-in uses durable opaque sessions and PBKDF2-SHA256 password hashing compatible with the Worker runtime.
- CSV roster import validates 6–80 unique players and creates private hashed seat codes plus a one-time invite export; the standard rehearsal fixture remains 20 players.
- Players can claim a seat with a six-digit PIN, resume with seat code + PIN, and sign out.
- The moderator launch console covers schedule creation, roster claim progress, constrained role composition, randomized assignment previews, and one-way role release.
- Assignment evidence hashes, immutable revisions, release locks, and game events provide an audit trail without exposing player roles in invite files.
- A complete local rehearsal created 20 seats, claimed all 20, assigned all 20 roles, and released the batch successfully through the real API.
- The setup, moderator sign-in, and player sign-in screens were browser-verified.
- Live day, night, final-ballot, and Hunter response windows enforce role-specific actions and target rules on the server.
- Player responses are revisable until lock; only the latest immutable revision is counted.
- The moderator can open phases, lock responses, review deterministic tallies, inspect protected targets and recorded tie draws, approve results, or publish a reasoned override.
- Published outcomes eliminate seats, reveal eliminated roles, send private Seer results, update the public timeline, and evaluate Village/Werewolf victory.
- The real player dashboard now shows only the signed-in player's role, legal candidates, teammates when applicable, participation, private results, and published events.
- A live-cycle rehearsal saved two ballot revisions, counted only the latest, proposed and published one elimination, and moved the living count from 20 to 19.
- Werewolf, Mason, and eliminated-player rooms enforce server-side membership, write/read-only access, 1,000-character messages, and polling updates.
- Eliminated faction members become read-only in their former room and gain the dead-player room; every private room freezes when the game ends.
- Moderators can publish in-app announcements with email-ready copy, add co-moderators, lock rooms, remove messages with an audit reason, and apply chat retention.
- The operational console reports roster, living count, sessions, stale deadlines, recent warnings, room health, and last-backup state.
- Moderator-only JSON backups include the recoverable game and audit record while excluding passwords, claim/PIN hashes, and session tokens; each export has a SHA-256 checksum.
- A Phase 4 rehearsal verified pack-room access and posting, message moderation, 20 announcement notifications, co-moderator access, three room types, an operational warning, and a logged checksum backup.
- Seventy-three unit tests across twenty-three files, the full lint suite, and strict TypeScript checks pass in the current worktree.
- Production build succeeds with Vinext, Vite 8.3.0, React/RSC 19.3.0, and the Cloudflare plugin set.
- Default campaign dates are calculated relative to the next Monday; dates shown in planning documents are not treated as release constraints.
- A 20-player rehearsal roster, branded social preview, and favicon are included for the MVP handoff.
- The current production-only dependency audit reports zero known vulnerabilities. The full audit reports four moderate development-tool advisories through Drizzle Kit's deprecated esbuild loader; the suggested Drizzle Kit downgrade was not applied.

## Historical hosted checkpoints (reference only)

- Sites version 1 was the original private MVP package from commit `b0546ec98464700a3fc0454e6743284869f1754e`.
- Sites version 2 packages the first verified Phase 6 preparation build from commit `9141753a0845fbf9a26c4419ab12807ca8fce5de`.
- Sites version 3 packages the atomic rate-limit hardening from commit `b3dfad2b06865c65415098f655bdd967a2dada17`.
- Sites version 4 packages the authenticated player-feedback flow from commit `2c4e94c26f4f837212374388b374d3652f500f88`.
- Sites version 5 packages the player polling, in-flight submission guard, `.test` sample roster, and show-and-play runbook from commit `06ac11e628fc4e8f4770e125c2c269dddc01bec3`.
- Sites version 9 packages the pilot setup helper, owner-only backup restore, cron-compatible deadline sweep, concurrent claim/action hardening, and recovery runbook from commit `9b956c030ed5e70ed24baa55e3e016d8cce75f3f`; deployment `appgdep_6a94a04ecac48191a0c3fa7ac821c280` succeeded at the private live URL.
- Sites version 10 fixes the production login-blocking D1 migration collision by safely adopting a complete platform-provisioned schema, applying additive lifecycle changes idempotently, and refusing unsafe partial-schema repair. It packages commit `b7e778a42e3356f88441a39ead70aafe71ff8d3b`; deployment `appgdep_6a94b0f8abb08191a76e6d8020bb3b50` succeeded at the private live URL without deleting or resetting production data.
- Sites version 11 packages reliable full-page credential navigation for the public pilot from commit `290b6fa70403f58ff017f2c03cd57a10eefdcbea`; deployment `appgdep_6a94bf05ce1c81918c6d3684bc70c407` succeeded at the live URL.
- Sites version 12 protects first-moderator creation with one-time configured-owner verification while leaving all normal player/moderator use on app-owned credentials. It packages commit `5785bf80a85ef3f7bd025471701caca5653b4bc4`; deployment `appgdep_6a94d313b5588191b241d4db7d527e1b` succeeded with environment revision 2.
- Sites version 13 lowers new password/PIN hashes to the Cloudflare Worker-supported PBKDF2-SHA256 maximum of 100,000 iterations and shows a clear verified-owner status above the primary moderator form. It packages commit `ddd51bcec8c26060b546bb8896a7b4c3d9d38640`; deployment `appgdep_6a94d6b888b081919e377e0a0c15db95` succeeded at the live URL.
- The current MVP is deployed at `https://watercooler-werewolf.dylan-d-edgar.chatgpt.site`. Its public landing and credential screens allow pilot participants without ChatGPT accounts; moderator and gameplay data remain protected by app-owned moderator sessions and private player seat-code/PIN sessions.
- Hosted browser verification confirmed the public landing, player seat-code/PIN form, successful pre-provisioned D1 adoption, and a direct unauthenticated moderator API rejection with HTTP 401. Fresh Worker logs show expected unauthenticated 401 responses and no D1 migration error.
- Public-bootstrap verification confirmed that anonymous visitors receive only the site-owner verification path and that an anonymous direct first-moderator creation attempt is rejected with HTTP 403.
- The canonical protective role is now `BODYGUARD`; the migration rewrites legacy `DOCTOR` rows and new API/UI output never exposes Doctor as a separate role.
- Stop and owner-confirmed Reset controls are transactional, audited, backup-first, session-invalidating, game-isolated, and repeat-safe.
- Server-side phase policy requires Day first, Day/Night alternation, explicit post-cutoff Final Showdown, and Final Ballot-only play during showdown.
- Phase 6 pilot hardening now includes timezone-aware deadline conversion, D1-backed authentication/action/chat/feedback rate limits, due-phase reconciliation, late-attempt operational events, activity health metrics, and moderator/player feedback capture.
- Rate-limit bucket increments/reset windows now execute atomically in a D1 batch, so simultaneous requests cannot overwrite the attempt count.
- Operations refreshes automatically after live mutations and by polling; the player mobile layout provides alternate section navigation while preserving the right rail content.
- The player dashboard polls every ten seconds for phase, result, notification, and stopped-state changes while preserving an unsaved ballot; action and feedback buttons guard against duplicate in-flight clicks.
- The README now includes a complete pilot show-and-play checklist for a disposable 20-player `.test` rehearsal, privacy checks, phase exercises, Stop/Reset recovery, and teardown.
- Local API rehearsal verified fictional roster claim/release, phase rejection/idempotence, Stop/Reset/audit/backup/session invalidation, feedback capture, cross-game isolation, rate-limit behavior, and service-restart persistence. Hosted desktop credential navigation is verified; the full authenticated game and 390x844 visual pass remain part of the first fictional pilot rehearsal.
- The owner-only Recovery restore path verifies a stored backup checksum and game id, creates a safety backup, restores only configuration/roster/composition to `DRAFT`, clears active gameplay/secrets/sessions, preserves audit history, and returns fresh one-time invite links. Repeated restore attempts are isolated to the selected game.
- A cron-compatible `POST /api/scheduler/deadlines` endpoint and all-game D1 sweep now complement the Operations panel heartbeat. The endpoint requires a private `WATERCOOLER_SCHEDULER_TOKEN`; when unset it fails closed with HTTP 503, so private pilots can use the panel fallback safely.
- Player claim uses a conditional `UPDATE ... RETURNING` and action revisions allocate their version inside a serialized D1 batch, preventing double claims and unique-version collisions during simultaneous submissions.
- `npm run pilot:setup` creates a disposable 20-player `.test` game and writes a one-time invite CSV only when `PILOT_ALLOW_MUTATION=yes` is explicitly set.

## Current worktree verification

- D1-compatible route tests cover accepted-submission/lock ordering, concurrent publication, Stop-versus-publication, stale assignment previews, stopped setup release, Hunter override handoff, and proposed-versus-published outcomes.
- The checked-in `npm run pilot:rehearsal` completed 10/10 assertions against the real local HTTP/D1 preview, including the reviewed Hunter follow-up, Seer history, Stop, Reset/session invalidation, and reset-then-reimport path.
- Migration tests cover fresh installation, rerun idempotence, existing initial-schema upgrade, the pilot-hardening columns, the reviewed-outcome column, and the `rate_limit_buckets` table. `drizzle-kit check` passes and unchanged generation reports no schema changes.
- `npm run db:generate` now uses a local launcher for Drizzle Kit's Windows `os.userInfo()` bootstrap edge case. On this host it reaches the schema and reports `No schema changes, nothing to migrate`; `npx drizzle-kit check` also passes.
- Local API rehearsal against fictional `.test` data passed 36 of 37 legacy checks; the sole non-pass was the intentionally configured scheduler-disabled check. The revised stopped-setup expectation is covered by the repository route tests, and no production data was touched.
- Executed checks in this worktree: `npm test -- --run` (73 tests), `npm run lint`, `npx tsc --noEmit --incremental false`, `npm run build`, and full/production dependency audits. Desktop visual inspection passed locally; 390x844/mobile visual inspection, a fresh hosted migration, and an enabled hosted scheduler remain operator gates.
- No deployment, real invitations, production mutation, or real credentials were used for this hardening pass.

## Resume instructions

1. Read this file and `git log -1 --stat`.
2. Inspect uncommitted changes with `git status --short`; preserve them if present.
3. Install dependencies only if `node_modules` is absent.
4. Continue with the first incomplete phase above.

## Architecture note

The historical Sites runtime used Cloudflare D1 and private realtime-style polling/broadcast patterns instead of the proposed Supabase/Vercel deployment. Product rules, security boundaries, audit requirements, and moderator-review workflow remain unchanged in the native Next.js/libSQL migration.
