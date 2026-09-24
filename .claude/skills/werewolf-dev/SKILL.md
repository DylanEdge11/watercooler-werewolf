---
name: werewolf-dev
description: Make a focused Watercooler Werewolf change, publish it to a Vercel Preview, and smoke-check the changed flow. Fast iteration only; not comprehensive UAT and never a Production release.
argument-hint: "[change description]"
disable-model-invocation: true
---

# Watercooler Werewolf Dev Preview

Use this skill only for the Dev phase: make a focused change, run the smallest useful checks, publish a Vercel Preview, and verify the changed flow quickly. Stop after the Preview handoff. Do not perform UAT or Production work, even if the request mentions those phases; the user starts each phase separately.

## Project contract

- Work in the checkout whose `package.json` is named `watercooler-werewolf` and is on the branch intended for this change. Do not edit a different checkout just because it is open.
- Git remote: `origin` (`DylanEdge11/watercooler-werewolf`). Production branch: `main`. Vercel project `watercooler-werewolf`, team `dyl-edge`.
- Node 24.x (`.nvmrc`, `engines: >=24`). Commands work in bash or PowerShell; use whichever shell the session provides.
- Preview and Production use separate Turso databases and Vercel environment variables. This skill touches Preview only. All Preview deployments share one Preview database.

## Make a focused change and quick checks

1. Inspect the branch, working tree, recent commits, and intended base. Preserve unrelated changes and untracked files. Never reset, clean, force-push, or silently stash.
2. Reuse the current feature branch when it is the right candidate. If the session assigns a branch, use it. Otherwise, for a substantial independent change, create a short descriptive branch from the requested base. Do not assume `main` when the user names another base (for example a `version-*` branch).
3. Run only the fastest relevant checks: lint the changed files, run the directly related Vitest file, or `npx tsc --noEmit --incremental false` when types changed. For docs-only changes, check the rendered Markdown and links instead of app tests. Let the Vercel build serve as the build check.
4. When fixing a bug, add or update one directly related test that would have caught it, if a natural test location exists. Do not otherwise expand coverage unless asked.
5. Skip the full unit suite, hosted Playwright sequence, cross-browser runs, and dependency audit on this fast path. Never bypass checks that branch protection requires; report any that are still running.
6. Stage only files for this change. Exclude `.env*`, credentials, database files, `work/`, `playwright-report/`, `test-results/`, build output, and unrelated edits. Commit with a clear message.

## Schema changes

Builds never run migrations, and every API route refuses to serve when the database is missing a migration listed in `db/readiness.ts`. If the change touches `db/schema.ts`:

1. Generate SQL with `npm run db:generate`, then register the new version in **both** `MIGRATION_FILES` (`scripts/db-migration-runner.mjs`) and `MIGRATION_VERSIONS` (`db/readiness.ts`). Run `lib/db/migrations.test.ts`.
2. Keep migrations additive and backward compatible: add tables or nullable/defaulted columns, and do not drop, rename, or tighten existing ones in the same release. Other Preview deployments and the current Production code must keep working against the migrated schema. If the change cannot be additive, stop and explain the plan to the user before continuing.
3. Before or immediately after pushing, apply the migration to the **Preview** database only:
   - Credentials come from the environment variables `PREVIEW_TURSO_DATABASE_URL` and `PREVIEW_TURSO_AUTH_TOKEN` (cloud sessions), or from an ignored file the user provided on their own machine (for example `.env.preview-db.local` with `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`). Never print or commit their values.
   - Confirm the database URL identifies the Preview database (for example it contains `watercooler-werewolf-preview`). If it names Production or you cannot tell, stop and ask.
   - Run `TURSO_DATABASE_URL="$PREVIEW_TURSO_DATABASE_URL" TURSO_AUTH_TOKEN="$PREVIEW_TURSO_AUTH_TOKEN" node scripts/db-migrate.mjs`, or `node --env-file=<preview-db-file> scripts/db-migrate.mjs` with a file. `scripts/load-env.mjs` also reads `.env` and `.env.local` for unset variables, so make sure both variables are set.
   - Afterwards, anonymous `GET /api/games` on the Preview should return 401 (the schema check runs before authentication; a 5xx means a migration is still missing).
   - If Preview credentials are unavailable, do not guess. Report that the Preview database still needs `npm run db:migrate` and that the smoke check will fail until then.
4. Never run migrations, bootstrap, or seed commands against Production from this skill.

## Publish and smoke-check Preview

Push the branch to `origin` so the Vercel Git integration builds a Preview. Never use `vercel deploy --prod`, merge to `main`, change domains, or promote a deployment.

Wait for the deployment for the exact pushed SHA to reach `READY`. Use whichever source is available: the Vercel CLI (`vercel inspect <url> --scope dyl-edge`), the Vercel MCP tools, or the GitHub commit status/deployment for that SHA. Confirm project, team, target `preview`, branch, SHA, and HTTPS URL. Do not reuse a URL from a different SHA. If no source can confirm the deployment, say so instead of assuming it is ready.

For UI or flow changes, do one short browser pass through the changed screen with Playwright or an available browser. Confirm it loads, the key interaction works, and there are no console errors or failed requests. Preview may be protected. Use the scoped `VERCEL_AUTOMATION_BYPASS_SECRET` from `.env.e2e.local` as the `x-vercel-protection-bypass` header without printing it. For non-UI changes, check only the changed surface. Use fictional or run-owned data only. If browser access, bypass secret, or a test account is unavailable, state what was not checked.

If the build or smoke check exposes a problem in the scoped change, fix it, publish the new SHA, and re-check that deployment. Do not escalate into full UAT.

## Dev handoff and stop

```text
DEV: PREVIEW READY FOR QUICK REVIEW
Branch: <branch>
Commit: <full SHA>
Preview: <exact URL>
Vercel deployment: <deployment ID, READY, preview>
Quick checks: <what ran and results>
Schema/migrations: <none, or version applied to Preview DB / still pending>
Browser smoke: <changed flow and result, or not run with reason>
CI: <status for this SHA, or pending>
Known gaps: <what this pass did not cover>
```

State that this is not UAT or Production approval, and that the candidate is ready for the separate UAT phase. Stop.
