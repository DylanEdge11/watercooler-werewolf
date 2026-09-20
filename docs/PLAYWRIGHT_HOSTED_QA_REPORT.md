# Preview QA report

Updated 2026-09-19. This report distinguishes local evidence from hosted evidence.

## Scope and source

- Repository: `DylanEdge11/watercooler-werewolf`
- Git base revision: `2762d562c958d60d4565bc5aa9e3768b4b832e14`
- Vercel deployed the current uncommitted working tree based on that revision; no commit was created. The pre-existing user edit to `docs/VERCEL_PREVIEW_QA_ASSESSMENT.md` was preserved.
- Local runtime: Node `v24.20.0`, npm `11.19.0`.
- Vercel build/runtime: Node `22.x` / `nodejs22.x`.
- Application build: Next.js `16.3.3`.

## Preview identity and isolation

Deployment was created with `vercel deploy --yes` (no `--prod`).

| Check | Evidence |
| --- | --- |
| Preview URL | `https://watercooler-werewolf-21kmzkv1j-dyl-edge.vercel.app` |
| Deployment ID | `dpl_BU6dMkHvU1cUFou477j2bBX184hC` |
| Project / target | `watercooler-werewolf` / `preview` |
| Ready state | `READY` from `vercel inspect --json` |
| Moderator bootstrap | `/api/moderators/bootstrap` returned `ok: true`, `needsBootstrap: false` through authenticated Vercel CLI access |
| Application auth | `/api/games` returned JSON HTTP 401 without moderator authentication |
| Database isolation | Preview and Production `TURSO_DATABASE_URL` SHA-256 prefixes were `34594aa341715b37` and `ac038503eb9779ab`; distinct |

No production URL was used for mutation. Hosted mutations used the dedicated fictional moderator account from the ignored local secret file and run-scoped fictional player accounts/games only. No shared data was deleted or reset.

The read-only `vercel inspect <preview> --logs` check showed a successful Node 22.x build and deployment. The final post-run inspection showed no application runtime exception in the returned logs.

Preview has no `SITE_ORIGIN` override in its environment. Invite URLs are generated from the request origin, while the remote runner normalizes `E2E_BASE_URL` to the exact Preview origin and sends that same origin on programmatic requests; local runs inject their disposable local origin.

## Implementation checks

| Command | Result |
| --- | --- |
| `npm test -- --run` | 26 files, 105 tests passed |
| `npx tsc --noEmit --incremental false` | Passed |
| `npm run lint` | Passed; 2 non-fatal unused-variable warnings in `e2e/readiness/browser-fixture.ts:674` and `e2e/readiness/browser-readiness.spec.ts:2` |
| `npm run build` | Passed |
| `node scripts/run-playwright.mjs --project=chromium --retries=0 e2e/readiness/browser-setup-navigation.spec.ts e2e/readiness/browser-smoke.spec.ts` | 2 passed in the final local rerun |
| `node scripts/run-playwright.mjs --project=api --retries=0` | 6 passed in the final rerun; existing multiplayer cases stayed at 20 players |
| `node scripts/run-playwright.mjs --project=chromium --retries=0 e2e/readiness` | 14/14 passed in the final rerun, one worker, no retries, 15.4 minutes |
| `git diff --check` | Passed; Git reported only normal LF/CRLF conversion warnings |

The final local Chromium run covered onboarding, isolated sessions, privacy, Day/Night actions, revisions, locking/publication, ties, protection, Hunter follow-up, elimination/read-only behavior, completion, randomized seeds 7/21/42, browser smoke, concurrent player reload/reconnect coverage, and setup navigation.

## First-attempt failure and correction

The first full local Chromium run was 1/14 passed and 13/14 failed after approximately 6.2 minutes. The first failures reported duplicate React sibling keys for the game-scoped Live Game and Operations panels; subsequent moderator-login failures were cascading setup failures. The panels were given distinct keys, then the focused onboarding test passed 1/1 and the clean full run passed 14/14. This was fixed before deployment.

Local artifacts from the final exact-source run are retained at `playwright-report/local-21328-1789849829387` and the corresponding `test-results/local-21328-1789849829387` directory.

After the owner-only cancellation-control polish, one focused setup attempt timed out because the SQL response alias was `moderator_role` while the UI model expected `moderatorRole`. The alias was corrected, the focused setup test passed 1/1, and the complete 14-test readiness rerun then passed.

