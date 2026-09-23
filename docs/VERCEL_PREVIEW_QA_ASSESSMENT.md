# Vercel preview and player-test QA assessment

Date: September 19, 2026  
Source reviewed: `639363d` (`Add browser readiness Playwright suite`)  
Scope: readiness assessment, source inspection, fresh local unit/integration checks, and read-only hosted checks. Application behavior and deployments were not changed. No hosted games were created, reset, or played.

## Decision

**Not ready for the requested six-player test or an unmodified hosted Playwright run.** The app still requires 20 players, the Playwright harness assumes a disposable local environment, and the supplied “preview” URL is actually the same production deployment as the production domain.

The existing work provides a useful foundation: native Next.js/libSQL deployment is configured, hosted bootstrap checks succeed, application authentication rejects anonymous API access, and the local test suite passes. The required work is targeted, not a platform rewrite.

## 1. Live deployment findings

Read-only Vercel CLI verification on September 19 established:

| Address | Actual Vercel target | Deployment | Result |
| --- | --- | --- | --- |
| `https://watercooler-werewolf-2y66x2ph4-dyl-edge.vercel.app/` — supplied as preview | **Production** | `dpl_CqePUFNGRZ3zosFASiLmcvz7FQ46` | Ready |
| `https://watercooler-werewolf.vercel.app/` — supplied as production | **Production** | **Same deployment** | Ready |
| `https://watercooler-werewolf-a0oxuxxn7-dyl-edge.vercel.app/` — discovered through Preview listing | **Preview** | `dpl_AZ4TthEa2Bzie2vdrkvZjQLpLY2U` | Ready |

A generated Vercel deployment hostname does not establish environment isolation. The first two addresses serve the same deployment and its configured database connection. Do not point the mutating test suite at the supplied production deployment as if it were staging.

GitHub verification: the remote repository's [migration record, line 157](https://github.com/DylanEdge11/watercooler-werewolf/blob/639363de1b562a916d8d2a6ea6ba4e5e5c7a983d/MIGRATION_PROGRESS.md#L157) identifies `watercooler-werewolf-a0oxuxxn7-dyl-edge.vercel.app` as Preview, matching the live Vercel classification. GitHub's `main` points to `639363de1b562a916d8d2a6ea6ba4e5e5c7a983d`; its commit-status response contains no statuses, and the two repository PR discussions contain no Vercel preview announcement. The GitHub connector does not support the deployments endpoint, so no claim is made about the contents of that API collection. The URL is verified through the checked-in GitHub record and Vercel's live deployment API via CLI.

