# Prompt: build version 1.4 of Watercooler Werewolf

Written September 26, 2026 for a Claude Code session (Opus 5.5) working in this repository. Paste everything below the line into the session. It carries the scope and the recommended decisions so the session can start building after one round of confirmation.

---

You are building **version 1.4** of Watercooler Werewolf. Read `CLAUDE.md` first; it holds the project facts, code conventions, and safety rules, and they apply to everything below. The working base is the `version-1.4` branch on origin (already created from `main` at the 1.3 release). Build each work package with the `/werewolf-dev` skill: one `fix/` or `feat/` branch from `origin/version-1.4`, tests, docs, `npm run verify`, a pull request into `version-1.4`, a Preview walkthrough, then the handoff and stop. Merge only when I say "merge it". After the last package is merged, tell me it is time for `/werewolf-uat`; do not run it yourself.

Background: `docs/archive/PRODUCT_REVIEW_2026-09-26.md` is the review this version comes from. Item numbers below refer to it. Read sections A, C (item 14), and G of that document before starting. It is a record, not an instruction; this prompt is the instruction.

## Scope

Version 1.4 has three themes:

1. **The fix items** from section G of the review (items 28, 41, 43, 45, 46, 47, 49) plus the outstanding-responders list (item 4).
2. **The campaign runs itself** (section A): scheduled phases (1), auto-publish after a review window (2), and pause (5). This is the heart of the version.
3. **The end-of-game reveal and recap** (items 42 and 14, in full).

Out of scope for this version, and not to be started even if it looks easy: Slack or Teams, player email reminders, web push, the calendar feed (all of section B), new roles, a third faction, and anything else in the review not listed here. Note anything you spot that belongs elsewhere under "Noticed, not fixed" in the handoff.

The moderator digest email (item 3) is the one optional item: do it last, only if everything else is merged and it fits cleanly on the existing SMTP code. Skip it otherwise and say so.

For the automation packages the rule is: **build them if they are not difficult.** If, after reading the code, a package needs a redesign of the phases route, more than one migration in total for the version, or more than roughly a week of work, stop before building and give me the options with your recommendation. A partial version is worse than no version.

Work through the packages in the order below. Each is one pull request unless the skill tells you to split further.

## Decisions already made

Treat these as the answers to the questions the `/werewolf-dev` skill would ask. Restate them in your first message in one round so I can veto any, then proceed.

### WP1 · `fix/public-record` — the published record matches the engine (items 41, 43, 49)

1. **Mayor's double vote (41).** Day and Final ballot tallies shown to players must match the engine. Publish weighted totals: the server computes per-target totals from the published Day votes using the same weights as the engine (a living Mayor's vote counts 2) and sends them with the timeline event under a new key such as `voteTotals`. Do not reuse the key `tally`; it is in `FORBIDDEN_PLAYER_KEYS` because Night tallies are private. The per-voter ledger stays one line per voter, unweighted. The vote modal, the full Timeline, and the guide say plainly: "The Mayor's vote counts twice, so totals can be higher than the number of voters." Add unit tests that fail without the weight.
2. **Bodyguard save wording (43).** Stop announcing protection publicly during the game. When the pack's target was protected and nobody else died, the public result says "No one was eliminated." The moderator console, the backup, and the published outcome keep the detail, and the recap (WP4) reveals it after the game. Do not add a per-game option in this version; note it as a possible later option in the handoff. Update the guide's Bodyguard text and the rules section.
3. **Privacy list (49).** Add the participation counter fields and any new keys from this package to the checks in `e2e/readiness/browser-fixture.ts`, so a future Night role cannot leak through "N of M submitted".

### WP2 · `fix/game-settings` — settings a moderator can actually see and set (items 28, 45)

1. **Hunter window (28).** Default a new game's Hunter window to **8 hours (480 minutes)** instead of 60. Set it in the create-game route rather than changing the column default, so no migration is needed. Add "Hunter window" to the schedule form, in hours, editable while setup is editable. The guide's "60 minutes by default" text must change.
2. **Eliminations per phase (45).** Expose `dayDivisor` and `nightDivisor` in the schedule form as an "Advanced" section, collapsed by default, with the slot table (1 slot up to the divisor, 2 up to twice it, and so on) previewed next to it. Validate as positive integers. Editable while setup is editable only.
3. **Unused columns (45).** Leave `finalRoundMinutes` in the database and add no UI for it; document it in `docs/TECHNICAL.md` as reserved. `publicationMode` gets used in WP6; leave it alone here. The weekday cadence and close times become real in WP5, so leave them in the form.

### WP3 · `fix/console-visibility` — show moderators what the app already knows (items 46, 47, 4)

