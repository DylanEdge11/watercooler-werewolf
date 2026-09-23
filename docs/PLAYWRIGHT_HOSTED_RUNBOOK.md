# Hosted Preview Playwright runbook

This runbook is for the isolated Vercel Preview deployment only. Never point these commands at either Production URL.

## Configure one run

Use a supported secret/environment mechanism. The simplest local method is the ignored `.env.e2e.local` file described in `.env.example`; do not commit or paste secrets into the repository or chat.

```powershell
notepad .env.e2e.local
# Paste the real values into that ignored file, then use a unique run ID per invocation.
```

The runner rejects non-HTTPS URLs, paths, queries, fragments, missing credentials, non-Preview deployments, non-Ready deployments, protection redirects, non-JSON API responses, unprovisioned moderator bootstrap, and unexpected authentication responses. It performs no database mutation during preflight.

## Run in order

```powershell
$runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$env:E2E_RUN_ID = "preview-qa-$runStamp"
$env:E2E_INVOCATION_ID = '01-chromium-smoke'
node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote --project=chromium --retries=0 e2e/readiness/browser-smoke.spec.ts
$env:E2E_INVOCATION_ID = '02-edge-smoke'
node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote --project=edge --retries=0 e2e/readiness/browser-smoke.spec.ts
$env:E2E_INVOCATION_ID = '03-api-suite'
node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote --project=api --retries=0
$env:E2E_INVOCATION_ID = '04-readiness-suite'
node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote --project=chromium --retries=0 e2e/readiness
$env:E2E_INVOCATION_ID = '05-setup-navigation'
node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote --project=chromium --retries=0 e2e/readiness/browser-setup-navigation.spec.ts
```

The full `e2e/readiness` directory includes the three seeded randomized browser scenarios (seeds 7, 21, and 42). WebKit is optional Safari coverage; Firefox is optional and is not required for release acceptance. Run the required sequence once per candidate SHA with a unique `E2E_RUN_ID`. Do not repeat the full sequence by default. Run a separate repeatability sequence with a fresh ID only when persistence, isolation, or rerun safety is part of the change, or when the user explicitly requests it. The harness uses one worker, retries disabled in remote mode, unique run-scoped artifact directories, exact same-origin `Origin` headers on programmatic requests, and the Vercel protection header on every explicitly created browser/API context.

`E2E_RUN_ID` names the parent QA run; `E2E_INVOCATION_ID` names each command. Results and HTML reports are retained under `test-results/<run-id>/<invocation-id>` and `playwright-report/<run-id>/<invocation-id>`. For example, the first and last commands coexist at `playwright-report/<run-id>/01-chromium-smoke` and `playwright-report/<run-id>/05-setup-navigation`, with matching directories under `test-results/`. Inspect the Vercel deployment after the run with `vercel inspect $env:E2E_BASE_URL --logs`; hosted runtime logs are not a substitute for Playwright evidence.

## Operator checks

Before mutation, confirm the target with:

```powershell
vercel inspect $env:E2E_BASE_URL --json
vercel env ls preview
```

The deployment must report project `watercooler-werewolf`, target `preview`, and `READY`. Use a run-owned fictional moderator and run-owned games. Do not use a public reset/seed endpoint or delete shared data.
