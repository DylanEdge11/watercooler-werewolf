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
$env:E2E_RUN_ID = 'preview-qa-<unique-run-id>'
node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote --project=chromium --retries=0 e2e/readiness/browser-smoke.spec.ts
node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote --project=edge --retries=0 e2e/readiness/browser-smoke.spec.ts
node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote --project=api --retries=0
node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote --project=chromium --retries=0 e2e/readiness
node --env-file=.env.e2e.local scripts/run-playwright.mjs --remote --project=chromium --retries=0 e2e/readiness/browser-setup-navigation.spec.ts
```

The full `e2e/readiness` directory includes the three seeded randomized browser scenarios (seeds 7, 21, and 42). WebKit is optional Safari coverage; Firefox is optional and is not required for release acceptance. Run the same required sequence a second time with a new `E2E_RUN_ID`; the existing database is intentionally retained to prove reruns are scoped and repeatable. The harness uses one worker, retries disabled in remote mode, unique run-scoped artifact directories, exact same-origin `Origin` headers on programmatic requests, and the Vercel protection header on every explicitly created browser/API context.

Artifacts are retained under `test-results/<run-id>` and `playwright-report/<run-id>`. Inspect the Vercel deployment after the run with `vercel inspect $env:E2E_BASE_URL --logs`; hosted runtime logs are not a substitute for Playwright evidence.

## Operator checks

Before mutation, confirm the target with:

```powershell
vercel inspect $env:E2E_BASE_URL --json
vercel env ls preview
```

The deployment must report project `watercooler-werewolf`, target `preview`, and `READY`. Use a run-owned fictional moderator and run-owned games. Do not use a public reset/seed endpoint or delete shared data.
