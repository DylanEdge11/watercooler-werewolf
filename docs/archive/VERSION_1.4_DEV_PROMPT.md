# Prompt: build version 1.4 of Watercooler Werewolf

Written September 26, 2026 for a Claude Code session (Opus 5.5) working in this repository. Paste everything below the line into the session. It carries the scope and the recommended decisions so the session can start building after one round of confirmation.

---

You are building **version 1.4** of Watercooler Werewolf. Read `CLAUDE.md` first; it holds the project facts, code conventions, and safety rules, and they apply to everything below. The working base is the `version-1.4` branch on origin (already created from `main` at the 1.3 release). Build each work package with the `/werewolf-dev` skill: one `fix/` or `feat/` branch from `origin/version-1.4`, tests, docs, `npm run verify`, a pull request into `version-1.4`, a Preview walkthrough, then the handoff and stop. Merge only when I say "merge it". After the last package is merged, tell me it is time for `/werewolf-uat`; do not run it yourself.

Background: `docs/archive/PRODUCT_REVIEW_2026-09-26.md` is the review this version comes from. Item numbers below refer to it. Read sections A and G of that document before starting. It is a record, not an instruction; this prompt is the instruction.

## Scope

Version 1.4 is the **fix items** from the review plus two automation items: **scheduled phases (item 1)** and a **moderator digest (item 3)**. Auto-publish (item 2) is explicitly out of scope: a moderator still publishes every result. Also out of scope: new roles, a third faction, Slack or Teams, player notifications, and anything else in the review not listed here. Note anything you spot that belongs elsewhere under "Noticed, not fixed" in the handoff.

For items 1 and 3 the rule is: **do them if they are not difficult.** If, after reading the code, either needs a redesign of the phase route, more than one migration, or more than roughly a week of work, stop before building and give me the options with your recommendation. A partial version is worse than no version.

Work through the packages in the order below. Each is one pull request unless the skill tells you to split further.

## Decisions already made

Treat these as the answers to the questions the `/werewolf-dev` skill would ask. Restate them in your first message in one round so I can veto any, then proceed.

### WP1 · `fix/public-record` — the published record matches the engine (items 41, 42, 43, 49)

1. **Mayor's double vote (41).** Day and Final ballot tallies shown to players must match the engine. Publish weighted totals: the server computes per-target totals from the published Day votes using the same weights as the engine (a living Mayor's vote counts 2) and sends them with the timeline event under a new key such as `voteTotals`. Do not reuse the key `tally`; it is in `FORBIDDEN_PLAYER_KEYS` because Night tallies are private. The per-voter ledger stays one line per voter, unweighted. The vote modal, the full Timeline, and the guide say plainly: "The Mayor's vote counts twice, so totals can be higher than the number of voters." Add unit tests in `lib/game/timeline-view.ts` (or wherever the total is computed) that fail without the weight.
2. **Full reveal at the end (42).** When a game is `COMPLETED`, every player's role becomes public to players: the living players list carries roles, and the `GAME_COMPLETED` timeline entry lists the final roster with roles and who survived. Before completion nothing changes. Add this to the privacy test so a non-completed game still never exposes a living player's role.
3. **Bodyguard save wording (43).** Stop announcing protection publicly. When the pack's target was protected and nobody else died, the public result says "No one was eliminated." The moderator console, the backup, and the published outcome keep the detail. Do not add a per-game option in this version; note it as a possible later option in the handoff. Update the guide's Bodyguard text and the rules section accordingly.
4. **Privacy list (49).** Add the participation counter fields and any new keys from this package to the checks in `e2e/readiness/browser-fixture.ts`, so a future Night role cannot leak through "N of M submitted".

### WP2 · `fix/game-settings` — settings a moderator can actually see and set (items 28, 45)

1. **Hunter window (28).** Default a new game's Hunter window to **8 hours (480 minutes)** instead of 60. Set it in the create-game route rather than changing the column default, so no migration is needed. Add "Hunter window" to the schedule form, in hours, editable while setup is editable. The console's Hunter callout already shows the deadline; the guide's "60 minutes by default" text must change.
2. **Eliminations per phase (45).** Expose `dayDivisor` and `nightDivisor` in the schedule form as an "Advanced" section that is collapsed by default, with the slot table (1 slot up to the divisor, 2 up to twice it, and so on) previewed next to it. Validate as positive integers. Editable while setup is editable only.
3. **Unused columns (45).** Leave `finalRoundMinutes` and `publicationMode` in the database (schema changes are additive) and add no UI for them. Document them in `docs/TECHNICAL.md` as reserved. The weekday cadence and close times stop being informational in WP4, so leave them in the form.

### WP3 · `fix/console-visibility` — show moderators what the app already knows (items 46, 47, 4)

1. **Feedback (46).** Add a moderator-only `GET /api/games/[gameId]/feedback` and a "Feedback" block in the Operations panel: each entry's rating, comment, respondent type (player or moderator, never the player's name), and time, plus the average. Change the player-facing card copy from "private to the pilot operators" to "private to the moderators". Keep the word "pilot" out of player-facing text.
2. **Announcement copy (47).** After publishing an announcement, show its email subject and body with a "Copy" button, and list earlier announcements with the same button (the `GET` route already returns them). Add a second variant formatted for chat (title in bold, body, and the site link).
3. **Who is outstanding (4).** In the live game panel, list by name the living players who have not saved a response for the open phase, and add "Copy nudge message". The nudge must be safe to paste into a group chat: for a Day, it may list names; for a Night, it must never list names or roles ("If your role has a night action, save it before HH:MM"). The names on screen are for the moderator only. Say this in the panel's help text.

