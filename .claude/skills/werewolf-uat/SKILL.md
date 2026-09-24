---
name: werewolf-uat
description: Review an already published Watercooler Werewolf Vercel Preview candidate (exact SHA) and produce a UAT handoff. Never changes code, publishes, merges, or deploys Production.
argument-hint: "[branch, SHA, Preview URL, or Dev handoff]"
disable-model-invocation: true
---

# Watercooler Werewolf UAT

Use this skill only for the UAT phase: review one specific, already published Preview deployment and produce a handoff. Do not perform Dev or Production work, push code, or deploy from this skill, even if the request mentions those phases; the user starts each phase separately.

## Project contract

- Work in the checkout at the exact candidate SHA (`git rev-parse HEAD` must match). Never run tests from a different checkout or SHA against the Preview.
- Git remote: `origin` (`DylanEdge11/watercooler-werewolf`). Production branch: `main`. Vercel project `watercooler-werewolf`, team `dyl-edge`.
- Node 24.x. Use the repository's scripts and `.github/workflows/ci.yml`.
- Read, from the candidate checkout: [the hosted Preview runbook](../../../docs/TESTING.md#hosted-preview-runbook), [the setup and deployment guide](../../../docs/SETUP.md), and `.github/workflows/ci.yml`. If one is missing at this SHA, report the gap instead of using another branch's copy.
- Preview and Production use separate Turso databases and environment variables. This skill only targets Preview.

## Confirm the candidate

Identify the branch, full SHA, Preview URL, and deployment ID from the Dev handoff or the request. Confirm the remote branch still points to that SHA and the deployment is `READY`, target `preview`, project `watercooler-werewolf`, team `dyl-edge`. Use the Vercel CLI, Vercel MCP tools, or the GitHub deployment status for the SHA, whichever is available.

If the SHA moved, the deployment is stale or not ready, handoff details are missing, or the target cannot be verified, stop and report exactly what is missing. Ask the user to run the Dev phase. Do not deploy or fix from UAT.

If the candidate adds a migration (a new entry in `db/readiness.ts` versus the base branch), confirm the Preview database has it applied. API routes verify the schema before authentication, so an anonymous `GET /api/games` returning 401 means the schema is current; a 5xx means a migration is missing. If it is missing, stop and hand back to Dev.

## CI gates

The `Verify` workflow runs on pushes to `main` and `version-1.1`, on pull requests, and by hand. Its `api` and `browser` jobs run only for pull requests into `main` or a manual run, so for other candidates they show as skipped: start the workflow by hand for the SHA, or cite a local run of those suites, rather than treating skipped as green. Its jobs are the fast gates (`verify`), the 20-player API suite (`api`), and the full 20-player Chromium browser suite split four ways (`browser (1/4)` to `browser (4/4)`), all against a disposable local server and database. UAT relies on these for depth, so **every job must be green for the exact SHA**. Cite the run.

- If the run is still in progress, do the candidate checks and the hosted sequence meanwhile, then confirm the result before the handoff. The run usually takes about 25 minutes.
- If a job failed, report the job and failing test with a link, and stop: `UAT: BLOCKED`. Fixes belong to Dev. Do not rerun the full browser suite against the Preview as a substitute.
- If no run exists for the SHA (for example, Actions is unavailable), run the fast gates once from the repo root and record the missing browser jobs as a gap:

```sh
npm test -- --run
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm audit --omit=dev --audit-level=moderate
```

Run `npm ci` only if dependencies are missing or the lockfile changed.

## Hosted Preview sequence

This checks that the deployed Preview, with its real Vercel functions and Turso database, works end to end. It takes about 5–10 minutes. Follow the runbook's safety rules. Run it **once per candidate SHA** with one unique `E2E_RUN_ID` and a distinct `E2E_INVOCATION_ID` per command. Use `--retries=0`.

| Invocation ID | Arguments after `node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote` |
| --- | --- |
| `01-chromium-smoke` | `--project=chromium --retries=0 e2e/readiness/browser-smoke.spec.ts` |
| `02-edge-smoke` | `--project=edge --retries=0 e2e/readiness/browser-smoke.spec.ts` |
| `03-api-suite` | `--project=api --retries=0` |
| `04-browser-uat` | `--project=chromium --retries=0 e2e/readiness/browser-uat.spec.ts e2e/readiness/browser-setup-navigation.spec.ts` |

`03-api-suite` plays full 20-player games, including privacy checks and concurrent submissions, against the Preview database. `04-browser-uat` plays one eight-player game from setup to a Village win through separate player browsers, with a mobile-width player and privacy checks, and then checks setup navigation.

In bash, for example:

```sh
RUN_ID="preview-qa-$(date +%Y%m%d-%H%M%S)"
E2E_RUN_ID=$RUN_ID E2E_INVOCATION_ID=01-chromium-smoke \
  node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote --project=chromium --retries=0 e2e/readiness/browser-smoke.spec.ts
```

Environment requirements and fallbacks:

- `.env.e2e.local` (ignored) holds the fictional moderator credentials, `VERCEL_AUTOMATION_BYPASS_SECRET`, and related values. Never print, paste, or commit its values. Supply the exact Preview origin as `E2E_BASE_URL` and the deployment ID as `E2E_VERCEL_DEPLOYMENT_ID`.
- In cloud sessions the same values are environment variables (`E2E_MODERATOR_EMAIL`, `E2E_MODERATOR_PASSWORD`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `VERCEL_TOKEN`) and there is no `.env.e2e.local`. Drop `--env-file=.env.e2e.local` from each command, because Node exits when that file is missing, and pass `E2E_BASE_URL` and `E2E_VERCEL_DEPLOYMENT_ID` inline. The session's network proxy occasionally fails a browser read on its own. Hosted browser runs re-send only those (GET/HEAD, gateway error without Vercel's `x-vercel-id`) and print a `[cloud-proxy] retrying` line for each. Report the count; a failure after retries is a real failure.
- Playwright reports and traces can contain request headers. Never paste them into chat or commits; cite their paths.
- The remote preflight shells out to `vercel inspect`, so the Vercel CLI must be installed and authenticated for `dyl-edge` (or `VERCEL_TOKEN` set). If it is not, stop before any mutation and report it. Do not bypass or edit the preflight.
- The Edge smoke needs the `msedge` channel. If Edge is not installed (typical on Linux or cloud containers), skip only that invocation and record "Edge smoke not run: msedge unavailable" as a known gap. Do not substitute another browser and label it Edge.
- Firefox and WebKit are optional unless the change or the user requires them.

Run the full browser suite (`--project=chromium --retries=0 e2e/readiness`) against the Preview only when the user asks. If the SHA changes, earlier results no longer count.

Also review the changed user-facing flow in a browser, including relevant mobile/desktop widths and console/network errors. Scroll long pages before judging images, because they load lazily. Keep all mutations on Preview with run-owned fictional games and accounts. Never point hosted Playwright, pilot scripts, reset, seed, or cleanup at Production, and never delete shared Preview data. Keep reports and traces under `playwright-report/<run-id>/` and `test-results/<run-id>/`. Report actual counts; never claim a pass you did not observe.

## UAT handoff and stop

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
Migrations: <none, or versions and confirmed applied to Preview>
Known gaps and risks: <e.g. Edge not run, optional browsers skipped>
```

Confirm Production was not touched. Stop. Do not merge, push `main`, promote, or start Production.
