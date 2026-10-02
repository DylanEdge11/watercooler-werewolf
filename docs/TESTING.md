# Testing

How to verify a change, from fast unit tests to a full hosted Preview run. Use fictional players and `.test` email addresses only. **Never point a test, pilot script, or bypass secret at Production.**

## Release checks

The checks run locally, because GitHub Actions minutes are limited (2,000 a month):

| Command | What it runs | When |
| --- | --- | --- |
| `npm run verify` | The fast gates: unit tests, lint, type check, production build, and the production dependency audit. A few minutes. | Before every push. |
| `npm run verify:full` | `verify`, then the 20-player API suite, then the full 20-player Chromium browser suite, one game at a time. About 20 minutes; run it in the background. | Once per release candidate, during UAT. |

The API and browser suites use a disposable local server and database, so they need no secrets and never touch a Preview. Each 20-player browser game may run for up to 20 minutes.

The `Verify` workflow in `.github/workflows/ci.yml` runs only the fast gates, and only on pull requests into `main`. Starting it by hand from the Actions tab also runs the API suite and the browser suite split across four machines. That costs about 100 minutes, so do it only when a local run isn't possible.

A candidate is ready for release when `npm run verify:full` has passed on its exact commit and the [hosted Preview run](#hosted-preview-runbook) has passed against its Preview deployment. Earlier results do not carry over to a new commit.

## Unit tests

`npm test` runs Vitest over `lib/**/*.test.ts`: the game engine, action rules, scheduling, balance, CSV import, auth, rate limits, migrations, backup and restore, and race conditions in the API routes, using an in-memory libSQL database. Village stats are covered by `lib/game/game-stats.test.ts` (the counting rules, including timezones) and `lib/api-stats.test.ts` (the routes: open ballots excluded, privacy, access, reset, chat counts). Player email is covered by `lib/api-email-notifications.test.ts` (recipients, once-only reminders, privacy of the wording, failures, the AI story with a mocked SDK) and the unit tests in `lib/notify/`; none of them send mail or call Claude.

## Rehearse a game

With a local server running (see [Setup](SETUP.md#run-locally)), open a second shell and use the same fictional moderator credentials you bootstrapped:

```powershell
$env:PILOT_ALLOW_MUTATION = 'yes'
$env:PILOT_MODERATOR_EMAIL = 'owner@example.test'
$env:PILOT_MODERATOR_PASSWORD = '<fictional password, 12+ characters>'
npm run pilot:setup       # creates a 20-player game from fixtures/roster-20.csv
npm run pilot:rehearsal   # scripted HTTP run of claim, review, privacy, and recovery paths
```

`pilot:setup` writes a private invite CSV under `outputs/`. For a Preview, also set `PILOT_BASE_URL` and `PILOT_ALLOW_REMOTE=yes`, plus `VERCEL_AUTOMATION_BYPASS_SECRET` if the Preview is protected.

For a manual rehearsal, give the moderator and each player a separate browser profile (private windows in one browser share cookies), then play at least one Day and one Night with the Hunter, a tie, an override, room moderation, and a backup.

## Local Playwright suites

All local suites start a disposable Next server on `http://localhost:3100` with a fresh SQLite database, bootstrap a fictional moderator, and delete the database afterward. They run one worker at a time. Each local moderator sign-in in the browser suites sends its own private client address, so a failed test's retries can't use up the moderator sign-in allowance (5 per 15 minutes) and fail the tests after it. Hosted runs keep the real limit.

| Command | What it covers |
| --- | --- |
| `npm run test:e2e` | **API bot farm.** 20 players, each in its own request context: full Village and Werewolf wins, revisions, ties, protection, late and eliminated submissions, privacy boundaries, and concurrent submissions. |
| `npm run test:e2e:random` | Bot farm with seeded random decisions (seeds 7, 21, 42). |
| `npm run test:e2e:readiness` | **Browser suite.** 20 real browser sessions in Chromium through the full game, including privacy at the page and API level, mobile width, keyboard use, reloads, and console or network errors. Adds a smoke test in WebKit (Safari's engine). |
| `npm run test:e2e:readiness:random` | Browser suite with seeds 7, 21, and 42. |
| `npm run test:e2e:uat` | **UAT browser game.** One eight-player game from setup to a Village win in separate browser sessions, including a mobile-width player, privacy checks, and the Village stats tab and console panel. This is the game the hosted Preview run plays. |
| `node scripts/run-playwright.mjs --project=stress` | **Load test.** A 20-player baseline game, then two 80-player games at the same time, every role, each to a Werewolf win, with privacy checks after every phase. Times every request and writes the numbers to `work/stress/stress-<run-id>.json`. About 3 minutes. Not part of `verify:full`; run it after a change that could affect speed and compare with an earlier run. |

Reports go to `playwright-report/<run-id>/<invocation-id>/`, and traces, screenshots, and videos to `test-results/`. Open a report with `npx playwright show-report <path>`. These artifacts can show roles, so keep them private.

## Hosted Preview runbook

Use this to verify a specific Preview deployment. The runner refuses anything that is not HTTPS, not a `READY` Preview of project `watercooler-werewolf`, or not the expected deployment ID. It checks this before creating any data.

### Configure

Put the values that don't change between runs in the ignored file `.env.e2e.local`, never in Git or chat:

```text
E2E_MODERATOR_EMAIL=<fictional Preview moderator, a .test address>
E2E_MODERATOR_PASSWORD=<12+ characters>
VERCEL_AUTOMATION_BYPASS_SECRET=<Preview protection bypass>
```

The test moderator is a normal account on the Preview database. To create one, sign in to any Preview as a moderator, open a game you own, and add a co-moderator under **Co-moderator access** with a `.test` email and a 12+ character password. Keep its recovery codes with the password.

The preflight calls `vercel inspect`, so the Vercel CLI must be installed and signed in to `dyl-edge` (`vercel whoami`), or `VERCEL_TOKEN` must be set.

Each run also needs the exact Preview origin and deployment ID, which change with every commit. Pass them inline as `E2E_BASE_URL` and `E2E_VERCEL_DEPLOYMENT_ID` rather than editing the file.

In a Claude Code cloud session, all of these are environment variables set in the environment's settings (plus `VERCEL_TOKEN`), and there is no `.env.e2e.local`. Drop `--env-file=.env.e2e.local` from the commands below, because Node exits when the file is missing. Chromium automatically trusts the session's network proxy (`e2e/proxy-trust.ts`), and hosted runs stub out Vercel's Preview toolbar, which tests don't use.

### Run

This checks that the deployed Preview, with its real Vercel functions and Turso database, works end to end. Browsers were already covered locally by `npm run verify:full`, so the hosted run is short, about 5–10 minutes. Run the three steps **once per candidate commit**, with one `E2E_RUN_ID` for the whole run and a distinct `E2E_INVOCATION_ID` for each step:

| Invocation ID | Arguments after `node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote` |
| --- | --- |
| `01-smoke` | `--project=chromium --retries=0 e2e/readiness/browser-smoke.spec.ts` |
| `02-api-suite` | `--project=api --retries=0` |
| `03-browser-uat` | `--project=chromium --retries=0 e2e/readiness/browser-uat.spec.ts e2e/readiness/browser-setup-navigation.spec.ts` |

PowerShell:

```powershell
$env:E2E_BASE_URL = 'https://<exact-preview-origin>'
$env:E2E_VERCEL_DEPLOYMENT_ID = 'dpl_<exact-deployment-id>'
$env:E2E_RUN_ID = "preview-qa-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$env:E2E_INVOCATION_ID = '01-smoke'
node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote --project=chromium --retries=0 e2e/readiness/browser-smoke.spec.ts
```

bash:

```sh
export E2E_BASE_URL='https://<exact-preview-origin>' E2E_VERCEL_DEPLOYMENT_ID='dpl_<exact-deployment-id>'
export E2E_RUN_ID="preview-qa-$(date +%Y%m%d-%H%M%S)"
E2E_INVOCATION_ID=01-smoke \
  node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote --project=chromium --retries=0 e2e/readiness/browser-smoke.spec.ts
```

Notes:

- The full browser suite (`--project=chromium --retries=0 e2e/readiness`) can still run against a Preview when you want it. It takes much longer.
- In a cloud session, the network proxy occasionally fails a browser read on its own with a short plain-text 502 or 504. Hosted browser runs re-send only those (GET or HEAD, without Vercel's `x-vercel-id` header), and print a `[cloud-proxy] retrying` line for each. Responses Vercel actually served, including errors, are never retried, and writes are never retried.
- Playwright reports and traces can include request headers, so keep them private.
- Use only run-owned fictional games. Never delete shared Preview data.

Afterwards, check `vercel inspect <preview-url> --logs` for runtime errors. Logs supplement the Playwright results; they don't replace them.

## Regenerate the guide media

The `/guide` screenshots and walkthrough video come from a fictional local game. After a visible UI change, run:

```sh
CAPTURE_GUIDE_MEDIA=1 node scripts/run-playwright.mjs --project=chromium --retries=0 e2e/readiness/guide-media.spec.ts
```

This writes the screenshots to `public/guide/` as WebP (quality 82, about a quarter of a PNG's size, so there is no separate shrinking step) and a raw recording to `work/guide-walkthrough-raw.webm`. With `CAPTURE_GUIDE_MEDIA=1`, the runner gives the local server placeholder email settings (an `.invalid` host), so **Email invites** appears switched on. The recording only hovers it, and nothing can be sent. Encode the published files with a full ffmpeg build (Playwright's bundled ffmpeg can't write MP4; `pip install imageio-ffmpeg` provides a portable one). The paper grain is expensive to encode, so these settings are tuned for it:

```sh
ffmpeg -y -i work/guide-walkthrough-raw.webm -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -movflags +faststart -an public/guide/walkthrough.mp4
ffmpeg -y -i work/guide-walkthrough-raw.webm -c:v libvpx-vp9 -b:v 0 -crf 44 -row-mt 1 -an public/guide/walkthrough.webm
ffmpeg -y -ss 4 -i public/guide/walkthrough.mp4 -frames:v 1 -q:v 3 public/guide/walkthrough-poster.jpg
```

On Windows, `winget install Gyan.FFmpeg` installs a full build.

`public/og.png` (the link-preview card) is a static image; redraw it if the emblem or title styling changes, and save it as a 256-colour PNG under 300 KB (`sharp` does it: `.png({ palette: true, quality: 90, effort: 10 })`).

Regenerate the media once per release candidate rather than in every pull request: each regeneration adds about 5 MB of binaries to the repository's history.