1. **Feedback (46).** Add a moderator-only `GET /api/games/[gameId]/feedback` and a "Feedback" block in the Operations panel: each entry's rating, comment, respondent type (player or moderator, never the player's name), and time, plus the average. Change the player-facing card copy from "private to the pilot operators" to "private to the moderators". Keep the word "pilot" out of player-facing text.
2. **Announcement copy (47).** After publishing an announcement, show its email subject and body with a "Copy" button, and list earlier announcements with the same button (the `GET` route already returns them). Add a second variant formatted for chat (title in bold, body, and the site link).
3. **Who is outstanding (4).** In the live game panel, list by name the living players who have not saved a response for the open phase, and add "Copy nudge message". The nudge must be safe to paste into a group chat: for a Day it may list names; for a Night it must never list names or roles ("If your role has a night action, save it before HH:MM"). The names on screen are for the moderator only. Say this in the panel's help text.

### WP4 · `feat/game-recap` — the final curtain (items 42 and 14)

Today a game ends with a one-line "Village wins" and survivors' roles are never shown to players. This package makes the ending the best part.

1. **Full reveal (42).** When a game is `COMPLETED`, every player's role becomes public to players: the living players list carries roles, and the `GAME_COMPLETED` timeline entry lists the final roster with roles and who survived. Before completion nothing changes. Extend the privacy test so a game that is not completed still never exposes a living player's role.
2. **The recap (14).** A new player route (for example `GET /api/player/recap`) that returns, **only when the game is `COMPLETED`** (403 otherwise, with a test): the winner; the final roster with roles and fates; then cycle by cycle, what happened: Day vote totals and eliminations; Night pack targets, saves by the Bodyguard, the Seer's and Apprentice Seer's results, Cupid's pairing when it was made, Hunter shots, lover-bond deaths, tie draws, and any moderator override note. Everything needed is already in the `PHASE_PUBLISHED` event payloads (`publishedOutcome`, `proposedOutcome`, `eliminations`, `overrideReason`) and the `CUPID_PAIR_SET` event, so no schema change is expected; compute it in a pure, unit-tested `lib/game/recap.ts` from the events and the roster.
3. **Moments.** Add a short, deterministic "moments" list computed from the same data: sharpest voter (most Day votes cast on players who turned out to be Werewolves), most suspected innocent (most Day votes received while not a Werewolf), the closest ballot, the save (if a Bodyguard block happened), the survivor(s), and the Werewolf who lasted longest. Name each moment in the Paper Theatre voice ("Best supporting suspicion"). Keep it to what the data proves; no guessing.
4. **Where it appears.** A "Final curtain" view on the player dashboard (alongside Today and Timeline), shown automatically once when the game completes and then reachable from the menu, in the Paper Theatre style with the role medallions. The moderator console gets the same recap plus "Copy recap" as plain text for chat, with roles included since the game is over.
5. **Stopped games** do not get a recap or a reveal; only completed ones. Say so in `docs/OPERATIONS.md`.
6. **Docs.** The guide's "Follow the story" and "Finish" sections describe the reveal and the recap; `docs/TECHNICAL.md` describes what the recap is computed from.

### WP5 · `feat/scheduled-phases` — the game keeps time on its own (items 1, 5, 51)

The setup already collects "Day ballot closes", "Night actions close", and active weekdays. Make them real.

1. **Per-game switch and pause.** Add one additive column, `schedule_mode` (`MANUAL`, `SCHEDULED`, or `PAUSED`), default `MANUAL` so existing games are unchanged. New games default to `SCHEDULED` in the form. `PAUSED` means the sweep leaves the game alone until a moderator resumes it; the console has "Pause schedule" and "Resume schedule" buttons with an audit event each, and players see "The schedule is paused" on the deadline card. Follow `docs/SETUP.md#schema-changes`; migrate the Preview database only. If WP6 needs a column too, add both in this one migration.
2. **The schedule.** On each active weekday in the game's timezone: at "Night actions close", lock the open Night (if any) and open the Day; at "Day ballot closes", lock the open Day and open the Night. The first Day opens on the first active weekday on or after the start date at the "Night actions close" time, once roles are released. A Night that opens before a non-active day closes at the next active morning. Nothing opens after the final cutoff, and nothing opens while the game is not `ACTIVE`.
3. **Never skip the moderator in this package.** A new phase opens only if the previous phase is `PUBLISHED`. If it is not (locked, pending Hunter, or awaiting review), the sweep does nothing to that game and the console shows "Scheduled Day open is waiting for you to publish Cycle N." WP6 adds publication; this package does not.
4. **Lock and calculate.** When the sweep locks a phase, also compute the proposal (what "Lock responses & calculate" does). This requires pulling the calculation out of `app/api/games/[gameId]/phases/route.ts` into `lib/game/` so the route and the sweep share it. This extraction is required, because WP6 depends on it; if it cannot be done cleanly, stop and tell me before building either package.
5. **Where it runs.** Write the timing rules as a pure, unit-tested function in `lib/game/` (inputs: game settings, latest phase, now; output: the transition due, if any) and one idempotent sweep that uses conditional writes and stable event ids the way `reconcileDuePhases` does. Call the sweep from three places: the existing `/api/scheduler/deadlines` route, the moderator panel's ten-second poll, and the player dashboard's poll (a cheap check first, so idle games cost one indexed query). Phases then open on the next visit after the scheduled time even with no cron. Add a `crons` entry to `vercel.json` for the scheduler route and document in `docs/SETUP.md` that on a plan whose cron runs only daily, a free external scheduler hitting the route with `CRON_SECRET` every five minutes is the reliable option. Never depend on the cron for correctness.
6. **Console, player view, and guide.** The live panel shows the next scheduled transition and time, with the manual controls still available (a manual open or lock is always allowed and the schedule continues from there). The player deadline card shows when the next phase opens. The guide's moderator section gets a "Scheduled phases" paragraph; `docs/OPERATIONS.md` and `docs/TECHNICAL.md` describe the rules above.
7. **Tests.** Unit tests for the timing function across weekday gaps, daylight-saving transitions (`lib/game/scheduling.ts` already has the patterns), the final cutoff, pause, and the "previous phase not published" case. A route-level test that two concurrent sweeps open one phase.

