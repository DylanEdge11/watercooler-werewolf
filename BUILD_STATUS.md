# Watercooler Werewolf Build Status

This file is the restart point for future Codex sessions. Each completed phase is committed only after its build and tests pass.

## Current checkpoint

- Phase 0 — Sites scaffold and first meaningful player preview: **complete**
- Phase 1 — Domain model, game engine, persistence schema, and engine tests: **complete**
- Phase 2 — Authentication, roster, setup wizard, and role assignment: **complete**
- Phase 3 - Live player actions and moderator resolution workflow: **complete**
- Phase 4 - Private rooms, recap, backups, and operational controls: **complete**
- Phase 5 - Full verification, rehearsal fixtures, and hosting: **next**

## Verified at this checkpoint

- Official Sites scaffold created with D1 persistence binding.
- Responsive player dashboard renders at the local root route.
- Werewolf role, phase deadline, participation status, and two-slot ballot are represented.
- Ballot candidate selection is keyboard-accessible and capped at two choices.
- Local route responds successfully.
- Six-role catalog and agreed signed balance score are implemented.
- Default composition, unique-role constraints, Mason pairing, and one-in-six wolf baseline are tested.
- Day/night slot scaling is tested at 20, 30, 31, 40, 60, 61, and 80 living players.
- Day, night, Doctor, Seer, Hunter, random tie, and faction victory rules pass 16 unit tests.
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
- Twenty-eight unit tests and strict TypeScript checks pass.
- Production build succeeds.

## Resume instructions

1. Read this file and `git log -1 --stat`.
2. Inspect uncommitted changes with `git status --short`; preserve them if present.
3. Install dependencies only if `node_modules` is absent.
4. Continue with the first incomplete phase above.

## Architecture note

The Sites runtime uses Cloudflare D1 and private realtime-style polling/broadcast patterns instead of the proposed Supabase/Vercel deployment. Product rules, security boundaries, audit requirements, and moderator-review workflow remain unchanged.
