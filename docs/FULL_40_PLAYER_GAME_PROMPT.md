# Astra High prompt: one complete 40-player game

Copy the prompt below into Astra High. It is intentionally self-contained so the model does not need to repeat the broader QA suite.

---

You are the senior QA automation engineer responsible for one complete end-to-end game run of the Watercooler Werewolf application.

Run exactly one new, run-owned 40-player game against the isolated Vercel Preview deployment. Do not run the full Playwright suite, do not test Production, and do not stop at a plan. Execute the game and return a detailed factual report.

## Target and safety

Use this exact Preview origin:

`https://watercooler-werewolf-8ssdpjq7y-dyl-edge.vercel.app`

Deployment identity:

- Deployment ID: `dpl_BBABEZrQ7tB5ArjZfhgtg1cEJKog`
- Vercel project: `watercooler-werewolf`
- Target: `preview`
- Expected state: `READY`

Never open or mutate either Production URL:

- `https://watercooler-werewolf.vercel.app/`
- `https://watercooler-werewolf-2y66x2ph4-dyl-edge.vercel.app/`

Before creating the game, verify through the existing remote Playwright preflight or Vercel metadata that the target is this exact Preview deployment, is `READY`, returns the expected application HTML/bootstrap, and has the Preview database. If preflight fails, stop with `BLOCKED` and report the exact failure. Do not mutate until preflight passes.

Use the existing secure environment mechanism, normally `.env.e2e.local`, for the Preview moderator credentials and `VERCEL_AUTOMATION_BYPASS_SECRET` when needed. Never print, paste, screenshot, or include passwords, bypass secrets, PINs, invite URLs, cookies, or session tokens in the report. Do not ask for secrets in chat. If the secure credentials are unavailable, stop with `BLOCKED: credentials/access unavailable`.

Use Chrome/Chromium for this run. Edge is acceptable if Chrome is unavailable. Firefox is not required. Safari/WebKit is optional and should not create a second game.

Use only fictional run-owned data. Do not delete shared data, reset another game, add a public seed/reset endpoint, or alter the application code to make this run pass. If a defect blocks the run, preserve the failed game and artifacts rather than silently resetting it.

## Run isolation and player data

Create a unique run ID, for example `astra-40-<UTC timestamp>`, and a unique game name such as `Astra 40 Player Full Run <run ID>`.

Create exactly 40 roster participants; the moderator is not included in this count. Use unique fictional names and emails, for example:

```csv
display_name,email
Astra Player 01,astra-40-01-<run-id>@e2e.test
Astra Player 02,astra-40-02-<run-id>@e2e.test
Astra Player 03,astra-40-03-<run-id>@e2e.test
Astra Player 04,astra-40-04-<run-id>@e2e.test
Astra Player 05,astra-40-05-<run-id>@e2e.test
Astra Player 06,astra-40-06-<run-id>@e2e.test
Astra Player 07,astra-40-07-<run-id>@e2e.test
Astra Player 08,astra-40-08-<run-id>@e2e.test
Astra Player 09,astra-40-09-<run-id>@e2e.test
Astra Player 10,astra-40-10-<run-id>@e2e.test
Astra Player 11,astra-40-11-<run-id>@e2e.test
Astra Player 12,astra-40-12-<run-id>@e2e.test
Astra Player 13,astra-40-13-<run-id>@e2e.test
Astra Player 14,astra-40-14-<run-id>@e2e.test
Astra Player 15,astra-40-15-<run-id>@e2e.test
Astra Player 16,astra-40-16-<run-id>@e2e.test
Astra Player 17,astra-40-17-<run-id>@e2e.test
Astra Player 18,astra-40-18-<run-id>@e2e.test
Astra Player 19,astra-40-19-<run-id>@e2e.test
Astra Player 20,astra-40-20-<run-id>@e2e.test
Astra Player 21,astra-40-21-<run-id>@e2e.test
Astra Player 22,astra-40-22-<run-id>@e2e.test
Astra Player 23,astra-40-23-<run-id>@e2e.test
Astra Player 24,astra-40-24-<run-id>@e2e.test
Astra Player 25,astra-40-25-<run-id>@e2e.test
Astra Player 26,astra-40-26-<run-id>@e2e.test
Astra Player 27,astra-40-27-<run-id>@e2e.test
Astra Player 28,astra-40-28-<run-id>@e2e.test
Astra Player 29,astra-40-29-<run-id>@e2e.test
Astra Player 30,astra-40-30-<run-id>@e2e.test
Astra Player 31,astra-40-31-<run-id>@e2e.test
Astra Player 32,astra-40-32-<run-id>@e2e.test
Astra Player 33,astra-40-33-<run-id>@e2e.test
Astra Player 34,astra-40-34-<run-id>@e2e.test
Astra Player 35,astra-40-35-<run-id>@e2e.test
Astra Player 36,astra-40-36-<run-id>@e2e.test
Astra Player 37,astra-40-37-<run-id>@e2e.test
Astra Player 38,astra-40-38-<run-id>@e2e.test
Astra Player 39,astra-40-39-<run-id>@e2e.test
Astra Player 40,astra-40-40-<run-id>@e2e.test
```

