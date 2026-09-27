# Watercooler Werewolf

Next.js App Router app on Vercel with a Turso/libSQL database. A slow-burn Werewolf game: players act from their own devices and a moderator publishes each result. The owner is the product manager and reviewer; explain changes in plain language.

## Commands

Node 24 (`.nvmrc`).

```sh
npm test                 # Vitest, lib/**/*.test.ts
npm run verify           # fast gates: tests, lint, types, build, audit. Run before every push.
npm run verify:full      # verify + 20-player API and browser suites. Once per release candidate.
```

For quick iteration, run only the relevant test file. Suites and the hosted Preview runbook are in `docs/TESTING.md`.

## Branches and releases

- `main` is Production. Vercel's Git integration builds a Preview for every pushed branch and deploys Production from `main`.
- The working base is always the one `version-X.Y` branch on origin (`git ls-remote --heads origin 'version-*'`), never `main`. A new one is created from `main` after each release.
- Each change is a `feat/` or `fix/` branch from the version branch, merged back through a pull request. The version branch reaches `main` through one release pull request. Only an urgent Production fix (`hotfix/`) branches from and merges into `main`.
- Changes reach `main` only through pull requests. Never push to `main`, never use `vercel deploy --prod`, and never promote a Preview deployment.
- The workflow is three user-invoked skills in `.claude/skills/`: `/werewolf-dev` (one change, through to a PR and Preview), `/werewolf-uat` (certify the version branch), and `/werewolf-prod` (release it). Each stops at its handoff. `/project-audit` is separate: an independent, report-only review of the whole repository, run whenever the owner asks.
- Audit reports are the one exception to the pull-request rule: `/project-audit` commits its report (`docs/AUDIT_<date>.md`, plus moving the previous audit into `docs/archive/`) directly to the version branch. Report files only, never code, and never `main`.
- GitHub Actions minutes are limited (2,000/month, spending limit $0). CI runs only the fast gates, only on pull requests into `main`. Checks run locally with `npm run verify` / `verify:full`. Don't add jobs or triggers to `.github/workflows`, or start the workflow by hand, without asking. Batch commits; don't push after every small fix.

## Safety rules

- Never point tests, pilot scripts, migrations, or the Vercel bypass secret at Production. Preview and Production have separate databases.
- Never print, paste, or commit secrets: `.env*` files, `VERCEL_*` tokens, `E2E_*` passwords, `PREVIEW_TURSO_*` credentials, invite CSVs, or recovery codes.
- Use fictional players with `.test` addresses in all test data.

## Code conventions

- Queries are hand-written SQL with bound parameters through `db/contracts.ts`. Multi-statement writes use `db.batch()`, which is one transaction. Re-check game state inside the write (`WHERE ... AND status = ...`) and treat zero changed rows as a 409 conflict.
- Every mutating route calls `assertSameOrigin`, then an authorization helper from `lib/auth/`, then validates state.
- Players must never receive another player's role or private results. `FORBIDDEN_PLAYER_KEYS` in `e2e/readiness/browser-fixture.ts` lists fields that must not reach a player.
- Game rules live in `lib/game/` and are unit-tested there; routes stay thin.
- Schema changes: edit `db/schema.ts`, run `npm run db:generate`, then add the new migration to both `scripts/db-migration-runner.mjs` and `db/readiness.ts`. Every API route fails until the target database is migrated, so keep migrations additive. See `docs/SETUP.md#schema-changes`.

## Docs

- `docs/SETUP.md`: install, deploy, release, schema changes, cloud-session setup.
- `docs/OPERATIONS.md`: moderator controls and recovery.
- `docs/TESTING.md`: CI gates, rehearsals, Playwright, the hosted Preview runbook, regenerating guide media.
- `docs/TECHNICAL.md`: architecture and rules as implemented.
- `app/guide/page.tsx`: the public player and moderator guide. Update it when a visible workflow changes.
- `docs/archive/`: historical records only. Do not follow them as instructions.
