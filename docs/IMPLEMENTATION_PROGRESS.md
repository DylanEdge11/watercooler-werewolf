# Implementation progress

Updated 2026-09-19.

## Completed

- Added shared 6–80 roster limits and staged small-game presets while preserving the exact 20-player default.
- Added focused unit, route, lifecycle, assignment, backup/restore, and small-count victory coverage.
- Added moderator game selection, new-setup navigation, draft preservation across polling, and atomic persisted setup cancellation with invite/session invalidation and audit history.
- Added remote Playwright mode with deployment metadata/preflight checks, exact-origin mutation headers, scoped Vercel protection headers, run-scoped artifacts, and one worker.
- Updated the environment example and pilot documentation with placeholders and the 20-player E2E fixture policy.
- Focused Vitest: 6 files, 54 tests passed.
- Full Vitest: 26 files, 105 tests passed.
- TypeScript: `npx tsc --noEmit --incremental false` passed.
- Lint: passed with two existing unused-variable warnings in the readiness harness.
- Final production build: passed with Next.js 16.3.3; the first sandboxed attempt hit a Windows cache EPERM and the unchanged retry passed.
- Local setup-navigation Playwright regression: 1 passed.
- Local API Playwright suite: 6 passed, all existing multiplayer scenarios remained at 20 players.
- Initial local Chromium readiness attempt exposed and fixed duplicate sibling React keys in the new game-scoped moderator panels; the focused 20-player onboarding rerun passed 1/1.
- Clean local Chromium readiness before final Preview qualification: 14/14 passed in 16.2 minutes with one worker and no retries, including the setup-navigation regression, privacy/Hunter regressions, concurrent player reload coverage, and browser seeds 7/21/42.

## Preview qualification

- Git base revision deployed from the current working tree: `2762d562c958d60d4565bc5aa9e3768b4b832e14` (working tree intentionally uncommitted).
- Preview deployment: `dpl_BU6dMkHvU1cUFou477j2bBX184hC`, target `preview`, status `READY`.
- Preview origin: `https://watercooler-werewolf-21kmzkv1j-dyl-edge.vercel.app`.
- Vercel build/runtime used Node 22.x. Local verification used Node 24.20.0 because Node 22 was not installed on the workstation.
- Preview bootstrap is provisioned and `/api/games` still requires application moderator authentication.
- Preview and Production `TURSO_DATABASE_URL` values were compared by SHA-256 prefix (`34594aa341715b37` versus `ac038503eb9779ab`); they are distinct.
- Read-only Vercel deployment logs show a successful Node 22.x build/deployment; final hosted requests produced no inspected application runtime exceptions.

## Final verification

- Full Vitest: 26 files, 105 tests passed.
- TypeScript: `npx tsc --noEmit --incremental false` passed.
- Lint: passed with two non-fatal existing unused-variable warnings in the readiness harness.
- Final production build: passed.
- Local setup-navigation Playwright: 1 passed.
- Local API Playwright: 6 passed; existing multiplayer scenarios remain at 20 players.
- Local Chromium readiness: 14/14 passed in 15.4 minutes, one worker, no retries, on the exact final source.
- Final local API Playwright rerun: 6 passed; existing multiplayer scenarios remain at 20 players.
- Final focused local setup/smoke rerun: 2 passed.

## Hosted status

- Remote preflight passed against `dpl_BU6dMkHvU1cUFou477j2bBX184hC` for every hosted invocation.
- Hosted API coverage: 6/6 passed; all existing multiplayer scenarios remained at 20 players.
- Hosted Chromium readiness: 14/14 passed in 1.3 hours, one worker, retries disabled.
- Hosted Edge smoke: 1/1 passed in 2.2 seconds; Chrome/Chromium and Edge are the required desktop-browser coverage.
- Hosted WebKit smoke: passed. Firefox smoke was blocked before application testing by Windows `browserType.launch: spawn UNKNOWN`; WSL/Linux was not installed.
- Second hosted persistent-data invocation: setup navigation and smoke passed 2/2 with a new run ID.
- Final remote-runner smoke after Windows Vercel CLI invocation hardening: 1/1 passed without shell-spawn warnings.
- No production URL was opened for mutation. Preview mutations used only run-owned fictional games/accounts; no shared data was deleted.
- Hosted artifacts, first-attempt findings, and exact commands are recorded in `docs/PLAYWRIGHT_HOSTED_QA_REPORT.md` and `docs/PLAYWRIGHT_HOSTED_RUNBOOK.md`.
- The one-game manual handoff is recorded in `docs/FULL_GAME_TEST_HANDOFF.md`; it requires one complete six-player game and does not repeat the completed suite.
