# Watercooler Werewolf

## Overview

Watercooler Werewolf is a slow-burn Werewolf game for a workplace: players act from their own phones or desktops over days, and a moderator publishes each result.

## Role

You are the developer on this repository. The owner is the product manager and reviewer: explain every change in plain language, lead with what players and moderators will notice, and ask before deciding a game rule or player-facing wording.

## Tech stack

- `Next.js` 16 App Router, `React` 19, `TypeScript`, `Tailwind CSS` 4.
- `Turso` / `libSQL` database through `@libsql/client`; schema in `drizzle-orm`, migrations generated with `drizzle-kit`.
- Hosted on `Vercel`. Node 24 (`.nvmrc`).
- Tests: `Vitest` for unit and integration tests, `Playwright` for API and browser suites.

## Architecture and directory layout

```text
app/            Next.js pages and components; app/api/ holds the route handlers
app/guide/      the public player and moderator guide (page.tsx)
lib/game/       game rules and engine, unit-tested next to each file
lib/auth/       authorization helpers every mutating route calls
lib/            other server modules (chat, email, notify, roster, backup, http) and API integration tests
db/             schema.ts, contracts.ts (all SQL), readiness.ts (required migrations)
drizzle/        generated SQL migrations
scripts/        migration runner, Playwright runner, pilot and setup scripts
e2e/            Playwright API suites; e2e/readiness/ holds the browser suites
docs/           setup, operations, testing, and technical reference
```

`docs/TECHNICAL.md` describes the rules and data flow as implemented.

## Terminology

- **Production**: the live site, deployed from `main`, with its own database.
- **Preview**: the `Vercel` deployment built for every pushed branch; it uses the separate Preview database.
- **Version branch**: the one `version-X.Y` branch on origin that collects the next release.
- **Release candidate**: the version branch at one SHA, certified by `/werewolf-uat`.
- **Moderator**: the person running a game; runs the phases and publishes each result, or lets automation publish it.
- **Private result**: anything only one player may see, such as their role or a night action outcome.

## Commands and testing

- `npm test`: `Vitest` unit and integration tests (`lib/**/*.test.ts`). While iterating, run only the relevant file with `npx vitest run <path>`.
- `npm run verify`: the fast gates (tests, lint, types, build, dependency audit). Run it before every push.
- `npm run verify:full`: `npm run verify` plus the 20-player API and browser suites. Run it once per release candidate.

The suites and the hosted Preview runbook are in `docs/TESTING.md`.

## Workflow

1. Find the working base: the one `version-X.Y` branch on origin (`git ls-remote --heads origin 'version-*'`). A new one is created from `main` after each release.
2. Create a `feat/` or `fix/` branch from the version branch and merge it back through a pull request. An urgent Production fix uses a `hotfix/` branch from `main` instead, merged into `main`.
3. Release the version branch to `main` through one release pull request. `Vercel` builds a Preview for every pushed branch and deploys Production from `main`.
4. Follow the three user-invoked skills in `.claude/skills/`: `/werewolf-dev` (one change, through to a PR and Preview), `/werewolf-uat` (certify the version branch), and `/werewolf-prod` (release it). Each stops at its handoff.
5. Run the checks locally (see Commands and testing). `GitHub` Actions minutes are limited (2,000/month, spending limit $0), so CI runs only the fast gates, only on pull requests into `main`. Batch commits and push once a change is ready. *Ask before adding jobs or triggers to `.github/workflows` or starting the workflow by hand.*

Changes reach `main` only through pull requests. *Never base work on `main`, never push to `main`, never use `vercel deploy --prod`, and never promote a Preview deployment.*

## Security and data boundaries

- Point tests, pilot scripts, and the `Vercel` bypass secret at the Preview only, because Preview and Production have separate databases. *Never aim them at Production.* Migrations follow the same rule, with one exception that belongs to the owner: during `/werewolf-prod` the owner runs `npm run db:migrate` against Production. *Claude never runs a migration, or any script, against Production.*
- Keep secrets out of output and commits: `.env*` files, `VERCEL_*` tokens, `E2E_*` passwords, `PREVIEW_TURSO_*` credentials, invite CSVs, and recovery codes. *Never print, paste, or commit them.*
- Use fictional players with `.test` addresses in all test data.

## Code conventions

- Write queries as hand-written SQL with bound parameters through `db/contracts.ts`. Multi-statement writes use `db.batch()`, which is one transaction. Re-check game state inside the write (`WHERE ... AND status = ...`) and treat zero changed rows as a 409 conflict.
- Every mutating route calls `assertSameOrigin`, then an authorization helper from `lib/auth/`, then validates state.
- Check every new player-facing response field against `FORBIDDEN_PLAYER_KEYS` in `e2e/readiness/browser-fixture.ts`, which lists fields that must not reach a player. *A player must never receive another player's role or private results.*
- Put game rules in `lib/game/` with unit tests there; routes stay thin.
- In `app/`, import `lib/` and `db/` modules with the `@/` shortcut, and send browser requests through `lib/http/client.ts` instead of a hand-written `fetch`.
- For schema changes, edit `db/schema.ts`, run `npm run db:generate`, then add the new migration to both `scripts/db-migration-runner.mjs` and `db/readiness.ts`. Every API route fails until the target database is migrated, so keep migrations additive. See `docs/SETUP.md#schema-changes`.

## MCP tools

The skills use the `Vercel` MCP tools (deployments, logs) and the `GitHub` MCP tools (pull requests, branches) when a session has them; the `vercel` and `gh` CLIs are the fallback.

## Output format

- Handoffs: use the fenced `text` template at the end of each skill in `.claude/skills/`, filled with real results only.
- Replies to the owner: plain language, what changed for players and moderators first, then evidence (tests run, `npm run verify` result, links).
- Pull requests: what and why, how it was tested, doc changes, migrations, and open decisions.

## Docs

- `docs/SETUP.md`: install, deploy, release, schema changes, cloud-session setup.
- `docs/OPERATIONS.md`: moderator controls and recovery.
- `docs/TESTING.md`: CI gates, rehearsals, `Playwright`, the hosted Preview runbook, regenerating guide media, measuring size and speed.
- `docs/TECHNICAL.md`: architecture and rules as implemented.
- `app/guide/page.tsx`: the public player and moderator guide. Update it when a visible workflow changes.
- `docs/archive/`: historical records only. *Do not follow them as instructions.* Move a finished audit or report there once its findings are closed.

Keep the docs short enough for a new developer to read. Give each fact one home and link to it from the other docs instead of copying it. Describe how the code works now, without change history ("previously", "now"), lists of test files, or one-off measurements.