### WP6 · `feat/auto-publish` — publish after a review window (item 2)

Every safeguard for this already exists: `proposedOutcome`, `reviewedOutcome`, `publishedOutcome`, overrides with reasons, and the Hunter window. This package lets the calculated result go out on its own when the moderator does not step in.

1. **Setting.** Use the existing `publicationMode` column: `REVIEW` (current behaviour, a moderator publishes) or `AUTOMATIC`. Add a review window in minutes (a new additive column, default 60, included in the WP5 migration). New games default to `AUTOMATIC` with 60 minutes; existing games stay `REVIEW`. Both are editable in the schedule form at any time, including during the game, because they only affect what happens next.
2. **Rule.** In `AUTOMATIC` mode, when a phase has been `PENDING_APPROVAL` for longer than the review window, the sweep publishes the calculated outcome exactly as "Approve & publish" would, through the same shared code, with no override. If the outcome requires a Hunter, the sweep waits for the Hunter window (or the Hunter's shot) and then finalizes and publishes, using the same rules the console's "Finalize Hunter" applies. Publication by the sweep is recorded with no moderator actor and a `SCHEDULER` source, and the timeline entry and console say "Published automatically after the review window".
3. **The moderator always wins.** A moderator can publish, override, or pause at any time before the window ends, and the sweep's publish is a conditional write that changes zero rows if the phase has moved. Pausing the schedule also suspends auto-publish.
4. **Players.** During the review window the deadline card says "Results publish by HH:MM unless the moderator reviews them first."
5. **Tests.** Unit tests for the window rule; route-level tests that a moderator publish and a sweep publish racing each other produce one publication; a Hunter case; and a test that `REVIEW` mode never publishes on its own. Run `npm run test:e2e` after this package.
6. **Docs.** This changes the product's promise, so the guide's "What it is", "Results", and moderator "Run each phase" sections must say that results publish automatically after a review window unless the moderator chooses review mode; `docs/OPERATIONS.md` and `docs/TECHNICAL.md` describe the rule.

### WP7 · `feat/moderator-digest` — optional (item 3)

Only if WP1 to WP6 are merged and the existing `lib/email/` code makes it small. One email to each moderator of the game when a phase is locked and calculated, when a Hunter window opens, when a result is published (by hand or automatically), and when a scheduled open is waiting on an unpublished phase. Contents: game, what happened, the phase and cycle, the deadline or next scheduled transition, who has not responded (names for a Day, a count for a Night), what needs a decision, and a link to the console. **Never include roles or private results**; email can be forwarded. Never let a mail failure fail a game action. If SMTP is not configured, send nothing and show that once in the Operations panel. Skip the per-moderator opt-out unless it is trivial.

### WP8 · `fix/timeline-paging` — optional, last (item 48)

Only if there is still time: replace the 100-update cap on the player timeline with "Show older updates" paging, the way notifications already page.

## Rules for the whole version

- Follow every `/werewolf-dev` step, including the Preview walkthrough at phone and desktop widths. Handoffs use the skill's format and are written for a product manager.
- A player must never receive another player's role or private result before it is published, and never a living player's role before the game is completed. Every new field in a player response is checked against `FORBIDDEN_PLAYER_KEYS`.
- Every behaviour change has a test that fails without it. Bugs get the failing test first.
- Migrations are additive and go to Preview only; aim for one migration in the whole version; never touch Production; never print credentials.
- Batch commits; run `npm run verify` before each push. Don't add GitHub Actions jobs or triggers.
- Update `app/guide/page.tsx` whenever something players or moderators see changes; regenerate guide media only if a screenshot in the guide becomes wrong.
- Keep each PR to its package. If a package grows, split it and tell me rather than widening a branch.
- If anything here conflicts with what you find in the code, say so before building and recommend a resolution.

Start with WP1. In your first message: confirm you are on `origin/version-1.4`, restate the WP1 decisions in plain language, list any question the decisions above leave open (with your recommended answer), and then begin.
