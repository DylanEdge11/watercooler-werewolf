---
name: werewolf-prod
description: Release a UAT-verified Watercooler Werewolf candidate by merging it to main through the normal PR flow and verifying the Vercel Production deployment. Never creates a Preview or runs Dev/UAT.
argument-hint: "[candidate branch or PR, plus UAT handoff]"
disable-model-invocation: true
---

# Watercooler Werewolf Production release

Use this skill only when the user separately asks to release a specific, already UAT-verified candidate. That request is the release authorization once the UAT evidence checks out. Do not perform Dev or UAT from this skill, even if the request mentions them.

## Project contract

- Work in the `watercooler-werewolf` checkout and confirm the repository and branch before merging.
- Git remote: `origin` (`DylanEdge11/watercooler-werewolf`). Production branch: `main`; verify it is still Vercel's Production Branch. Vercel project `watercooler-werewolf`, team `dyl-edge`.
- Read [the Vercel setup guide](../../../VERCEL_SETUP_GUIDE.md) for Production configuration, migrations, and rollback. Its first-time-setup step using `vercel deploy --prod` does not apply to routine releases.
- Preview and Production use separate Turso databases and environment variables. Production is built fresh from `main`; never promote a Preview deployment.

## Verify the UAT handoff

Find the handoff in the request, the PR, or earlier conversation. It must name the exact tested SHA, Preview URL and deployment ID, passing CI, the hosted Playwright run ID with results, and known gaps. If anything is missing, unclear, or belongs to another SHA, do not merge; ask for the handoff or a new UAT run.

Fetch `origin/main` and the candidate. Confirm the candidate's remote SHA equals the tested SHA and CI is still green. If the candidate changed, or `main` advanced in a way that changes the merge result, stop and ask for a new UAT run. Surface any known gaps from the handoff (for example, Edge smoke not run) and confirm the user accepts them before merging.

Preserve unrelated local edits. Never reset, clean, force-push, or silently stash. Review the full candidate-to-`main` diff and make sure no `.env*`, credentials, database files, Playwright artifacts, or unrelated changes are included.

## Production migrations come first

Every API route refuses to serve if the database lacks a migration listed in `db/readiness.ts`. So if the candidate adds migrations, the Production database must be migrated **before** the merge deploys, or Production goes down between the deploy and the migration.

1. List the new migration versions and their SQL. Confirm they are additive and compatible with the code currently on `main`. If not, stop and discuss a staged plan with the user.
2. Confirm a recent Production backup or snapshot exists, per the setup guide and `docs/OPERATIONS.md`.
3. Explain exactly what will run and get the user's explicit go-ahead for this specific Production migration. The release authorization alone is not enough.
4. Running it needs Production database credentials that you should not hold. Either the user runs `npm run db:migrate` with Production credentials, or they provide an ignored credentials file for this step only. Never print the values, and never run bootstrap, seed, or pilot scripts against Production.
5. Confirm the migration completed before merging: the command reports the database is current, and anonymous `GET /api/games` on the Production domain still returns 401 (routes check the schema before authentication, so a 5xx means trouble).

Database state is not rolled back by an application rollback.

## Merge and deploy

Merge through the repository's pull request process into `main`. Do not bypass branch protection or rewrite shared history. If policy requires a human review or merge, prepare the PR and wait.

Let the Vercel Git integration build `main` for Production. Do not use `vercel deploy --prod` unless the user explicitly asks and the Git flow is unavailable.

Wait for the Production deployment to reach `READY` (Vercel CLI, Vercel MCP tools, or GitHub deployment status). Confirm its commit is the merge result. Then run read-only smoke checks only: the landing page returns 200 HTML, `/player-login` loads, anonymous `GET /api/games` returns 401, and runtime logs show no new errors. The hosted Playwright runbook is Preview-only; never point it or any pilot mutation at Production.

If deployment or smoke checks fail, report the domain, deployment ID, commit, state, and error evidence. Do not roll back or change Production data automatically; offer the rollback steps from the setup guide and ask how to proceed.

## Completion report

```text
PROD: RELEASED            (or PROD: BLOCKED / FAILED — <reason>)
Candidate: <branch> @ <UAT-tested SHA>
UAT evidence: <Preview deployment ID, Playwright run ID, CI link>
Migrations: <none, or versions applied to Production and when>
Merge: <PR link, merge commit on main>
Production: <domain, deployment ID, READY>
Smoke checks: <each check and result>
Logs: <runtime errors observed or none>
```

Keep UAT verification, merge, and Production verification clearly separate. Never claim a check passed without observing it.
