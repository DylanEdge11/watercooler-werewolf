---
name: werewolf-uat
description: Comprehensively review an already published Watercooler Werewolf Vercel Preview candidate (exact SHA) and produce a UAT handoff. Never changes code, publishes, merges, or deploys Production.
argument-hint: "[branch, SHA, Preview URL, or Dev handoff]"
disable-model-invocation: true
---

# Watercooler Werewolf UAT

Use this skill only for the UAT phase: comprehensively review one specific, already published Preview deployment and produce a handoff. Do not perform Dev or Production work, push code, or deploy from this skill, even if the request mentions those phases; the user starts each phase separately.

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

If the required `Verify` workflow is green for the exact SHA, cite that run and do not repeat it. Otherwise run the same gates once from the repo root:

```sh
npm test -- --run
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm audit --omit=dev --audit-level=moderate
```

Run `npm ci` only if dependencies are missing or the lockfile changed. If a required gate fails, report it and stop; fixes belong to Dev.

## Hosted Preview sequence

Follow the runbook's safety rules. Run the required sequence **once per candidate SHA** with one unique `E2E_RUN_ID` and a distinct `E2E_INVOCATION_ID` per command. Use `--retries=0`.

| Invocation ID | Arguments after `node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote` |
| --- | --- |
| `01-chromium-smoke` | `--project=chromium --retries=0 e2e/readiness/browser-smoke.spec.ts` |
| `02-edge-smoke` | `--project=edge --retries=0 e2e/readiness/browser-smoke.spec.ts` |
| `03-api-suite` | `--project=api --retries=0` |
| `04-readiness-suite` | `--project=chromium --retries=0 e2e/readiness` |
| `05-setup-navigation` | `--project=chromium --retries=0 e2e/readiness/browser-setup-navigation.spec.ts` |

In bash, for example:

```sh
RUN_ID="preview-qa-$(date +%Y%m%d-%H%M%S)"
E2E_RUN_ID=$RUN_ID E2E_INVOCATION_ID=01-chromium-smoke \
  node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote --project=chromium --retries=0 e2e/readiness/browser-smoke.spec.ts
```

Environment requirements and fallbacks:

- `.env.e2e.local` (ignored) holds the fictional moderator credentials, `VERCEL_AUTOMATION_BYPASS_SECRET`, and related values. Never print, paste, or commit its values. Supply the exact Preview origin as `E2E_BASE_URL` and the deployment ID as `E2E_VERCEL_DEPLOYMENT_ID`.
- The remote preflight shells out to `vercel inspect`, so the Vercel CLI must be installed and authenticated for `dyl-edge` (or `VERCEL_TOKEN` set). If it is not, stop before any mutation and report it. Do not bypass or edit the preflight.
- The Edge smoke needs the `msedge` channel. If Edge is not installed (typical on Linux or cloud containers), skip only that invocation and record "Edge smoke not run: msedge unavailable" as a known gap. Do not substitute another browser and label it Edge.
- Firefox and WebKit are optional unless the change or the user requires them.

Run a second full sequence with a fresh ID only when the change affects persistence, isolation, or rerun safety, or the user asks. If the SHA changes, earlier results no longer count.

Also review the changed user-facing flow in a browser, including relevant mobile/desktop widths and console/network errors. Keep all mutations on Preview with run-owned fictional games and accounts. Never point hosted Playwright, pilot scripts, reset, seed, or cleanup at Production, and never delete shared Preview data. Keep reports and traces under `playwright-report/<run-id>/` and `test-results/<run-id>/`. Report actual counts; never claim a pass you did not observe.

## UAT handoff and stop

```text
UAT: READY FOR USER REVIEW            (or UAT: BLOCKED — <reason>)
Branch: <branch>
Tested commit: <full SHA>
Preview: <exact origin>
Vercel deployment: <deployment ID, READY, preview>
CI: <exact-SHA run link, or local gate results>
Playwright: <run ID; per-invocation pass/fail/skip counts>
Browser review: <flows, widths, console/network result>
Artifacts: <report/trace paths>
Migrations: <none, or versions and confirmed applied to Preview>
Known gaps and risks: <e.g. Edge not run, optional browsers skipped>
```

Confirm Production was not touched. Stop. Do not merge, push `main`, promote, or start Production.