- The project uses Next.js, Node `22.x`, root `.`, install `npm ci`, and build `npm run build`. Run deployment commands from `project/`, where the app and `.vercel/project.json` reside.
- Preview currently lists `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `WATERCOOLER_OWNER_EMAIL`. It does not list a custom `SITE_ORIGIN` or `CRON_SECRET`.
- Production currently lists those three variables plus `SITE_ORIGIN`. This supersedes the older migration note saying Production has no variables. Variable values were not downloaded or exposed.
- Both inspected deployments return HTTP 200 with `needsBootstrap: false` from `/api/moderators/bootstrap` when accessed through the authenticated Vercel CLI.
- The genuine Preview returns application HTTP 401 for anonymous `/api/player`; the supplied production deployment returns application HTTP 401 for anonymous `/api/games` after deployment protection is passed.
- A normal unauthenticated request to the supplied generated URL returns HTTP 302 to Vercel SSO. The genuine Preview also returned HTTP 302 without deployment access. A player invitation alone does not grant Vercel access.
- Both deployments date to September 16. Local commit `639363d`, dated September 18, includes changes to `app/api/player/route.ts` as well as the browser tests. Deployment metadata returned no commit SHA. The reviewed fixes cannot be signed off as deployed from these checks; deploy and record an exact reviewed revision before hosted acceptance testing.
- Separate Preview and Production environment scopes exist, but distinct database destinations have **not** been verified. A new preview URL alone does not create a separate database.

## 2. Reduce the app minimum to six; retain 20-player Playwright scenarios

Interpretation: games may start with 6–80 participants, while the existing multiplayer Playwright scenarios continue to create and exercise 20 participants. The deployed app should use the same rules for humans and automation; no Playwright-specific server minimum or `NODE_ENV` switch is needed. Player count here means roster participants, excluding the moderator.

Four backend checks currently prevent six-player support:

| Location | Current behavior | Required change |
| --- | --- | --- |
| `lib/roster/csv.ts:68` | Rejects rosters below 20 or above 80 | Accept 6–80 valid, unique entries |
| `lib/game/balance.ts:29` | `defaultComposition(6)` throws | Accept six and define a suitable small-game default |
| `app/api/games/[gameId]/assignments/route.ts:118` | All assignment actions require a 20–80 roster | Apply the same 6–80 limits |
| `lib/backup/restore.ts:68` | Rejects backups with fewer than 20 active seats | Accept six-player backups while preserving removed-seat filtering |

Use shared application constants such as `MIN_PLAYERS = 6` and `MAX_PLAYERS = 80` in these four paths. Update the moderator range copy at `app/moderator/page.tsx:331`, relevant errors, and player-facing setup documentation. A separate six-player manual fixture would simplify the player rehearsal; retain the existing 20-player fixture and E2E defaults.

**Small-game role composition needs deliberate treatment.** Simply lowering the guard leaves six players with one Werewolf, one Seer, one Bodyguard, one Hunter, two Masons, and no Villagers. That sums correctly but the existing balance function rates it `STRONG_VILLAGE` (score 3, normalized 0.5). A reasonable initial six-player preset for evaluation is one Werewolf and five Villagers, which scores zero under the existing heuristic. This is a proposed preset, not a proven gameplay balance result. Define the behavior for 7–19 players as well, while preserving the exact existing 20-player default.

Preserve the E2E baseline:

- Keep both the API bot farm and browser readiness scenarios at 20 players, including 20 isolated contexts and the existing role distributions.
- Centralize an E2E-only `E2E_PLAYER_COUNT = 20` and assert generated/imported roster counts. Do not lower the existing 20-player assertions to make six-player support pass.
- Existing smoke tests have no player roster; they are not multiplayer scenarios.
- Add six-player boundary coverage at unit/API level and conduct the six-person manual rehearsal. This respects the requested 20-player multiplayer Playwright baseline.

Acceptance checks: reject five and 81; accept six, 19, 20, and 80; import, claim, assign, and release all six seats; execute Day/Night and both winner conditions; preserve one elimination slot at six living players; export/restore a six-player setup; verify the unchanged 20-player API/browser scenarios still pass. No database schema change appears necessary for the limit itself.

## 3. Make Playwright portable to a real Preview

| Gap | Evidence | Required implementation |
| --- | --- | --- |
| Local server always starts | `scripts/run-playwright.mjs:71`; unconditional `webServer` in `playwright.config.ts:41` | Add an explicit remote mode/config. Skip local Next startup, local bootstrap, and disposable-file lifecycle entirely in remote mode. Keep the current local workflow intact. |
| URL override is incomplete | `e2e/constants.ts:3` reads `E2E_BASE_URL`, but runner still spawns locally and its readiness request lacks deployment access | Normalize to the exact HTTPS origin, reject paths/credentials, and perform a bounded remote readiness check using remote request options. Verify Vercel target is Preview; hostname shape alone is insufficient. |
| Hard-coded moderator login | `e2e/constants.ts:4–5` | Read dedicated test-account credentials from the runner environment; require them remotely and retain fictional defaults locally. An `E2E_MODERATOR_*` override currently affects local bootstrap but not these test constants. Bootstrap a fresh test database once through the operator tooling; do not add a public test backdoor. |
| Missing production-required Origin | `lib/http/security.ts:17–30`; direct posts in `e2e/bot-farm.ts` and `e2e/readiness/browser-fixture.ts:180` | Supply `Origin: new URL(E2E_BASE_URL).origin` on programmatic mutation requests. Local test mode permits omission; Vercel rejects it. Ordinary same-origin browser form/fetch traffic already supplies Origin. Preserve the security check. |
| Missing deployment-protection access | Every manual `newContext({ baseURL: BASE_URL })` | Supply the automation bypass through a secret environment variable and same-origin request/context configuration. Include moderator, all players, duplicate-claim context, smoke contexts, API contexts, and remote preflight. Setting only Playwright `use.extraHTTPHeaders` is insufficient for these explicitly constructed contexts. |
| Persistent shared data | Fixtures dispose contexts, not hosted games; first onboarding scenario expects no games | Use an isolated automated-QA database and deliberate run lifecycle. Fix game creation/selection, run with one worker, and give games a run ID. Define cleanup only for that disposable environment or exact run-owned data. Keep the human pilot separate from bot runs. |
| Origin and invite URL consistency | `SITE_ORIGIN` is exact-match when configured; claim links derive from the request origin | Choose a canonical Preview origin for the run. Verify browser Origin, programmatic Origin, invite URLs, redirects, and cookie host agree. The missing Preview `SITE_ORIGIN` is not itself a proven outage: code falls back to the request URL origin. A mismatched configured value does block mutations. |
| CI has no E2E job | `.github/workflows/ci.yml` runs unit/lint/type/build/audit only | Add a job after a Ready Preview deployment, use the Node 24.x LTS baseline, install Playwright browsers/dependencies, pass the exact deployment URL and secrets, and retain restricted QA artifacts. The package engine accepts `>=24`. |
| Reruns consume real rate-limit buckets | Moderator login allows 5 attempts per email/client per 15 minutes | Reuse sessions within a run; account for retries and worker restarts. Use a dedicated account and clean isolated fixture lifecycle rather than disabling production rate limiting. |
| Missing remote evidence | Existing suites use development Next + file-backed SQLite | Verify production cookies, remote libSQL writes/concurrency, polling, private chat, reconnects, and persistence across new sessions/redeployment on the actual Preview. |

Existing `scripts/pilot-setup.mjs` and `scripts/controlled-rehearsal.mjs` already implement remote URL opt-in, explicit Origin, environment-based credentials, and `VERCEL_AUTOMATION_BYPASS_SECRET` headers. Reuse those established patterns; they do not automatically configure Playwright.

Vercel documents `x-vercel-protection-bypass` for automation and an optional bypass cookie for subsequent browser requests. Keep the app's moderator/player authentication active. Treat traces containing headers or rendered private game information as restricted artifacts. [Vercel automation bypass documentation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).

For CI, Vercel provides a deployment-status workflow pattern for starting E2E after a successful Preview deployment. The current workflow needs that hosted stage and artifact collection. [Vercel Preview E2E guidance](https://vercel.com/kb/guide/how-can-i-run-end-to-end-tests-after-my-vercel-preview-deployment).

For the human pilot, verify access from a browser that is not signed into the owner's Vercel account and provide suitable deployment access separately from private seat links. Do not distribute the automation secret as the player access mechanism.

Scheduling requires an explicit pilot procedure. `vercel.json` defines no cron, and `CRON_SECRET` is absent from the listed environments. Keep moderator deadline reconciliation available, or configure an authenticated external Preview scheduler if unattended timing is required. Vercel's normal cron invocations target Production, so adding a cron entry alone does not test Preview scheduling. The old scheduler-variable mismatch is fixed: both code and `.env.example` now use `CRON_SECRET`. [Vercel cron documentation](https://vercel.com/docs/cron-jobs).

## 4. Outstanding local findings and hosted-test impact

“Source-confirmed” below means the problematic code remains; it is not a claim that this assessment replayed the scenario against Vercel.

| Priority / status | Finding | Impact and acceptance requirement |
| --- | --- | --- |
| P1 — live-confirmed | Supplied preview is the production deployment | Establish the genuine Preview target and database isolation before automated mutations. Both supplied domains resolve to the same deployment ID. |
| P1 — verified delivery gap | September 18 player privacy/Hunter fixes are not verified on the September 16 deployments | Deploy a reviewed revision and rerun both browser regressions remotely before real players. Do not infer a hosted pass from a local pass. |
| P1 for this requested pilot — source and direct probe | Minimum remains 20, including restore | Complete all four limit changes and six-player boundary checks. |
| P1 for hosted suite — source-confirmed | Remote harness lacks local/remote separation, Origin, credentials, bypass propagation, and persistent-fixture handling | Implement the remote mode before attempting full Playwright. |
| P2 — R5 remains | Moderator console hides creation when any game exists and has no visible game selector (`app/moderator/page.tsx:349`) | Blocks normal second-game setup and repeat onboarding tests. Add new-game and game-selection controls; scope drafts, invites, and operations to selected game. Test two games and reload. Ordering tests only masked the limitation locally. |
| P2 — R6 remains | Ten-second polling overwrites unsaved role composition (`app/moderator/page.tsx:117,159`) | Particularly relevant while adjusting small-game roles. Separate saved state from dirty draft; verify edits survive at least 15 seconds and save correctly. |
| P2 — R3 remains | Reset sets all seats to `INVITED`, including archived `REMOVED` seats (`app/api/games/[gameId]/operations/route.ts:210`) | Rehearsal resets can resurrect historical seats and invalidate counts/backups. Preserve archived status and verify replacement → Reset → restore. Avoid treating Reset as safe automatic hosted test cleanup. |
| P2 — R4 remains | Chat checks authorization before an unconditional message insert (`app/api/rooms/[roomId]/messages/route.ts:66`) | An in-flight message can cross Stop, room-lock, or membership-change boundaries. Revalidate authorization in the write and audit only successful inserts; add interleaving coverage. |
| Test-host blocker | Firefox `spawn UNKNOWN` / side-by-side configuration failure | Blocks Firefox evidence on this Windows host, not Vercel deployment. Run Firefox on a working host, preferably Linux CI. |
| Coverage gap | Local reload convergence was serialized after `ECONNRESET` | Passing local runs do not establish simultaneous hosted reload capacity. Add a controlled 20-player reconnect/reload burst and inspect errors/latency. Action barriers remain concurrent. |
| Coverage gap | One fresh local database per invocation, not per scenario | Hosted state persists; ordering and retries can reveal shared-state failures. Require two consecutive hosted invocations on the chosen isolation strategy. |
| Coverage gap | Long-running hosting, chat delivery, remote restart/persistence, and serverless error review were not established by local Playwright | Exercise these on the actual hosted build; record deployment ID, runtime errors, and outcomes. |

R1 (private Night timeline data) and R2 (reviewed Hunter permissions) are fixed in current source at `app/api/player/route.ts:193` and `:67`, respectively, and have named browser regression tests. The September 18 report records those tests passing. They remain **hosted verification gates**, not open local defects.

The three old race failures in `review/race-results.json` are historical. Current `lib/api-races.test.ts` checks submissions crossing lock, competing publications, and publication after Stop; these passed in the fresh unit/integration run. Do not carry the old failures forward as current failures without reproducing them.

## 5. Evidence and recommended acceptance order

Fresh checks in this assessment:

- `npm test -- --run`: **85 tests passed in 26 files**, using local Node `24.20.0`. This evidence predates the current Node `>=24` support declaration and is not a substitute for CI on its Node 24.x baseline.
- Direct calls to `parseRosterCsv`: five, six, 19, and 81 rejected; 20 and 80 accepted. `defaultComposition(6)` throws. `calculateEliminationSlots(6, 30)` returns one.
- The direct TypeScript probe initially hit the Windows `tsx` user-info restriction, then succeeded using the same process-local `geteuid` shim already used by `scripts/playwright-server.mjs`. No application source was changed for it.
- Vercel deployment/environment metadata and the limited HTTP results listed above were checked live. Application login, mutations, gameplay, database isolation, and hosted browser behavior were not tested in this assessment.

Historical evidence, not rerun here: September 18 readiness report records API E2E **6/6**, Chromium **13/13 in each of three runs with no retries**, WebKit smoke **1/1**, and Firefox launch failure. The retained last-run artifact is failed and its error identifies the Firefox launch failure. It does not negate the separately recorded Chromium runs.

Recommended order:

1. Establish a true Preview deployment and verified isolated QA database; record the source revision/deployment ID and intended origin.
2. Implement the 6–80 application limits, explicit small-game presets, matching backup validation, and unit/API boundary checks while retaining 20-player E2E fixtures.
3. Fix new-game/game-selection and role-draft preservation; resolve the Reset/chat defects before relying on those workflows in a pilot.
4. Add remote Playwright mode, dedicated credentials, Origin and bypass handling across every context, and persistent-fixture isolation.
5. Deploy the reviewed source to Preview, run migration readiness checks, and confirm the test moderator exists. Migrations/bootstrap are explicit operator tasks, not request-time or build-time seeding.
6. Run hosted smoke, API 20-player scenarios, full Chromium readiness/regressions/random seeds, and Firefox/WebKit smoke on Node 24.x LTS. Require no unexplained failures; passing retries do not erase first-attempt failures. Use trace retention that still captures evidence when running with `--retries=0` (current `on-first-retry` does not).
7. Repeat the hosted run, then verify simultaneous reconnects, chat/privacy, deadline handling, persistent state, and logs.
8. Conduct a separate six-person manual rehearsal using ordinary player access: claim, sign-in again, role release, Day/Night, elimination/read-only, completion, and moderator recovery procedure. Keep automated bot runs out of this live pilot dataset.

Only after these gates should the result be described as ready for the requested player test.
