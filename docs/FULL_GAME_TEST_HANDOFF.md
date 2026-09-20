# One-game manual QA handoff

## Objective

Run exactly one complete six-player game through the deployed Preview UI. This is the remaining useful manual check: the automated multiplayer suite intentionally uses 20 players, while the six-player application paths have already passed focused local coverage.

Do not rerun the full Playwright suite unless a new defect is found.

## Target and safety

- Preview: <https://watercooler-werewolf-21kmzkv1j-dyl-edge.vercel.app>
- Deployment: `dpl_BU6dMkHvU1cUFou477j2bBX184hC`
- Vercel target/status: `preview` / `READY`
- Database: isolated from Production; do not open or mutate either Production URL.
- Use only fictional, run-owned player names and `@e2e.test` email addresses.
- Never use a public reset/seed endpoint, delete shared data, or paste credentials into the final report.
- If the browser shows Vercel Deployment Protection, use the already configured Preview access mechanism. Do not weaken application login or authorization.

Required desktop browsers are Chrome and Edge. Safari/WebKit is optional coverage for iPhone-oriented follow-up. Firefox is not required.

## Credentials

Use the existing local `.env.e2e.local` file or the operator-provided secure credential mechanism. Do not print or copy the values into chat, screenshots, logs, or this document.

Required values are:

- Preview moderator email and password.
- Vercel Preview protection bypass secret, if the Preview is protected.

If those values are unavailable, stop and report `BLOCKED: credentials/access unavailable`; do not ask for secrets in chat.

## Already completed — do not repeat

| Area | Evidence |
| --- | --- |
| Six-player limits | Local tests reject 5 and 81; accept 6, 19, 20, and 80 |
| Small-game composition | Six players default to 1 Werewolf and 5 Villagers; exact 20-player composition is unchanged |
| Six-player lifecycle | Assignment/release, elimination-slot, victory, backup, and restore coverage passed locally |
| Moderator setup | Start-new-setup, game selection, draft preservation, safe cancellation, and stale-preview invalidation passed |
| Hosted API | 6/6 existing scenarios passed; all remained 20-player scenarios |
| Hosted Chromium/Chrome | 14/14 readiness scenarios passed, including privacy, Day/Night actions, revisions, locking/publication, ties, protection, Hunter, elimination/read-only, completion, reload/reconnect, setup navigation, and seeds 7/21/42 |
| Hosted Edge | Browser smoke passed 1/1 |
| Hosted WebKit/Safari proxy | Browser smoke passed 1/1; optional |
| Persistent rerun | Setup-navigation and smoke passed 2/2 against the already populated Preview database |

Detailed automated evidence is in [PLAYWRIGHT_HOSTED_QA_REPORT.md](C:/Users/dylan/Documents/ChatGPT/Werewolf/project/docs/PLAYWRIGHT_HOSTED_QA_REPORT.md).

## Test data

Create a unique run suffix, for example `manual-six-<UTC timestamp>`. Use exactly six roster rows:

```csv
display_name,email
Manual Player 01,manual-player-01-<suffix>@e2e.test
Manual Player 02,manual-player-02-<suffix>@e2e.test
Manual Player 03,manual-player-03-<suffix>@e2e.test
Manual Player 04,manual-player-04-<suffix>@e2e.test
Manual Player 05,manual-player-05-<suffix>@e2e.test
Manual Player 06,manual-player-06-<suffix>@e2e.test
```

Use a different six-digit PIN for every player. Keep invite URLs and PINs private and do not include them in the final report.

## Exact test flow

### 1. Create the setup

1. Open the Preview in Chrome or Edge and sign in as the moderator.
2. If an existing game is selected, use the visible `Start new setup` control. Do not edit or reset an active/completed game.
3. Create a uniquely named game, such as `Manual six-player <suffix>`.
4. Use a broad schedule that will not expire during the test.
5. Import the six-row CSV above and create private seats.
6. Confirm the moderator UI shows exactly `6` roster participants. The moderator must not be counted as a player.

