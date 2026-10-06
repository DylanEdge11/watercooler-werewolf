---
name: werewolf-prod
description: Release a UAT-certified Watercooler Werewolf version branch (or a hotfix) to Production — migrations first, one release PR into main, deployment and read-only checks — then open the next version branch. Never runs Dev or UAT.
argument-hint: "[version branch or hotfix PR; UAT handoff if not in this conversation]"
disable-model-invocation: true
---

# Watercooler Werewolf: Production release

Run this skill only when the owner asks to release; that request authorizes the release once the `/werewolf-uat` evidence checks out. Production changes affect real players, so check every step and stop on anything unexpected. The project facts and safety rules are in `CLAUDE.md`; [Release a change](../../../docs/SETUP.md#release-a-change) and [Roll back](../../../docs/SETUP.md#roll-back) in `docs/SETUP.md` are the reference.

## 1. Candidate check

- Find the UAT handoff (this conversation, the PR, or ask the owner for it). It must say `UAT: READY TO RELEASE` and name the SHA, Preview deployment, `verify:full` result, and hosted run. If anything is missing, stop and ask for `/werewolf-uat`.
- Run `git fetch` and confirm the version branch's remote SHA equals the certified SHA. If it moved, or `main` gained commits the candidate doesn't have, stop: UAT must run again.
- Read the handoff's known gaps and risks back to the owner and get an explicit OK before continuing.
- Hotfix: a `hotfix/*` PR into `main` needs `npm run verify:full` passing at its SHA and a Preview check of the fix. Skipping the full UAT needs the owner's OK.

## 2. Production migration (only if the release adds migrations)

Every API route refuses to serve until the database has every migration in `db/readiness.ts`, so migrate the database first and release the code second.

1. List each new migration and its SQL in plain language. Confirm it's additive and that the code on `main` works with it. If not, stop and plan a staged release with the owner.
2. Confirm a recent Production backup exists (see `docs/OPERATIONS.md`).
3. Explain exactly what will run, and get the owner's explicit go-ahead for this specific migration; the release request alone is not enough.
4. Have the owner run `npm run db:migrate` with Production credentials (the script prints its target and asks the owner to type the Production host name), or use an ignored credentials file the owner provides for this step only. *Never print the values, and never run bootstrap, seed, or pilot scripts against Production.*
5. Confirm it reports the database is current and anonymous `GET /api/games` on Production still returns 401.

## 3. Release PR

1. Open one PR from the version branch into `main`, titled `Release version X.Y`. Body: the UAT release notes, the evidence summary, migrations, and accepted gaps.
2. Wait for the fast `Verify` job on it (about 5 minutes) to pass. If `GitHub` Actions can't run (for example, the monthly minutes are used up), tell the owner; with the owner's OK, rely on the UAT `verify:full` result for the same SHA.
3. Merge the PR with a merge commit, and let `Vercel` deploy Production from `main`. *Never bypass branch protection, rewrite history, promote a Preview, or use `vercel deploy --prod`.*

## 4. Production verification

1. Wait for the Production deployment of the merge commit to reach `READY` (Vercel MCP tools or `vercel ls --prod`).
2. Run read-only checks on the production domain: the landing page, `/player-login`, `/guide`, and `/moderator` return 200; anonymous `/api/games` returns 401; the `Vercel` runtime logs show no new errors. *Never point Playwright, pilot scripts, or test data at Production.*
3. If a check in step 2 fails, report the deployment ID, commit, and evidence to the owner, and offer the rollback steps from `docs/SETUP.md`. *Don't roll back or change data on your own.*

## 5. Next version branch

1. Ask the owner for the next version number, suggesting the next minor version (for example `version-1.3` after `version-1.2`).
2. Create it from the new `main` and push it. `GitHub` deletes the released branch automatically; confirm `git ls-remote --heads origin 'version-*'` shows only the new one.
3. After a hotfix: merge `main` into the current version branch instead, so the fix isn't lost at the next release.

## 6. Report

Fill in this template with results you saw:

```text
PROD: RELEASED            (or PROD: BLOCKED / FAILED — <reason>)
Released: <version branch> @ <SHA> via <PR link>, merge <SHA>
Production: <domain>, <deployment ID>, READY
Checks: <each check and result>
Migrations: <none, or versions applied and when>
Next version branch: <name>, created from <SHA>
```

*Never claim a check passed without seeing it.*
