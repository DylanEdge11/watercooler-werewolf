---
name: werewolf-prod
description: Release a UAT-verified Watercooler Werewolf candidate by merging it to main through the normal PR flow and verifying the Vercel Production deployment. Never creates a Preview or runs Dev/UAT.
argument-hint: "[candidate branch or PR, plus UAT handoff]"
disable-model-invocation: true
---

# Watercooler Werewolf Production release

Use only when the user separately asks to release a specific, UAT-verified candidate. That request authorizes the release once the UAT evidence checks out. Do not perform Dev or UAT.

Project facts and safety rules are in `CLAUDE.md`. Vercel project `watercooler-werewolf`, team `dyl-edge`. Follow [Release a change](../../../docs/SETUP.md#release-a-change) and, if needed, [Roll back](../../../docs/SETUP.md#roll-back). The candidate is normally the version branch (`version-X.Y`), released through one pull request into `main`.

## Verify the UAT handoff

The handoff (in the request, the PR, or earlier conversation) must name the tested SHA, Preview URL and deployment ID, a passing `npm run verify:full` at that SHA, the hosted Playwright run ID with results, and known gaps. If anything is missing or belongs to another SHA, don't merge; ask for it or a new UAT run.

Fetch `origin/main` and the candidate. The candidate's remote SHA must equal the tested SHA. Opening the release PR runs the fast `Verify` job (about 5 minutes); it must be green. If the candidate changed, or `main` advanced in a way that changes the merge result, stop and ask for a new UAT run. Get the user to accept any known gaps (for example, Edge not run) before merging.

Preserve unrelated local edits; never reset, clean, force-push, or silently stash. Review the full candidate-to-`main` diff for `.env*`, credentials, database files, Playwright artifacts, or unrelated changes.

## Production migrations come first

If the candidate adds migrations, Production must be migrated **before** the merge deploys, or every API route fails until it is.

1. List the new migrations and their SQL. Confirm they're additive and work with the code on `main`. If not, stop and plan a staged release with the user.
2. Confirm a recent Production backup exists (`docs/OPERATIONS.md`).
3. Explain exactly what will run and get the user's explicit go-ahead for this migration. The release request alone is not enough.
4. The user runs `npm run db:migrate` with Production credentials, or provides an ignored credentials file for this step only. Never print the values or run bootstrap, seed, or pilot scripts against Production.
5. Confirm the command reports the database is current and anonymous `GET /api/games` on Production still returns 401.

An application rollback does not roll back the database.

## Merge and verify

Merge through a pull request into `main`. Never bypass branch protection, rewrite history, promote a Preview, or use `vercel deploy --prod`. If a human review or merge is required, prepare the PR and wait.

Wait for the Production deployment of the merge commit to reach `READY`. Then run read-only checks only: the landing page returns 200 HTML, `/player-login` loads, anonymous `GET /api/games` returns 401, and runtime logs show no new errors. Never point hosted Playwright or pilot scripts at Production.

If anything fails, report the domain, deployment ID, commit, state, and error evidence, and offer the rollback steps. Don't roll back or change Production data on your own.

## Completion report

```text
PROD: RELEASED            (or PROD: BLOCKED / FAILED — <reason>)
Candidate: <branch> @ <UAT-tested SHA>
UAT evidence: <Preview deployment ID, Playwright run ID, verify:full result>
Migrations: <none, or versions applied to Production and when>
Merge: <PR link, merge commit on main>
Production: <domain, deployment ID, READY>
Smoke checks: <each check and result>
Logs: <runtime errors observed or none>
Next: the owner creates the next version branch (`version-X.Y`) from `main`.
```

Never claim a check passed without observing it.
