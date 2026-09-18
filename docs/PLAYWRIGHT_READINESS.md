# Browser readiness suite

This suite validates the player and moderator browser experience with twenty independent player sessions. It is separate from the existing API bot farm in `e2e/bot-farm.ts` and does not replace those lower-level tests.

## Run it

Run from `C:\Users\dylan\Documents\ChatGPT\Werewolf\project`:

```powershell
npm run test:e2e:readiness
npm run test:e2e:readiness:headed
npm run test:e2e:readiness:random
```

The default readiness command runs the full Chromium readiness projects plus the Firefox and WebKit smoke projects. Playwright is configured for one worker because the local fixture server, SQLite database, and moderator session are shared within a run. The local server listens on `http://localhost:3100`; it is never a Vercel or production endpoint.

For the requested stability check, run the full command three times in separate invocations. Each invocation starts a new local Next server and a fresh disposable SQLite database:

```powershell
1..3 | ForEach-Object { npm run test:e2e:readiness }
```

The randomized command runs seeds `7`, `21`, and `42` with the standard twenty-player composition. Each seed is recorded as a Playwright annotation.

## What is tested

- moderator, player-login, claim, and public entry points;
- twenty separate `BrowserContext` objects, pages, cookies, and player sessions;
- real browser claiming, sign-in, role viewing, target selection, revisions, submissions, reloads, and read-only states;
- moderator UI phase opening, locking, review, Hunter finalization, publication, and final showdown;
- the standard 20-player composition: 12 Villagers, 3 Werewolves, Seer, Bodyguard, Hunter, and 2 Masons;
- player privacy at both the rendered-DOM and `/api/player` boundary;
- permitted Werewolf/Mason teammate information and private Seer notifications;
- invalid, eliminated, duplicate, late, closed, and post-completion submissions;
- latest-revision behavior, double-click protection, concurrent action barriers, ties, missing votes, protection, and Hunter follow-up;
- reload resilience, mobile-width layout, keyboard activation, loading states, accessible names, and completed/read-only pages;
- seeded randomized Day/Night cycles and normal completion through final showdown;
- page errors, console errors/warnings, failed requests, unexpected navigations, 5xx responses, and uncaught promise rejections.

The role map is read only from the moderator context and held in test memory. Player actions use the browser UI. API requests are limited to disposable setup, moderator-side assignment introspection, negative-boundary checks, and verification.

## What is not tested

This is not a production deployment, a hosted Vercel smoke test, an email-delivery test, or a test of real user accounts. It does not prove the application is bug-free. External provider integrations, real-time chat delivery across networks, Vercel infrastructure, and long-duration production scheduling remain outside this local readiness boundary.

Every scenario creates a new game and roster. The runner creates a new disposable database per command invocation and removes the database, WAL, and shared-memory files during shutdown. The existing API tests and browser tests are intentionally kept as separate Playwright projects.

## Reports and diagnostics

The HTML report is written to `playwright-report/` and can be opened with:

```powershell
npx playwright show-report playwright-report
```

Failed tests retain screenshots and video. The first retry retains a trace:

```powershell
npx playwright show-trace test-results/<failed-test>/trace.zip
```

The configured retry is for diagnostic trace collection only. The list reporter shows the first-attempt result and the retry result separately; a passing retry does not erase a first-attempt failure from the QA report.

## Log and privacy rules

Telemetry messages redact six-digit PINs, invite/claim URL paths, cookies, and role-bearing private fields. Scenario annotations contain only a game identifier, seed, player count, and high-level flags. The full role map is never printed. Failure screenshots, videos, and traces are local diagnostic artifacts and can contain the rendered page; treat them as private test evidence and do not publish them with logs.
