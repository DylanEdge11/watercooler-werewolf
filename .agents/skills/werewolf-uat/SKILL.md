---
name: werewolf-uat
description: Comprehensively review an already published Watercooler Werewolf Vercel Preview candidate and produce a UAT handoff. Does not create or publish a branch, merge to main, or deploy Production.
---

# Watercooler Werewolf UAT

Use this skill only for the UAT phase: comprehensively review a specific, already published Preview deployment and produce a handoff. This is a standalone workflow. Do not invoke or perform Dev or Production, push code, or deploy from this skill, even if the user mentions those phases in the same request. The user calls each phase separately.

## Project contract

- Resolve the Git worktree that contains the exact UAT candidate SHA before running commands. In this workspace `project/` is the default app root, but use the matching candidate worktree when it is checked out elsewhere; never test a different worktree's files against the Preview deployment.
- Git remote: `origin` (`DylanEdge11/watercooler-werewolf`). The production branch is `main`; use the appropriate development base for each candidate.
- Vercel project: `watercooler-werewolf`, team scope: `dyl-edge`.
- Use Node 24.x LTS, the verified baseline; the package supports Node.js `>=24`. Use the repository's existing scripts and CI workflow.
- Read [the hosted Preview Playwright runbook](../../../docs/PLAYWRIGHT_HOSTED_RUNBOOK.md), [the Vercel setup guide](../../../VERCEL_SETUP_GUIDE.md), and `.github/workflows/ci.yml` as needed.
- Resolve those references from the exact candidate checkout. If a referenced file is missing, locate the version that belongs to the candidate SHA or stop and report the gap; do not silently use stale instructions from another branch.
- Preview and Production use separate Turso databases and Vercel environment variables. This skill only targets Preview.

## Confirm the Dev handoff and Preview candidate

Identify the candidate branch, exact commit SHA, Preview URL, and deployment ID from the Dev handoff or user's request. Confirm that the current candidate still points to that SHA and that its Vercel deployment is `READY`, targets `preview`, and belongs to project `watercooler-werewolf` under team `dyl-edge`. Verify Preview database/configuration isolation before any test mutations.

If the SHA changed, deployment is stale/not ready, required handoff details are missing, or Preview protection/configuration cannot be verified, stop and report the precise gap. Ask the user to run the separate Dev phase to publish the intended SHA. Do not deploy or repair the candidate from UAT.

Check CI for the exact candidate SHA. If the repository's required CI workflow is green for that SHA, use that evidence and do not repeat the same full local gates. If exact-SHA CI is unavailable or did not run, run the required gates declared by `.github/workflows/ci.yml` once from the app root:

```powershell
npm test -- --run
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm audit --omit=dev --audit-level=moderate
```

Do not run `npm ci` unless dependencies are missing or the lockfile changed. If required CI is failing, report it and stop; application fixes and publishing belong to the separate Dev phase.

## Comprehensive Preview review

Follow [the hosted Preview Playwright runbook](../../../docs/PLAYWRIGHT_HOSTED_RUNBOOK.md) for remote runner and safety checks. Run the comprehensive hosted sequence **once per candidate SHA** with a unique `E2E_RUN_ID`: Chromium smoke, Edge smoke, API scenarios, the full Chromium readiness directory (including seeded randomized scenarios), and the standalone setup-navigation regression. Do not run a second full sequence by default, even if the general runbook text suggests repeating it. A fresh-ID repeatability run is required only when the change affects persistence, isolation, or rerun safety, or when the user explicitly requests it. If the candidate SHA changes, the previous results no longer qualify; request a new Dev Preview and review that SHA.

Use `.env.e2e.local` for fictional moderator credentials and any scoped Vercel deployment-protection bypass. It is ignored and may contain secrets: never print, paste, or commit its values. Supply the exact current Preview origin, deployment ID, and unique run ID. Use `node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote ...` as shown in the runbook. The remote preflight must confirm project `watercooler-werewolf`, target `preview`, state `READY`, and the expected deployment ID before test mutations.

Also inspect the changed user-facing Preview flow in a browser, including relevant responsive states and console/network errors. Keep test mutations on Preview and use fictional/run-owned games and accounts. Never point hosted Playwright, pilot mutations, reset, seed, or cleanup commands at Production. Do not delete shared Preview data. Keep reports, traces, screenshots, and test results as evidence. Do not claim a test passed without its result; report actual counts and artifact paths. Firefox and WebKit remain optional unless the changed surface or user request requires them.

## UAT handoff and stop

Once the exact-SHA CI checks and the single required hosted sequence pass, provide a copyable handoff with:

```text
UAT: READY FOR USER REVIEW
Branch: <candidate branch>
Tested commit: <full SHA>
Preview: <exact origin>
Vercel deployment: <deployment ID, READY, preview>
CI: <run/link for exact SHA, or local fallback gates and results>
Playwright: <one run ID, projects/specs, pass/fail counts>
Browser review: <changed flows, responsive check, console/network result>
Artifacts: <report/trace paths>
Database migrations or notable risks: <none or details>
```

Confirm that Production was not changed. Stop after the handoff. Do not merge, push `main`, promote a deployment, or transition into Production. The user will decide whether to start that phase in a separate request.
