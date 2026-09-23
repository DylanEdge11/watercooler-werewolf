# Playwright 20-player bot farm

The Playwright suite exercises a disposable local game through the same HTTP routes used by the moderator and player dashboards. The test server creates a fresh libSQL file under `work/playwright/`, runs the checked-in migrations, bootstraps a fictional moderator, and removes that database when the server exits.

Run it from `project/` with Node.js 24.x LTS. The package supports Node.js `>=24`; CI verifies Node 24.x.

```text
npm run test:e2e
```

The suite uses Playwright's API request contexts rather than launching 20 browser windows. No browser binary is required for the current suite. Each player gets one isolated request context, claims a separate private seat, and retains its own HTTP-only player cookie. The moderator uses a separate context. Twenty action requests are sent with `Promise.all` for the rounds that are intended to model approximately simultaneous submissions.

The scripted suite covers:

- a full Village win and a full Werewolf win;
- latest-revision counting, missing votes, a recorded boundary tie, and protected attacks;
- eliminated-player submissions and submissions after a phase locks;
- private role/dashboard access boundaries and moderator-only phase/assignment reads;
- Seer-only investigation notifications and safe public timeline payloads;
- concurrent Werewolf, Bodyguard, Seer, and ballot submissions.

The randomized suite runs seeds `7`, `21`, and `42`. The seed controls bot decision choices, skipped submissions, and revisions. Role assignment remains cryptographically randomized by the application, so the seed is a repeatable decision stream for the assignment generated in that run rather than a production override of role randomness. Each run checks phase publication, elimination validity, Hunter follow-up when encountered, the local win-condition calculation, and terminal completion; if the exploratory rounds remain unresolved, it finishes through Final Showdown with a deterministic cleanup ballot.

The bot farm intentionally uses Playwright API requests for high-volume player actions. This keeps the 20-player run fast while still testing cookie isolation, route authorization, database concurrency, and the player-facing JSON contract. Browser-level assertions can be added later with Playwright's `page` fixture when the UI itself needs coverage.
