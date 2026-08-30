# Watercooler Werewolf Build Status

This file is the restart point for future Codex sessions. Each completed phase is committed only after its build and tests pass.

## Current checkpoint

- Phase 0 — Sites scaffold and first meaningful player preview: **complete**
- Phase 1 — Domain model, game engine, persistence schema, and engine tests: **complete**
- Phase 2 — Authentication, roster, setup wizard, and role assignment: **complete**
- Phase 3 - Live player actions and moderator resolution workflow: **complete**
- Phase 4 - Private rooms, recap, backups, and operational controls: **complete**
- Phase 5 - Full verification, rehearsal fixtures, and private MVP hosting: **complete**
- Phase 6 - Pilot hardening, scheduling automation, rate limits, and feedback instrumentation: **in progress**

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
- CSV roster import validates 20–80 unique players and creates private hashed seat codes plus a one-time invite export.
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
- Forty-five unit tests across sixteen files, the full lint suite, and strict TypeScript checks pass.
- Production build succeeds.
- Default campaign dates are calculated relative to the next Monday; dates shown in planning documents are not treated as release constraints.
- A 20-player rehearsal roster, branded social preview, and favicon are included for the MVP handoff.
- The production dependency audit reports zero known vulnerabilities after upgrading Next.js to 16.3.3.
- Sites version 1 packages the verified build and D1 migration from commit `b0546ec98464700a3fc0454e6743284869f1754e`.
- The private MVP is deployed at `https://watercooler-werewolf.dylan-d-edgar.chatgpt.site` with owner-only access and the hosted origin applied to social metadata.
- The canonical protective role is now `BODYGUARD`; the migration rewrites legacy `DOCTOR` rows and new API/UI output never exposes Doctor as a separate role.
- Stop and owner-confirmed Reset controls are transactional, audited, backup-first, session-invalidating, game-isolated, and repeat-safe.
- Server-side phase policy requires Day first, Day/Night alternation, explicit post-cutoff Final Showdown, and Final Ballot-only play during showdown.
- Phase 6 pilot hardening now includes timezone-aware deadline conversion, D1-backed authentication/action/chat rate limits, due-phase reconciliation, late-attempt operational events, activity health metrics, and moderator feedback capture.
- Operations refreshes automatically after live mutations and by polling; the player mobile layout provides alternate section navigation while preserving the right rail content.
- Local API rehearsal verified fictional roster claim/release, phase rejection/idempotence, Stop/Reset/audit/backup/session invalidation, feedback capture, cross-game isolation, rate-limit behavior, and service-restart persistence. Browser automation was unavailable in this environment, so visual desktop/mobile checks remain pending.

## Resume instructions

1. Read this file and `git log -1 --stat`.
2. Inspect uncommitted changes with `git status --short`; preserve them if present.
3. Install dependencies only if `node_modules` is absent.
4. Continue with the first incomplete phase above.

## Architecture note

The Sites runtime uses Cloudflare D1 and private realtime-style polling/broadcast patterns instead of the proposed Supabase/Vercel deployment. Product rules, security boundaries, audit requirements, and moderator-review workflow remain unchanged.