### WP4 · `feat/scheduled-phases` — the game keeps time on its own (items 1, 51)

The setup already collects "Day ballot closes", "Night actions close", and active weekdays. Make them real.

1. **Per-game switch.** Add one additive column, `schedule_mode` (`MANUAL` or `SCHEDULED`), default `MANUAL` so existing games are unchanged. New games default to `SCHEDULED` in the form. Follow `docs/SETUP.md#schema-changes`; migrate the Preview database only.
2. **The schedule.** On each active weekday in the game's timezone: at "Night actions close", lock the open Night (if any) and open the Day; at "Day ballot closes", lock the open Day and open the Night. The first Day opens on the first active weekday on or after the start date at the "Night actions close" time, once roles are released. A Night that opens before a non-active day closes at the next active morning. Nothing opens after the final cutoff, and nothing opens while the game is not `ACTIVE`.
3. **Never skip the moderator.** A new phase opens only if the previous phase is `PUBLISHED`. If it is not (locked, pending Hunter, or awaiting review), the sweep does nothing to that game and the console shows "Scheduled Day open is waiting for you to publish Cycle N." No auto-publish, no override, ever.
4. **Lock and calculate.** When the sweep locks a phase, also compute the proposal (what "Lock responses & calculate" does), so the moderator's remaining job is review and publish. Do this only if the calculation can be pulled out of the phases route into `lib/game/` cleanly; if it cannot, lock only and say so.
5. **Where it runs.** Write the timing rules as a pure, unit-tested function in `lib/game/` (inputs: game settings, latest phase, now; output: the transition due, if any) and one idempotent sweep that uses conditional writes and stable event ids like `reconcileDuePhases` does. Call the sweep from three places: the existing `/api/scheduler/deadlines` route, the moderator panel's ten-second poll, and the player dashboard's poll (a cheap check first, so idle games cost one indexed query). This way phases open on the next visit after the scheduled time even with no cron. Add a `crons` entry to `vercel.json` for the scheduler route and document in `docs/SETUP.md` that on a plan whose cron runs only daily, a free external scheduler hitting the route with `CRON_SECRET` every five minutes is the reliable option. Never depend on the cron for correctness.
6. **Console and guide.** The live panel shows the next scheduled transition and time, with the manual controls still available (a manual open or lock is always allowed and the schedule continues from there). The guide's moderator section gets a short "Scheduled phases" paragraph; `docs/OPERATIONS.md` and `docs/TECHNICAL.md` describe the rules above.
7. **Tests.** Unit tests for the timing function across weekday gaps, daylight-saving transitions (`lib/game/scheduling.ts` already has patterns), the final cutoff, and the "previous phase not published" case. A route-level test that two concurrent sweeps open one phase.

### WP5 · `feat/moderator-digest` — one email per phase boundary (item 3)

Uses the SMTP settings that already power invite email. If SMTP is not configured, send nothing and show "Moderator email is not set up" once in the Operations panel.

1. **When.** Send one email to every moderator of the game when: a phase is locked and calculated (by the sweep or by hand), a Hunter window opens, a phase is published, and a scheduled open is waiting on an unpublished phase. Not on every player action. No batching or daily digest in this version.
2. **What.** Game name, what happened, the phase and cycle, the deadline or next scheduled transition, who has not responded (names only, for a Day; a count only, for a Night), what needs a decision, and a link to the console. **Never include roles, private results, or the proposed eliminations' roles**; email can be forwarded, the console cannot.
3. **How.** A small `lib/email/moderator-digest.ts` that renders the message from data the route already has, with unit tests on the rendering. Send after the write succeeds and never let a mail failure fail the game action; record failures as operational events. Reuse the rate-limit and settings code in `lib/email/`.
4. **Opt-out.** A per-moderator switch in the console ("Email me at each phase boundary"), default on. If that needs a column, make it additive and include it in the WP4 migration if the packages are close together; otherwise its own.
5. **Docs.** `docs/OPERATIONS.md` gets a "Moderator email" section; `docs/SETUP.md#invite-email` mentions that the same settings enable it.

### WP6 · `fix/timeline-paging` — optional, last (item 48)

Only if WP1 to WP5 are merged and there is time: replace the 100-update cap on the player timeline with "Show older updates" paging, the way notifications already page. Skip it otherwise and say so.

## Rules for the whole version

- Follow every `/werewolf-dev` step, including the Preview walkthrough at phone and desktop widths. Handoffs use the skill's format and are written for a product manager.
- A player must never receive another player's role or private result before it is published. Every new field in a player response is checked against `FORBIDDEN_PLAYER_KEYS`.
- Every behaviour change has a test that fails without it. Bugs get the failing test first.
- Migrations are additive and go to Preview only; never touch Production, never print credentials.
- Batch commits; run `npm run verify` before each push. Don't add GitHub Actions jobs or triggers.
- Update `app/guide/page.tsx` whenever something players or moderators see changes; regenerate guide media only if a screenshot in the guide becomes wrong.
- Keep each PR to its package. If a package grows, split it and tell me rather than widening a branch.
- If anything here conflicts with what you find in the code, say so before building and recommend a resolution.

Start with WP1. In your first message: confirm you are on `origin/version-1.4`, restate the WP1 decisions in plain language, list any question the decisions above leave open (with your recommended answer), and then begin.
