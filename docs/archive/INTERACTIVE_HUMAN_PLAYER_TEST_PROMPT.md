# Interactive human-player acceptance test

Use this prompt to run one Watercooler Werewolf game with the user as a player and the assistant as moderator and bot operator. This is an interactive acceptance test, not an unattended simulation.

## Agreed configuration

- 20 player seats: one human, named `Human Player`, and 19 fictional bots. The moderator is separate.
- 11 Villagers, 4 Werewolves, 1 Seer, 1 Bodyguard, 1 Hunter, and 2 Masons. Confirm the application reports `BALANCED` (score -1). This score is a heuristic, not proof of competitive balance.
- For the next role walkthrough, deliberately assign `Human Player` the `WEREWOLF` role before release. Keep every other role randomized and hidden, and do not reroll after that valid assignment. This is an intentional role-coverage parameter, not a claim about ordinary random-role odds.
- Keep roles hidden during play. Release the spoiler audit only after the game ends or the human explicitly requests it.
- Preview origin: `https://watercooler-werewolf-8ssdpjq7y-dyl-edge.vercel.app`
- Expected deployment: `dpl_BBABEZrQ7tB5ArjZfhgtg1cEJKog`, project `watercooler-werewolf`, target `preview`, state `READY`.
- Never open or mutate Production. Do not reuse, reset, or alter another game, including the earlier completed 80-player QA game.

## Responsibilities and evidence

You operate the moderator account and all bot seats. The human needs only a player account. Use normal supported application routes and controls; no direct database writes or application changes.

The human performs their own UI actions. Do not claim their seat, choose/read their PIN, click their vote, select their ability target, send their chat messages, or submit actions for them. If asked to act on their behalf, distinguish that assisted action from human-performed testing.

Keep separate findings for:

1. **Server verified:** an action or state was confirmed from an authenticated application response and persisted after refresh.
2. **Browser observed:** the rendered interface behaved as expected.
3. **Human confirmed:** the human explicitly described or confirmed their experience.
4. **Not exercised / failed / blocked:** the observation is absent, failed, or cannot proceed.

Never turn silence, an API success, or your own screenshot into human confirmation. A passing scripted run does not prove all human flows pass.

## Safe, recoverable setup

1. Run the existing read-only Preview preflight. Verify exact deployment identity, access, and database-isolation evidence before creating data. State whether isolation evidence is current or inherited from the same deployment's recorded verification.
2. Load moderator credentials and protection headers through the secure environment mechanism. Keep all requests and browser contexts on the exact Preview origin. Stop if access cannot be verified.
3. Create one uniquely named interactive game with fictional emails and a future campaign cutoff. Save its ID immediately. Configure generous phase deadlines and resolve manually when the human is ready.
4. Import exactly 20 seats and deliberately save the agreed balanced composition. Preserve generated assignments; do not assign roles manually.
5. Give each bot an isolated authenticated session and a unique six-digit PIN. Save encrypted recovery checkpoints before claiming seats and before any later risky transition. Check that checkpoints can actually be decrypted. Never put PINs, seat codes, invite URLs, cookies, or bypass secrets into chat, screenshots, or public reports.
6. Open only the human's claim page in a visible, isolated browser window. Apply Preview access securely. Let the human choose their PIN and claim the seat. Do not show the moderator dashboard in their window.
7. Stop here and ask the human to confirm claiming and entering the game. All seats must be claimed before randomization. Offer an optional human sign-out/sign-in check using their private credentials.
8. After the human confirms, randomize and release roles, then let them inspect their role and permitted teammates/rooms. Record their confirmation before opening Day 1.

Keep human and bot access recoverable across conversation turns. Preserve encrypted state if the runner exits. Do not erase a game or create a replacement to hide a runner failure.

## Hidden-information bot play

Do not use the moderator's role map to make Village bots omniscient or force a predetermined winner. Each bot's decision input may contain only its own role, permitted teammates and private results, publicly revealed eliminations, and public conversation. Do not pass the full assignment map to the bot decision policy.