Generate a different six-digit PIN for every seat. Keep the invite CSV and PINs private. Use separate isolated browser contexts or equivalent isolated authenticated sessions for players; never reuse one player’s cookies for another player.

Use the existing Playwright/bot-farm patterns and normal application routes. Programmatic requests are acceptable for the 40-player volume, but they must use the exact Preview origin and the existing Vercel protection headers on every explicitly created browser/API context. Do not use direct database writes.

## Setup requirements

1. Sign in as the moderator and use `Start new setup` if an existing game is selected. Do not edit, cancel, reset, or mutate another active or completed game.
2. Create the uniquely named game with a schedule far enough in the future that it cannot expire during the run. Use the application’s normal setup controls.
3. Import the 40-row roster and create private seats.
4. Confirm the moderator shows exactly 40 roster participants, excluding the moderator.
5. Confirm the generated default composition is exactly:

   - 28 Villagers
   - 7 Werewolves
   - 1 Seer
   - 1 Bodyguard
   - 1 Hunter
   - 2 Masons

   This is the application’s 40-player starting preset. Record the actual composition. If the application generates a different default, stop before role release and report it as a defect; do not silently change the application rule.

6. Generate the assignment preview, confirm 40 unique seats and the expected role counts, then release roles.
7. Claim all 40 seats with their unique PINs and sign each player into an isolated session. Confirm at least one player from every role can see their own permitted role/team information and cannot see another player’s private role, PIN, session, or hidden outcome data. Confirm the two Masons can see each other in their permitted private room.

Record the complete role map privately for this QA report. Role assignments are allowed in the moderator QA report; credentials and access tokens are not.

## Deterministic full-game strategy

Use the moderator-visible assignment map to make the run finish predictably while exercising every available special power. Do not manually assign roles; use the application’s generated assignment.

Always obey the actual phase `slots`, eligible-player list, lifecycle status, and server validation. If the application’s displayed slot count differs from the expected default, adapt legally and record the actual value. Never submit an illegal action just to force the expected outcome.

The intended Village-win route is:

### Day 1

- Have every living player submit a legal `DAY_VOTE` for the Hunter.
- Lock, review, and publish the phase through the normal moderator controls.
- Record every voter and target, the complete tally, slots, selected targets, warnings, random tie draws, and every published elimination.
- Because the Hunter was eliminated, complete the Hunter follow-up. Have the Hunter use `HUNTER_SHOT` against a living Werewolf that was not already eliminated by Day 1.
- Finalize and publish the Hunter follow-up, then record the Hunter’s target and the resulting elimination.

### Night 1

- Have every living Werewolf submit a legal `WOLF_VOTE` for the same living Villager.
- Have the Bodyguard protect that exact Villager. This intentionally exercises a successful protection and should produce no Werewolf-attack elimination.
- Have the Seer investigate a living Werewolf and record the private exact-role result visible to the Seer.
- Lock, review, and publish the Night phase. Record the wolf vote ledger, tally, protected target, investigation, warnings, eliminations, and living counts.

### Day 2 and later

