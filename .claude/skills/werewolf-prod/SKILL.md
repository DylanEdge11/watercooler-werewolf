---
name: werewolf-prod
description: Release a UAT-certified Watercooler Werewolf version branch (or a hotfix) to Production — migrations first, one release PR into main, deployment and read-only checks — then open the next version branch. Never runs Dev or UAT.
argument-hint: "[version branch or hotfix PR; UAT handoff if not in this conversation]"
disable-model-invocation: true
---

# Watercooler Werewolf: Production release

Use only when the owner asks to release. That request authorizes the release once the UAT evidence checks out. Production changes affect real players, so check everything and stop on anything unexpected. `CLAUDE.md` holds the project facts and safety rules; [Release a change](../../../docs/SETUP.md#release-a-change) and [Roll back](../../../docs/SETUP.md#roll-back) are the reference.

## 1. Confirm the candidate is the one UAT certified

- Find the UAT handoff (this conversation, the PR, or ask for it). It must say `UAT: READY TO RELEASE` and name the SHA, Preview deployment, `verify:full` result, and hosted run. If anything is missing, stop and ask for `/werewolf-uat`.
- `git fetch`. The version branch's remote SHA must equal the certified SHA. If it moved, or `main` gained commits the candidate doesn't have, stop: UAT must run again.
- Read the handoff's known gaps and risks back to the owner and get an explicit OK before continuing.
- **Hotfix:** a `hotfix/*` PR into `main` needs `npm run verify:full` passing at its SHA and a Preview check of the fix. The full UAT isn't required, but get the owner's OK for that.

## 2. Migrate Production first (only if the release adds migrations)

Every API route refuses to serve until the database has every migration in `db/readiness.ts`. So the database goes first, and the code follows.

1. List each new migration and its SQL in plain language. Confirm it's additive and that the code on `main` works with it. If not, stop and plan a staged release with the owner.
2. Confirm a recent Production backup exists (`docs/OPERATIONS.md`).
3. Explain exactly what will run, and get the owner's explicit go-ahead for this specific migration. The release request alone is not enough.
4. The owner runs `npm run db:migrate` with Production credentials, or provides an ignored credentials file for this step only. Never print the values; never run bootstrap, seed, or pilot scripts against Production.
5. Confirm it reports the database is current and anonymous `GET /api/games` on Production still returns 401.

## 3. Release PR

1. Open one PR from the version branch into `main`, titled `Release version X.Y`. Body: the UAT release notes, the evidence summary, migrations, and accepted gaps.
2. The fast `Verify` job runs on it (about 5 minutes) and must pass. If GitHub Actions can't run (for example, the monthly minutes are used up), say so. With the owner's OK, rely on the UAT `verify:full` result for the same SHA.
3. Merge with a merge commit. Never bypass branch protection, rewrite history, promote a Preview, or use `vercel deploy --prod`.

## 4. Verify Production

1. Wait for the Production deployment of the merge commit to reach `READY` (Vercel MCP tools or `vercel ls --prod`).
2. Read-only checks on the production domain: the landing page, `/player-login`, `/guide`, and `/moderator` return 200; anonymous `/api/games` returns 401; the runtime logs show no new errors. Never point Playwright, pilot scripts, or test data at Production.
3. If anything fails, report the deployment ID, commit, and evidence, and offer the rollback steps. Don't roll back or change data on your own.

## 5. Open the next version

1. Ask the owner for the next version number, suggesting the next minor version (for example `version-1.3` after `version-1.2`).
2. Create it from the new `main` and push it. GitHub deletes the released branch automatically; confirm `git ls-remote --heads origin 'version-*'` shows only the new one.
3. **After a hotfix:** merge `main` into the current version branch instead, so the fix isn't lost at the next release.

## 6. Report

```text
PROD: RELEASED            (or PROD: BLOCKED / FAILED — <reason>)
Released: <version branch> @ <SHA> via <PR link>, merge <SHA>
Production: <domain>, <deployment ID>, READY
Checks: <each check and result>
Migrations: <none, or versions applied and when>
Next version branch: <name>, created from <SHA>
```

Never claim a check passed without seeing it.
