---
name: werewolf-uat
description: Review an already published Watercooler Werewolf Vercel Preview candidate (exact SHA) and produce a UAT handoff. Never changes code, publishes, merges, or deploys Production.
argument-hint: "[branch, SHA, Preview URL, or Dev handoff]"
disable-model-invocation: true
---

# Watercooler Werewolf UAT

UAT phase only: review one specific, already published Preview deployment and produce a handoff. Do not change code, push, deploy, or merge; the user starts each phase separately. This skill targets Preview only.

Project facts and safety rules are in `CLAUDE.md`. Vercel project `watercooler-werewolf`, team `dyl-edge`. Read [the hosted Preview runbook](../../../docs/TESTING.md#hosted-preview-runbook) from the candidate checkout before running anything.

## Confirm the candidate

- The candidate is usually the version branch (`version-X.Y`) about to be released. Get the branch, full SHA, Preview URL, and deployment ID from the Dev handoff or the request.
- Work in a checkout at that exact SHA (`git rev-parse HEAD`). Never run tests from other code against the Preview.
- Confirm the remote branch still points to the SHA and the deployment is `READY`, target `preview`. Use the Vercel CLI, Vercel MCP tools, or the GitHub deployment status.
- If the candidate adds a migration (new entry in `db/readiness.ts` compared with `main`), anonymous `GET /api/games` on the Preview must return 401. A 5xx means it isn't migrated.

If anything is missing, stale, or unverifiable, stop with `UAT: BLOCKED` and say what's needed. Fixes belong to Dev.

## CI

Every `Verify` job (`verify`, `api`, `browser 1–4`) must be green for the exact SHA; cite the run. The `api` and `browser` jobs run only on pull requests into `main` or when started by hand. If they show as skipped, start the workflow by hand on the branch (`gh workflow run Verify --ref <branch>`, about 25–45 minutes) or cite a local run of those suites for the same SHA. Skipped is not green.

Do the hosted run while CI is in progress. If a job fails, report it and stop with `UAT: BLOCKED`. Don't run the full browser suite against the Preview as a substitute.

## Hosted Preview run

Run the four-step sequence from the runbook **once per candidate SHA**, with one `E2E_RUN_ID` and `--retries=0`. Follow its configuration and cloud-session notes. Also:

- Never print or paste values from `.env.e2e.local` or environment secrets, or the contents of Playwright reports and traces. Cite their paths.
- If the Vercel CLI preflight can't authenticate, stop before any test data is created. Don't edit or bypass the preflight.
- If Microsoft Edge isn't installed, skip only `02-edge-smoke` and record it as a gap.
- Run the full browser suite against the Preview only if the user asks.

Then review the changed flow in a browser at phone and desktop widths, checking console and network errors. Scroll long pages before judging images, because they load lazily. Use run-owned fictional games only. Report actual counts; never claim a pass you didn't see.

## Handoff

```text
UAT: READY FOR USER REVIEW            (or UAT: BLOCKED — <reason>)
Branch: <branch>
Tested commit: <full SHA>
Preview: <exact origin>
Vercel deployment: <deployment ID, READY, preview>
CI: <exact-SHA Verify run link; verify, api, and browser 1–4 results>
Playwright: <run ID; per-invocation pass/fail/skip counts; cloud-proxy retries, if any>
Browser review: <flows, widths, console/network result>
Artifacts: <report/trace paths>
Migrations: <none, or versions confirmed applied to Preview>
Known gaps and risks: <e.g. Edge not run>
```

Confirm Production was not touched. Stop.