- Use the known role map to vote out remaining Werewolves in a controlled way. When the phase has two elimination slots, split the living voters between two different living Werewolves so both are selected legally. If the displayed slot count is one, remove one Werewolf and continue into the next legal phase.
- On the next Night phase, have the living Werewolves attack one living Villager. Have the Bodyguard protect a different living player so this night exercises a successful Werewolf attack and records one `WEREWOLF_ATTACK` elimination.
- Have the Seer investigate another living Werewolf whenever the Seer is alive. Record every exact investigation result.
- Continue alternating legal Day and Night phases until the game reaches a terminal winner. Avoid eliminating the Seer or Bodyguard before their powers have been exercised, unless the application’s actual assignment or resolution makes that unavoidable.
- If the Hunter was not eliminated on Day 1 because the application’s actual slot behavior differed, eliminate the Hunter on a later Day and complete the required Hunter follow-up.
- Do not use moderator overrides unless a genuine tie or other application condition requires one. If an override is required, record the reason, original proposal, override, reviewer, and final published outcome.

For every phase, use the supported sequence: open → collect legal actions → lock/propose → complete Hunter follow-up if pending → review → publish. Do not mutate the database or call undocumented endpoints. Do not wait unnecessarily for a deadline; use the normal moderator phase controls and the supported deadline procedure only if the UI requires it.

## Required phase-by-phase evidence

Create a durable, non-secret report as the run proceeds. Do not rely on memory or only on the final screen.

For every Day and Night, record:

- phase sequence, phase ID, kind, status, slots, and eligible living-player count;
- every submitted action, including actor display name, actor role, action kind, and target display name;
- for Day phases, every player’s vote and the full vote tally;
- for Night phases, every Werewolf vote and the full pack tally;
- Seer target and exact investigation result;
- Bodyguard target and whether the protection blocked the selected Werewolf attack;
- Hunter elimination trigger, Hunter target, and `HUNTER_SHOT` result;
- selected targets, random tie draws, warnings, moderator overrides, and reasons;
- each elimination, its display name, role, and cause (`DAY_VOTE`, `WEREWOLF_ATTACK`, or `HUNTER_SHOT`);
- living roster and counts after publication, including living Werewolves and living Village players;
- the winner field after every publication, including `null` when the game continues.

After each publication, refresh the moderator view and at least one relevant player view to confirm the persisted result. Confirm eliminated players are read-only and cannot submit later actions. Confirm private Night details are not exposed to ordinary Villagers.

## Final report format

Return a concise executive result followed by the complete audit. Include:

1. `PASS`, `FAIL`, or `BLOCKED`.
2. Preview URL, deployment ID, browser, run ID, game ID, and game name.
3. Roster count and confirmed role composition.
4. A role map for all 40 players, using display names only and no credentials.
5. A round-by-round section for every Day and Night. Use one vote table per Day and one action table per Night. Do not summarize away individual votes.
6. Living-count progression after every published phase.
7. Hunter, Bodyguard, Seer, Mason, and privacy findings.
8. Any tie/random draw, warning, override, rejected action, retry, or recovery step.
9. The terminal winner and the exact rule that caused completion: all Werewolves eliminated (`VILLAGE`) or Werewolves reached parity (`WEREWOLF`).
10. Screenshots, traces, reports, or logs with invite URLs, PINs, cookies, and tokens redacted.
11. Defects and blockers, clearly separating application defects from runner/environment limitations.

Use this summary block at the end:

```text
RESULT: PASS | FAIL | BLOCKED
BROWSER:
RUN_ID:
PREVIEW_URL:
DEPLOYMENT_ID:
GAME_ID:
GAME_NAME:
ROSTER_COUNT:
ROLE_COMPOSITION:
CLAIMED_SEATS:
ROLE_PRIVACY_CHECK:
MASON_ROOM_CHECK:
DAY_NIGHT_ROUNDS:
LIVING_COUNT_PROGRESSION:
HUNTER_RESULT:
BODYGUARD_RESULT:
SEER_RESULTS:
FINAL_WINNER:
COMPLETION_STATUS:
READ_ONLY_CHECK:
ARTIFACTS:
DEFECTS_OR_BLOCKERS:
```

If any player sees another player’s private role or hidden outcome data, stop immediately, preserve the evidence, and report the issue as a blocker. If the run completes, do not create a second game or rerun the broader suite.

---
