# Watercooler Werewolf

Next.js App Router app on Vercel with a Turso/libSQL database. A slow-burn Werewolf game: players act from their own devices and a moderator publishes each result. The owner is the product manager and reviewer; explain changes in plain language.

## Commands

Node 24 (`.nvmrc`). These are the CI gates in `.github/workflows/ci.yml`:

```sh
npm test -- --run                       # Vitest, lib/**/*.test.ts
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm audit --omit=dev --audit-level=moderate
```

For quick iteration, run only the relevant test file. Browser and API suites are in `docs/TESTING.md`.

## Branches and releases

- `main` is Production. Vercel's Git integration builds a Preview for every pushed branch and deploys Production from `main`.
- The owner names the working base (currently `version-1.1`); do not assume `main`.
- Changes reach `main` through pull requests. Never push to `main`, never use `vercel deploy --prod`, and never promote a Preview deployment.
- The release phases are the user-invoked skills `/werewolf-dev`, `/werewolf-uat`, and `/werewolf-prod` in `.claude/skills/`. Each phase stops at its handoff.
- GitHub Actions minutes are limited (2,000/month). Don't add or expand jobs in .github/workflows without asking. Run the 20-player API and browser suites locally or in-session, not in Actions. Batch commits; don't push after every small fix.

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