## Hosted execution

The remote runner was exercised with `node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote ...`. It performed the bounded Preview metadata/HTTP preflight, did not start a local server or database, used one worker, disabled retries, scoped artifacts by `E2E_RUN_ID`, and applied the protection bypass to every explicit browser/API context. Programmatic requests used the exact same-origin `Origin` header.

Hosted results against the Preview above:

| Invocation | Result |
| --- | --- |
| Browser smoke, Chromium | 1 passed after the harness classified Vercel's platform-owned JWE probe |
| Existing API suite | 6/6 passed in 2.4 minutes; all multiplayer cases remained at 20 players |
| Focused 20-player Chromium onboarding rerun | 1/1 passed in 1.3 minutes |
| Full Chromium readiness | 14/14 passed in 1.3 hours; one worker, retries 0; includes privacy, Hunter, elimination/read-only, concurrent reload/reconnect, setup navigation, smoke, and seeds 7/21/42 |
| Edge smoke | 1/1 passed in 2.2 seconds in run `preview-qa-20260919-l` |
| WebKit smoke | 1 passed in 1.7 seconds |
| Firefox smoke | Optional only; not application-tested because launch failed before any page request with Windows `browserType.launch: spawn UNKNOWN` |
| Second persistent-data invocation | 2/2 passed in 6.8 seconds: setup navigation/restart and browser smoke, new run ID |
| Final remote-runner smoke after Windows CLI invocation hardening | 1/1 passed in 1.5 seconds; no shell-spawn deprecation warning |

All hosted invocations passed the deployment preflight and reported deployment `dpl_BU6dMkHvU1cUFou477j2bBX184hC`, target `preview`, state `READY`. Remote retries were disabled; no test was retried.

### Hosted first-attempt findings and corrections

1. The first hosted smoke run caught two failed requests to Vercel's platform-owned `/.well-known/vercel/jwe` endpoint. The telemetry filter now allows only that exact platform probe while retaining strict application-origin GET/POST failures, page errors, console errors, navigation errors, and 5xx checks.
2. The first full readiness attempt found that the UI fixture assumed an empty setup form although the preceding API run left an active selected game in the persistent Preview database. The fixture now clicks the visible `Start new setup` control before UI setup when persisted games are present.
3. A subsequent 20-player run exposed canceled same-origin `HEAD` probes and `OPTIONS /` during protected multi-context navigation. The browser transport now keeps the Vercel bypass header on browser contexts but applies `Origin` explicitly to programmatic API requests; telemetry allows only those exact protected navigation probes. The focused rerun and final 14-test Chromium suite then passed.
4. Firefox remains optional and a host runner limitation: `spawn UNKNOWN` occurred at browser launch before application testing. WSL is not installed on this workstation, so the requested Linux fallback was unavailable. Firefox is excluded from required acceptance; WebKit remains optional Safari coverage.

### Hosted artifacts and logs

Retained run-scoped artifacts are under:

- `test-results/preview-qa-20260919-h` and `playwright-report/preview-qa-20260919-h` — final 14/14 Chromium readiness.
- `test-results/preview-qa-20260919-i` — Firefox/WebKit smoke, including the pre-application Firefox launch failure and WebKit pass.
- `test-results/preview-qa-20260919-j` and `playwright-report/preview-qa-20260919-j` — second persistent-data invocation, 2/2 passed.
- `test-results/preview-qa-20260919-k` and `playwright-report/preview-qa-20260919-k` — final hardened-runner smoke, 1/1 passed.
- `test-results/preview-qa-20260919-l` and `playwright-report/preview-qa-20260919-l` — required Edge smoke, 1/1 passed in 2.2 seconds.
- Earlier failed attempts remain under run IDs `c`, `d`, `e`, and `f`; corrected focused run `g` is retained as well.

The final read-only `vercel inspect <preview> --logs` showed a successful Node 22.x build/deployment and `status Ready`; no application runtime exception appeared in the inspected output. Vercel reported four moderate install-time audit findings and package deprecation notices; no dependency upgrade was made.

The six-person application feature is ready for a run-owned manual player test on the Preview. The hosted multiplayer fixture intentionally remains 20 players; six-player behavior is covered by the focused local unit/route/lifecycle/assignment/backup tests. Required browser acceptance is Chromium/Chrome plus Edge smoke; WebKit/Safari is optional and Firefox is not required.
