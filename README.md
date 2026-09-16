# Watercooler Werewolf

Watercooler Werewolf is an office-friendly game of Werewolf for **20–80 players**. It runs over several days: players submit votes and role actions on a website, and a moderator reviews and publishes each result.

> **Readiness — September 16, 2026:** the existing 75 tests and build checks pass, but this review found unresolved privacy and gameplay bugs. **Use fictional test games until the release blockers are fixed.** See the [review findings and verification results](docs/REVIEW_2026-09-16.md). The real-game instructions below describe the intended operating workflow; they are not a production sign-off.

- [Run a real game](#run-a-real-game)
- [Run a test game](#run-a-test-game)
- [Run the application locally](#run-the-application-locally)
- [Backups, recovery, and troubleshooting](#backups-recovery-and-troubleshooting)

## How the game works

The game starts with a **Day ballot**, then alternates **Day → Night → Day**.

| Role | What the player does |
| --- | --- |
| Villager | Votes during the Day. |
| Werewolf | Votes during the Day, chooses Night attack targets, and uses the private Pack room. |
| Seer | Investigates another living player at Night. The intended result is a private notification of that player's exact role after publication. |
| Bodyguard | Protects another living player from a Werewolf attack at Night. Cannot protect themselves. |
| Hunter | When selected for elimination, gets a final chance to shoot another eligible living player before the result is published. |
| Mason | Knows the other Masons and can use their private room. |

The Village wins when no living Werewolves remain. The Werewolves win when they equal or outnumber the other living players.

The default 20-player game has **12 Villagers, 3 Werewolves, 1 Seer, 1 Bodyguard, 1 Hunter, and 2 Masons**. Larger rosters use approximately one Werewolf per six players.

The default number of elimination slots is the living-player count divided by 30, rounded up: 1 slot for 1–30 living players, 2 for 31–60, and 3 for 61–80. Protection can prevent an attack; a Hunter shot can add an elimination. A boundary tie uses a recorded random draw. No valid votes means no voted elimination.

## Run a real game

### 1. Prepare the site and moderator account

Use a hosted instance that everyone can reach, after resolving the review findings and completing a fictional rehearsal. A localhost address only works on the computer running the app.

Open **`/moderator`** on your site.

- **Existing moderator:** sign in with your application email and password.
- **First moderator on a new instance:** the maintainer must configure `WATERCOOLER_OWNER_EMAIL` in the Worker's environment. Select **Verify site owner**, authenticate through the site's owner-verification service using that configured identity, then complete **Create moderator**.
- Use a moderator password of at least 12 characters. **Save the eight recovery codes immediately**; they are displayed once.

Owner verification requires the hosting service. Normal players use a seat code and PIN; the intended public pilot deployment does not require them to have ChatGPT accounts.

The **game owner** can add co-moderators in Operations. Co-moderators can run the game; adding moderators, Reset, and Restore are owner-only.

### 2. Create the campaign

On a fresh moderator account with no assigned games, complete **Schedule the campaign**:

1. Enter a recognizable game name.
2. Set the timezone, such as **`America/Regina`**.
3. Enter the start date, end date, and final cutoff.
4. Select **Create game**.

**Scheduling is manual:** the displayed weekday schedule does not open phases, publish results, or finish the game. Choose a deadline each time you open a phase.

**Console limitation:** once you have a game, there is no create-another-game button or game selector. Use a separate test instance. Reset clears the same game's progress; it does not preserve an old campaign.

### 3. Import the players and deliver their invitations

Prepare a CSV with exactly these column names and **20–80 players with unique email addresses**:

```csv
display_name,email
Alex Example,alex@example.test
Sam Example,sam@example.test
```

This two-row example shows the format; replace it with your complete roster.

1. In **Import the roster**, replace the sample text with your complete CSV.
2. Select **Create private seats**.
3. Select **Download invite CSV immediately**. The app cannot show those original codes again.
4. Privately send each player only their own `claim_url` and `invite_code`. Do not share the whole CSV with players.

The application prepares invitation text but **does not send email**.

Each player opens their claim link, chooses a six-digit PIN, and selects **Claim my seat**. Wait until the console shows every seat claimed.

**Keep the seat code for future logins.** Claiming is one-time; returning players use the same code and their PIN at **`/player-login`**. The dashboard is at **`/`**.

Re-importing replaces all current seats and invalidates their links and sessions. It does not append players and is blocked after role release.

### 4. Assign and release roles

1. In **Balance the roles**, review the counts.
2. If you change them, select **Save composition**. Counts must total the roster; Seer, Bodyguard, and Hunter are capped at one each; Masons must be zero or at least two; at least one Werewolf is required.
3. Once all seats are claimed, select **Randomize roles**.
4. Review the assignment list privately.
5. Select **Release roles to players** when ready.

Release reveals roles and makes the game active; you still open the first ballot manually. Later assignment changes require Reset or Restore and new setup.

Background refresh can overwrite unsaved role counts. Verify the saved counts before randomizing; see [R6](docs/REVIEW_2026-09-16.md#r6--p2-background-refresh-overwrites-unsaved-role-counts).

### 5. Run each Day and Night

Use **Run the live game**:

1. Choose the offered phase, starting with **Day ballot**. Enter a future deadline in the timezone shown beside the field, then select **Open phase**.
2. Players select their targets and press **Save response**. They may revise their response before the deadline or an early moderator lock. Only the latest saved revision counts.
3. When ready, select **Lock responses & calculate**. If the deadline monitor already locked the phase, select **Calculate locked responses**.
4. Review the tally, proposed eliminations, protection, and any tie draw.
5. If **Hunter follow-up required** appears, the Hunter must submit their shot. Select **Finalize Hunter** after submission, or after the response window expires to proceed without a shot. The default window is 60 minutes.
6. Select **Approve & publish**. Eliminations and their roles appear in the timeline, private results are delivered, and the winner is checked.
7. Open the next offered phase and repeat.

At Night, Werewolves choose attacks, the Bodyguard protects, and the Seer investigates. Other living roles wait. Eliminated players stop voting and can use Afterlife; eliminated Werewolves and Masons have read-only access to their former faction room.

**Known bug:** an override that newly selects the Hunter fails to display shooting controls. This needs a code fix.

Late responses are rejected even without a scheduler. Keep Operations open for ten-second deadline checks, or select **Check deadlines**. You still calculate and publish results. See the [optional scheduler](docs/TECHNICAL.md#deadline-monitoring) for unattended locking.

A moderator can use **Publish override** to change eliminations with a reason of at least 10 characters. This changes the official outcome and is recorded in the audit history.

### 6. Finish the campaign

The game completes when a published result produces a winner.

After the final cutoff, finish and publish the current Day or Night, then select **Enter final showdown**. Manually open a **Final ballot**, collect votes, calculate, and publish. Repeat final ballots until a faction wins.

Download a JSON backup when the campaign finishes.

## Run a test game

There is **no test-mode switch**. Use a disposable local instance or separate staging instance and database with [fixtures/roster-20.csv](fixtures/roster-20.csv). Test games perform real database writes.

### Option A: Practice through the website

1. Start the test instance and create its moderator account using the owner-verification process above.
2. Create a campaign clearly named **TEST — Practice game**.
3. Paste the complete fictional CSV into **Import the roster** and download its invitations.
4. Claim all 20 seats. Keep the moderator in one browser profile and player testing in another. A solo tester can sign out and sign back in with each seat's code and PIN; twenty devices are not required.
5. Assign roles, then practice Day voting and revisions, Night actions, ordinary Hunter follow-up, private rooms, announcements, and publication.
6. Test a past-due deadline and **Check deadlines**. Practice Final Showdown using a disposable game whose final cutoff has passed.
7. Download a backup, then practice Stop, Reset, and Restore only in this disposable environment.

Separate tabs share a login. Private windows in the same browser can also share a session; use different browser profiles for simultaneous players.

Use the [full pilot checklist](docs/PILOT_TESTING.md#manual-show-and-play) alongside the [known findings](docs/REVIEW_2026-09-16.md).

### Option B: Use the test helpers

Keep the local server running in one terminal. In a second terminal, open this project folder.

**First finish creating the test moderator in the browser and save its recovery codes.** The helpers cannot borrow your browser login. If local owner verification is unavailable, use a maintainer-configured test instance.

Set these variables to match that existing test account. The password below is a placeholder to replace.

Windows PowerShell:

```powershell
$env:PILOT_BASE_URL = 'http://localhost:3000'
$env:PILOT_MODERATOR_EMAIL = 'moderator@pilot.test'
$env:PILOT_MODERATOR_PASSWORD = 'replace-with-your-test-account-password'
$env:PILOT_ALLOW_MUTATION = 'yes'
npm run pilot:setup
```

macOS/Linux:

```bash
export PILOT_BASE_URL='http://localhost:3000'
export PILOT_MODERATOR_EMAIL='moderator@pilot.test'
export PILOT_MODERATOR_PASSWORD='replace-with-your-test-account-password'
export PILOT_ALLOW_MUTATION='yes'
npm run pilot:setup
```

`pilot:setup` creates a new game, imports the 20 fictional players, and writes `outputs/pilot-invites-<gameId>.csv`. It leaves claiming seats, assigning roles, and playing to you. Keep the invite file private.

For an automated rehearsal, use the same account variables and run:

```text
npm run pilot:rehearsal
```

This creates **another disposable game**, independently of `pilot:setup`. It claims 20 seats, exercises selected assignment/Hunter/Seer/recovery behaviors, then Stops, Resets, and re-imports a fresh unclaimed roster. Only an existing moderator account is required.

The rehearsal misses the privacy and Hunter-control bugs identified in this review. It does not check `PILOT_ALLOW_MUTATION`; running it performs writes.

Both helpers default to localhost. Use `PILOT_ALLOW_REMOTE=yes` only with a deliberately chosen, separate fictional staging URL. Never point either helper at a real-game instance. Keep credentials and generated invitations out of Git.

## Run the application locally

For maintainers and local testers:

1. Install **Node.js 22.13 or newer**, npm, and Git.
2. Clone the repository and install the locked dependencies:

```text
git clone https://github.com/DylanEdge11/watercooler-werewolf.git
cd watercooler-werewolf
npm ci
npm run dev
```

3. Open the local URL printed by the server, normally `http://localhost:3000`.
4. Leave that terminal running. Stop it with **Ctrl+C**.

The private GitHub repository requires access through your own account. Local preview uses Vinext and Cloudflare D1; the app applies its checked-in database migrations on first use. Local D1 state persists under `.wrangler`. Deleting that folder can delete your local game data.

A clone does not include hosted data, secrets, or a moderator. First-account setup still needs the owner-verification service and `WATERCOOLER_OWNER_EMAIL` Worker binding. [.env.example](.env.example) contains reference values only.

### Check a build

```text
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm audit --omit=dev --audit-level=high
npm audit
```

These commands do not run the interactive rehearsal. The last command includes development tools and currently reports four moderate advisories. Do not blindly run `npm audit fix --force`; its suggested Drizzle Kit change is a downgrade.

The app uses **React/Vinext, Cloudflare Workers, Cloudflare D1, and Drizzle**. The logical database binding is `DB` in `.openai/hosting.json`; schema source is `db/schema.ts`, and migrations are under `drizzle/`. A successful local build is not a deployment. See [BUILD_STATUS.md](BUILD_STATUS.md) for historical deployment notes and the [technical reference](docs/TECHNICAL.md) for implementation details.

For the optional deadline scheduler, the correct secret name is **`WATERCOOLER_SCHEDULER_TOKEN`**. The `SCHEDULER_SECRET` comment currently in `.env.example` does not match the code.

## Backups, recovery, and troubleshooting

| Situation or control | What to do / what happens |
| --- | --- |
| Player forgot their PIN | Use **Player access recovery → Reset player PIN**, provide a new six-digit PIN and a reason, and deliver it privately. Previous sessions are revoked. |
| Player lost their seat code | Retrieve their original private invitation or saved invite CSV. A PIN reset does not replace the seat code. |
| Moderator forgot their password | Use **Forgot password? Use a recovery code** with an unused saved code. Previous moderator sessions are revoked. |
| Randomize roles is unavailable | All 20–80 seats must be claimed. Verify the saved role counts match the roster. |
| Players are waiting after a deadline | Calculate the locked responses, finish any Hunter follow-up, and publish the result. |
| **Download JSON backup** | Saves game data and audit history, including private roles and messages. Treat it as moderator-private. It excludes credential hashes and session tokens. |
| **Stop** | Ends active play and makes rooms read-only. This is not a resumable pause. A known race allows an already in-flight chat message to finish; see the review. |
| **Reset** — owner only | Creates a backup, clears gameplay, invalidates sessions/invites, and returns the same game to setup. Type the exact name and confirm. Re-import the intended roster immediately before continuing. |
| **Restore to setup** — owner only | Uses a stored backup from that same game to rebuild configuration, roster, and composition. It clears active gameplay and creates fresh claim links. Select **Download fresh invites** immediately. |

**Restore does not resume a game at its saved round.** The UI selects backups already stored in the database; it does not upload an arbitrary downloaded JSON file. Reset also has a known archived-roster defect, so do not use the intermediate post-Reset roster as a new backup source before re-importing the intended roster.

Announcements appear in the app; email delivery is manual. Chat retention is applied through **Purge expired**, rather than an automatic deletion timer.

For more detail:

- [Review — September 16, 2026](docs/REVIEW_2026-09-16.md): current findings, evidence, and verification limits.
- [Pilot testing](docs/PILOT_TESTING.md): extended rehearsal checklist.
- [Operations and recovery](docs/OPERATIONS.md): operational procedures and backup behavior.
- [Technical reference](docs/TECHNICAL.md): authentication, migrations, timezones, phase engine, and scheduler.
- [Fixture guide](fixtures/README.md): fictional roster usage.

Older documentation records prior checks and intended behavior; the current review qualifies those claims. Hosted browser/accessibility and load testing remain outstanding. External SSO, automatic email, and native mobile apps are outside current scope.
