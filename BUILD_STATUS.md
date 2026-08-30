# Watercooler Werewolf Build Status

This file is the restart point for future Codex sessions. Each completed phase is committed only after its build and tests pass.

## Current checkpoint

- Phase 0 — Sites scaffold and first meaningful player preview: **complete**
- Phase 1 — Domain model, game engine, persistence schema, and engine tests: **complete**
- Phase 2 — Authentication, roster, setup wizard, and role assignment: **next**
- Phase 3 — Live player actions and moderator resolution workflow: pending
- Phase 4 — Private rooms, recap, backups, and operational controls: pending
- Phase 5 — Full verification, rehearsal fixtures, and hosting: pending

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
- Production build succeeds.

## Resume instructions

1. Read this file and `git log -1 --stat`.
2. Inspect uncommitted changes with `git status --short`; preserve them if present.
3. Install dependencies only if `node_modules` is absent.
4. Continue with the first incomplete phase above.

## Architecture note

The Sites runtime uses Cloudflare D1 and private realtime-style polling/broadcast patterns instead of the proposed Supabase/Vercel deployment. Product rules, security boundaries, audit requirements, and moderator-review workflow remain unchanged.
