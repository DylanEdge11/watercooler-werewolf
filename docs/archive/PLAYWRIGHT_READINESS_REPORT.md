# Browser readiness QA report

Date: 2026-09-18
Repository: `C:\Users\dylan\Documents\ChatGPT\Werewolf\project`
System under test: local Werewolf Next.js application on `http://localhost:3100` with a disposable SQLite database
Recommendation status: do not declare “ready for 20 players” from this report alone.

## Scope and test count

The readiness project currently contains:

- 1 browser smoke test, executed in Chromium, Firefox, and WebKit;
- 7 main Chromium readiness scenarios: onboarding/privacy, scripted Village win, scripted Werewolf win, eliminated-player behavior, duplicate/closed phases, ties/missing votes/protection/Hunter, and resilience/UI;
- 2 Chromium regression scenarios for player timeline redaction and reviewed Hunter permissions;
- 3 seeded randomized Chromium scenarios: seeds 7, 21, and 42.

That is 13 Chromium readiness scenarios, with 20 independent player contexts in each 20-player scenario; the browser matrix adds one smoke execution for each browser. The API bot-farm project remains separate and is not included in this count.

## Browser matrix

| Project | Coverage | Current evidence |
|---|---|---|
| Chromium | Full readiness and randomized coverage | 13/13 passed in each of 3 consecutive post-fix runs; 15.2m, 15.3m, and 15.3m; `--retries=0` |
| Firefox | Entry-point smoke | Blocked before test execution: Playwright Firefox launch returned `spawn UNKNOWN`; host Firefox binary also reports a side-by-side configuration failure |
| WebKit | Entry-point smoke | 1/1 passed in 3.2s |

## Final evidence

- Preserved API project: 6/6 passed in 28.1s.
- Full Chromium readiness: 13/13 passed in each of 3 consecutive post-fix runs, with one worker and no retries.
- The 3 full Chromium runs each passed onboarding/privacy, Village win, Werewolf win, eliminated-player behavior, duplicate/closed phases, ties/missing votes/protection/Hunter, resilience/UI, both regressions, smoke, and seeds 7/21/42.
- Chromium smoke passed; WebKit smoke passed in 3.2s.
- Twenty independent browser contexts were used for each 20-player scenario, plus one separate moderator context.
- No unexpected page errors, console errors, failed local requests, 5xx responses, unexpected navigations, or uncaught promise rejections were reported by the readiness telemetry in the clean Chromium runs.
- The runner did print non-failing framework advisories (`scroll-behavior: smooth` and Node’s `NO_COLOR` warning); these were not page errors, failed requests, or unhandled exceptions.
- The runner confirmed no listening process remained on port 3100 and no files remained in `work/playwright` after the final smoke checks.

## Defects and limitations

No new production defect has been established by the passing scenarios. The working tree already contains the player-response redaction and reviewed-Hunter permission changes that the named regression tests verify; those changes are visible in `app/api/player/route.ts` and should be reviewed with the rest of the pending work.

Two test-harness stability findings were observed and corrected without retries:

- The first combined run let randomized tests create the first completed game, so the later moderator-UI onboarding scenario could not find the new-game form. The randomized file was ordered after the first-game onboarding scenario.
- A ties scenario once hit `ECONNRESET` while reloading all 20 players simultaneously. Reload convergence is now serialized; action submissions and action barriers remain concurrent. This removes a local fixture-server burst, but it means simultaneous reload pressure is not a clean production-capacity measurement.

Firefox remains a host-runtime blocker, not an application result. The installed Playwright Firefox executable cannot launch on this Windows host even after a forced browser reinstall. Firefox evidence must be collected on a host with a working Firefox runtime.

Each scenario creates a fresh game and roster. The current runner creates one fresh disposable SQLite database per command invocation, rather than restarting the database once per individual test. This is an explicit fixture limitation.

## Readiness recommendation

1. Rules/API confidence: strong but conditional. The preserved API suite passed 6/6, and the browser suite exercises the application’s actual engine rules, revisions, ties, protection, Hunter flow, parity, and completion. This is evidence, not proof of bug-freedom.
2. Browser/UI confidence: strong for Chromium and WebKit smoke; incomplete for Firefox. Chromium passed 3 consecutive full runs and WebKit smoke passed. Firefox is blocked by the test host runtime.
3. Multiplayer-readiness confidence: not ready to certify. The evidence supports substantial local Chromium confidence, but the Firefox blocker, the serialized reload limitation, the per-invocation database scope, and the lack of a hosted Vercel run prevent a “ready for 20 live players” recommendation.
