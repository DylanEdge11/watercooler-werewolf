# Testing

How to verify a change, from fast unit tests to a full hosted Preview run. Use fictional players and `.test` email addresses only. **Never point a test, pilot script, or bypass secret at Production.**

## Release checks

These match the `Verify` workflow in `.github/workflows/ci.yml`, which runs on every push:

```text
npm test -- --run
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm audit --omit=dev --audit-level=moderate
```

A candidate is ready for release when CI is green for its exact commit and the [hosted Preview run](#hosted-preview-runbook) has passed against its Preview deployment. Earlier results do not carry over to a new commit.

## Unit tests

`npm test` runs Vitest over `lib/**/*.test.ts`: the game engine, action rules, scheduling, balance, CSV import, auth, rate limits, migrations, backup and restore, and race conditions in the API routes, using an in-memory libSQL database.

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

All local suites start a disposable Next server on `http://localhost:3100` with a fresh SQLite database, bootstrap a fictional moderator, and delete the database afterward. They run one worker at a time.

| Command | What it covers |
| --- | --- |
| `npm run test:e2e` | **API bot farm.** 20 players, each in its own request context: full Village and Werewolf wins, revisions, ties, protection, late and eliminated submissions, privacy boundaries, and concurrent submissions. |
| `npm run test:e2e:random` | Bot farm with seeded random decisions (seeds 7, 21, 42). |
| `npm run test:e2e:readiness` | **Browser suite.** 20 real browser sessions in Chromium through the full game, including privacy at the page and API level, mobile width, keyboard use, reloads, and console or network errors. Adds a smoke test in Firefox and WebKit. |
| `npm run test:e2e:readiness:random` | Browser suite with seeds 7, 21, and 42. |

Reports go to `playwright-report/<run-id>/<invocation-id>/`, and traces, screenshots, and videos to `test-results/`. Open a report with `npx playwright show-report <path>`. These artifacts can show roles, so keep them private.

## Hosted Preview runbook

Use this to verify a specific Preview deployment. The runner refuses anything that is not HTTPS, not a `READY` Preview of project `watercooler-werewolf`, or not the expected deployment ID. It checks this before creating any data.

### Configure

Put these in the ignored file `.env.e2e.local`, never in Git or chat:

```text
E2E_BASE_URL=https://<exact-preview-origin>
E2E_VERCEL_DEPLOYMENT_ID=dpl_<exact-deployment-id>
E2E_MODERATOR_EMAIL=<fictional preview moderator>
E2E_MODERATOR_PASSWORD=<12+ characters>
VERCEL_AUTOMATION_BYPASS_SECRET=<scoped to this Preview>
```

The preflight calls `vercel inspect`, so the Vercel CLI must be installed and signed in to `dyl-edge`, or `VERCEL_TOKEN` must be set.

### Run

Run the sequence **once per candidate commit**, with one `E2E_RUN_ID` for the whole run and a distinct `E2E_INVOCATION_ID` for each command:

| Invocation ID | Arguments after `node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote` |
| --- | --- |
| `01-chromium-smoke` | `--project=chromium --retries=0 e2e/readiness/browser-smoke.spec.ts` |
| `02-edge-smoke` | `--project=edge --retries=0 e2e/readiness/browser-smoke.spec.ts` |
| `03-api-suite` | `--project=api --retries=0` |
| `04-readiness-suite` | `--project=chromium --retries=0 e2e/readiness` |
| `05-setup-navigation` | `--project=chromium --retries=0 e2e/readiness/browser-setup-navigation.spec.ts` |

PowerShell:

```powershell
$env:E2E_RUN_ID = "preview-qa-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$env:E2E_INVOCATION_ID = '01-chromium-smoke'
node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote --project=chromium --retries=0 e2e/readiness/browser-smoke.spec.ts
```

bash:

```sh
export E2E_RUN_ID="preview-qa-$(date +%Y%m%d-%H%M%S)"
E2E_INVOCATION_ID=01-chromium-smoke \
  node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote --project=chromium --retries=0 e2e/readiness/browser-smoke.spec.ts
```

Notes:

- The Edge smoke needs Microsoft Edge installed. If it isn't (for example on Linux), record it as not run rather than substituting another browser.
- Firefox and WebKit are optional.
- Repeat the sequence with a fresh `E2E_RUN_ID` only when the change affects persistence, isolation, or rerun safety.
- Use only run-owned fictional games. Never delete shared Preview data.

Afterwards, check `vercel inspect <preview-url> --logs` for runtime errors. Logs supplement the Playwright results; they don't replace them.

## Regenerate the guide media

The `/guide` screenshots and walkthrough video come from a fictional local game. After a visible UI change, run:

```sh
CAPTURE_GUIDE_MEDIA=1 node scripts/run-playwright.mjs --project=chromium --retries=0 e2e/readiness/guide-media.spec.ts
```

This writes screenshots to `public/guide/` and a raw recording to `work/guide-walkthrough-raw.webm`. Encode the published files with a full ffmpeg build (Playwright's bundled ffmpeg can't write MP4):

```sh
ffmpeg -y -i work/guide-walkthrough-raw.webm -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart -an public/guide/walkthrough.mp4
ffmpeg -y -i work/guide-walkthrough-raw.webm -c:v libvpx-vp9 -b:v 0 -crf 38 -row-mt 1 -an public/guide/walkthrough.webm
ffmpeg -y -ss 4 -i public/guide/walkthrough.mp4 -frames:v 1 -q:v 3 public/guide/walkthrough-poster.jpg
```