Expected setup result: the game is in an unfinished registration/setup state, with six private seats and no released roles.

### 2. Confirm the six-player composition

1. Open the role-composition section.
2. Confirm the starting composition is exactly:

   - Werewolf: `1`
   - Villager: `5`
   - Seer, Bodyguard, Hunter, Mason: `0`

3. Save the composition and randomize/preview assignments.
4. Confirm the assignment preview contains six unique seats and exactly one Werewolf.
5. Release the roles only after the preview is correct.

The preset is a valid small-game starting point, not a claim of formal gameplay balance.

### 3. Onboard all six players

Use separate browser contexts or private windows so cookies and sessions cannot leak between players.

For each invite:

1. Open its claim URL.
2. Claim the seat with that player’s PIN.
3. Enter the game.
4. Sign out, then sign back in through the player login screen.
5. Confirm the player sees the private role area and the correct game name.

Privacy checks:

- A player must see only their own role.
- Villagers must not see moderator-only assignment evidence or hidden outcome data.
- No player may see another player’s PIN, session, private action, or role.
- The moderator remains able to see the complete roster and assignment state.

### 4. Complete one full game

Use the moderator’s known assignment to make the flow deterministic while still exercising a Day and a Night.

1. Open Day 1.
2. Have all six players submit a valid vote that eliminates a Villager, not the Werewolf.
3. Lock/review/publish the Day 1 outcome.
4. Confirm one Villager is eliminated and cannot submit further actions.
5. Open Night 1.
6. Have the Werewolf attack a different living Villager. There are no special-role actions in the six-player preset.
7. Lock/review/publish the Night 1 outcome.
8. Confirm the attacked Villager is eliminated and the remaining players receive the correct phase state.
9. Open Day 2.
10. Have the living players vote to eliminate the Werewolf.
11. Lock/review/publish the Day 2 outcome.
12. Confirm the game completes with a Village win.

Expected living-count progression is `6 → 5 → 4 → 3`. The final three players are Villagers, and no further player action controls should be available.

### 5. Completion and navigation checks

Confirm all of the following before ending the run:

- Moderator shows the game as completed with the correct winner.
- Eliminated players are read-only.
- Completed players cannot submit new actions.
- No private Night resolution fields or moderator-only outcome data appear in player responses or UI.
- The completed game remains selectable in the moderator game selector.
- `Start new setup` remains available without changing the completed game.
- Reloading the moderator page does not select the wrong game or erase any saved state.

## Evidence to record

Record only non-secret evidence:

- Test timestamp and browser (`Chrome` or `Edge`).
- Preview URL and deployment ID above.
- Game display name and game ID, if visible.
- Roster count: `6`.
- Composition counts: `1 Werewolf / 5 Villagers`.
- Claim result: `6/6` seats claimed.
- Phase transitions and living counts: `6 → 5 → 4 → 3`.
- Final result: `VILLAGE` win.
- Whether privacy, read-only, completion, reload, and game-selector checks passed.
- Paths to screenshots or trace artifacts, with invite URLs and PINs redacted.

Use this final summary format:

```text
RESULT: PASS | FAIL | BLOCKED
BROWSER:
PREVIEW_DEPLOYMENT:
GAME_ID_AND_NAME:
ROSTER_COUNT:
COMPOSITION:
CLAIMED_SEATS:
PHASES_AND_LIVING_COUNTS:
WINNER:
PRIVACY_CHECK:
READ_ONLY_CHECK:
COMPLETION_CHECK:
RELOAD_AND_GAME_SELECTOR_CHECK:
ARTIFACTS:
DEFECTS_OR_BLOCKERS:
```

If any player sees another player’s role/private data, stop immediately and report it as a blocker with the affected screen and redacted screenshot. Do not continue by weakening an assertion or resetting the game.