Werewolves may use their pack knowledge; Masons may use their permitted teammate knowledge; the Seer may use actual published private investigations. Other suspicions are uncertain. Use a documented, auditable policy and recorded randomness for tie choices. Do not target or spare the human merely because they are human.

Present a short, clearly labelled simulated bot discussion when useful. Distinguish simulated speech from messages actually posted through the application. Let the human question bots or make public claims through chat. Share those public statements consistently with the bot policy; never share a private human vote or role as public evidence. Explain that a shared moderator runner with filtered bot inputs is a test simulation, not independently isolated human intelligence.

## Human-paced phase loop

Do not run ahead. Handle one checkpoint at a time:

1. **Open:** report the public Day/Night, living count, legal slot count, and actual deadline. Explain only the human's permitted actions. Do not expose private bot actions or unpublished outcomes.
2. **Human action:** ask the human to use the app and report what happened. For their first ballot, invite them to save, change a target, save again, and refresh. Verify the final persisted choice without submitting it yourself. Allow explicit abstention if supported.
3. **Bots:** submit legal actions using each bot's limited information. All target selection must respect the server's candidates, no-self-target rule, living status, roles, and maximum slots. Treat slots as a maximum; do not invent extra eliminations when fewer candidates receive votes.
4. **Ready check:** ask whether the human is ready to resolve. Do not interpret a status question, ordinary discussion, or an action confirmation as permission to publish. If they need more time, continue only work that leaves their action window open.
5. **Resolve:** once explicitly authorized, lock/propose; complete any Hunter follow-up; review; publish. If the human is the Hunter, wait for their own shot and report its real deadline. A bot Hunter uses only its allowed knowledge. Do not publish before the required follow-up is finalized.
6. **Inspect:** refresh the moderator state and relevant player state, verify the tally and persisted effects, then ask the human what their UI shows. Share only public outcomes and their own permitted private results. Record server, browser, and human findings separately.
7. **Continue:** wait for the human's go-ahead before opening the next phase. End immediately at the application's terminal winner.

Conversation pauses do not freeze server timers. Use generous deadlines, state them accurately, and warn when a live response window may expire. Do not install a background monitor or keep advancing while the user is away. A user request to pause this test means stop assistant-driven progression; it does not automatically authorize the application's irreversible `STOP` operation.

If the human is eliminated, preserve the result. Verify spectating/read-only behavior and ask whether they want to continue observing. Do not resurrect them or replace their role to obtain more coverage.

## Acceptance checkpoints

Collect human observations for claiming/sign-in, role presentation, permitted room access if applicable, ballot controls and revisions, refresh persistence, the locked state, published outcomes, role-specific actions if applicable, elimination/spectating if it occurs, and completion/read-only behavior.

Other roles' powers can be server tested through bots but must remain **not human exercised**. Do not secretly switch the user's role or seat to claim broader coverage. A separate disclosed role walkthrough can be proposed afterward.

## Failure handling and known issue

Correct simple runner or plan logic errors and continue in the same game, logging the correction. For a new application defect, privacy leak, or blocker, stop progression, preserve evidence and encrypted recovery state, explain expected versus actual behavior without spoilers, and ask how to continue. Do not change application code or reset the game without explicit authorization.

The earlier QA run already found `QA80-UI-01`: completed screens can retain "Waiting for the moderator" / "Awaiting moderator" messaging and show Cycle 00. Record this as a known unresolved issue if reproduced; do not present it as a newly passing check. No fix has been deployed for this test.

## Reporting and start instruction

Maintain a human-safe progress log and a separately protected moderator audit. Record individual bot actions, rationale/allowed information, random choices, phase IDs, results, and every human confirmation. Keep the role map and private night details out of the public log during play.

After completion, summarize gameplay, bugs, runner limitations, and what the human did and did not verify. Provide the spoiler audit as agreed, without credentials. Do not label the entire test PASS while known reproduced UI defects remain.

Start by preflighting and creating the agreed game, then open the human claim page and stop for their first interaction. Do not complete a whole game in the initial turn.
