# Watercooler Werewolf

Watercooler Werewolf is a web-based, slow-burn version of Werewolf designed for offices and other trusted groups. Instead of playing an entire game in one sitting, games run over multiple days with players submitting votes and role actions through a private web interface.

A moderator manages the game while each invited player claims a private seat and chooses a six-digit PIN. The application handles voting, role actions, private faction rooms, eliminations, announcements, game history, and win conditions.

> **Current status:** controlled pilot build. See [BUILD_STATUS.md](BUILD_STATUS.md) for the current deployment checkpoint.

## How the game works

A game supports **20–80 players** and normally alternates:

**Day → Night → Day → Night**

During the **Day**, living players vote to eliminate another player. During the **Night**, special roles perform actions such as Werewolf attacks, Bodyguard protection, and Seer investigations.

The moderator reviews each phase before publishing the result. Players may revise their response until the phase is locked; only their latest valid submission counts.

The game ends when:

- **Village wins:** no living Werewolves remain.
- **Werewolves win:** living Werewolves equal or outnumber all living Village players.

After the configured final cutoff, a moderator can explicitly enter **Final Showdown** and run Final Ballots until a faction wins.

## Roles

| Role | Faction | Ability |
| --- | --- | --- |
| Villager | Village | Votes during the Day but has no Night ability. |
| Werewolf | Werewolf | Knows the pack, uses the private Werewolf room, and votes on a Night attack. |
| Seer | Village | Investigates one other living player each Night and privately learns their exact role after publication. |
| Bodyguard | Village | Protects one other living player from one Werewolf attack each Night. |
| Hunter | Village | If eliminated, receives one final opportunity to eliminate another eligible living player. |
| Mason | Village | Knows the other Masons and can use the private Mason room. |

The canonical protective role is **Bodyguard**; Doctor is not a separate role.

The default 20-player composition is 12 Villagers, 3 Werewolves, 1 Seer, 1 Bodyguard, 1 Hunter, and 2 Masons. For other roster sizes, the default uses approximately one Werewolf per six players and fills remaining seats with Villagers.

Moderators can edit counts before role release. At least one Werewolf is required; Seer, Bodyguard, and Hunter are capped at one each; Masons must be zero or at least two; and total roles must equal the claimed roster size.

## Running a game

The normal moderator workflow is:

1. Create the game and configure its IANA timezone.
2. Import a roster of 20–80 unique email addresses.
3. Download and privately distribute the one-time invitation links.
4. Players claim their seats and choose six-digit PINs.
5. Configure and randomize the role composition.
6. Review the assignment evidence and release roles.
7. Open the first Day phase.
8. Lock, review, and publish each Day/Night result.
9. Continue until a faction wins or enter Final Showdown after the configured cutoff.

Role release is one-way until the game is Reset.

### User types

- **Owner/moderator:** full game administration, including owner-only Reset and Recovery Restore.
- **Co-moderator:** can operate an assigned game but cannot perform owner-only recovery actions.
- **Player:** claims one private seat and signs in using their seat code and PIN.

## Moderator features

Moderators can manage phases and deadlines, role assignments, player access, private rooms, announcements, message moderation, reviewed overrides, backups, operational status, and pilot feedback.

Important recovery controls:

- **Stop** ends active gameplay and makes the game read-only.
- **Reset** creates a backup and returns the selected game to setup while invalidating previous player sessions and claim links.
- **Recovery Restore** restores roster/configuration from a verified backup but intentionally generates fresh claim links and does not restore credentials, sessions, or role secrets.

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for detailed recovery, backup, room, and credential-recovery behavior.

## Local development

### Requirements

- Node.js 22.13+
- npm

Install and run:

```text
npm install
npm run dev
```

The local Vinext/Cloudflare preview uses D1 and creates/applies the required local schema on first use.

Do not commit passwords, invitation codes, tokens, or production values.

### Verify a build

```text
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm audit --omit=dev --audit-level=high
```

## Pilot testing

A fictional 20-player roster is provided at [fixtures/roster-20.csv](fixtures/roster-20.csv). Use it only with disposable `.test` accounts.

To create a disposable local pilot game in PowerShell:

```powershell
$env:PILOT_ALLOW_MUTATION = 'yes'
$env:PILOT_MODERATOR_PASSWORD = 'a-fictional-12-character-password'
npm run pilot:setup
```

Then run:

```text
npm run pilot:rehearsal
```

Never run the pilot helper against production data or mix the fictional fixture with a real roster.

See [docs/PILOT_TESTING.md](docs/PILOT_TESTING.md) for owner bootstrap, staging safeguards, the full manual show-and-play checklist, and release verification.

## Security and privacy

The public surface does not list games, rosters, roles, rooms, or audit data. Players receive only information they are authorized to see, and role/phase permissions are enforced server-side.

Moderator/player sessions use opaque HTTP-only cookies stored as hashes. Passwords and PINs are salted and hashed. Invite exports contain only the one-time claim information needed for delivery.

Backup exports are moderator-private and can contain role assignments and audit evidence, but do not contain plaintext credentials, session tokens, PIN/password hashes, or claim-code hashes.

Claim links and invite CSVs should always be distributed and stored privately.

For authentication, rate limits, D1/migration behavior, deadline handling, phase-engine details, and dependency notes, see [docs/TECHNICAL.md](docs/TECHNICAL.md).

## Technical overview

The application uses:

- Node.js
- Vinext / React
- Cloudflare Workers
- Cloudflare D1
- Drizzle

The D1 binding is `DB` in `.openai/hosting.json`. Database schema source is `db/schema.ts`, with checked-in migrations under `drizzle/`.

Game deadlines use the game's IANA timezone and are stored as UTC timestamps.

Announcements generate email-ready copy but **do not send email**.

Deadline reconciliation is available from the moderator Operations panel. An authenticated scheduler endpoint can optionally provide unattended deadline checks.

## Current scope and limitations

This build is intended for controlled pilot use. Do not claim production-scale performance readiness.

Currently outside supported scope:

- dedicated performance/load validation;
- real email delivery;
- external SSO;
- anonymous gameplay;
- native mobile clients; and
- production invitations unless separately approved and implemented.

## Documentation

- [Build Status](BUILD_STATUS.md) — current source/deployment checkpoint and release status.
- [Pilot Testing](docs/PILOT_TESTING.md) — fictional setup, rehearsal, manual pilot, and QA gates.
- [Operations & Recovery](docs/OPERATIONS.md) — backups, Stop, Reset, Recovery Restore, rooms, and credential recovery.
- [Technical Reference](docs/TECHNICAL.md) — database/migrations, time handling, phase engine, security controls, scheduler, and dependencies.
- [Fixture Guide](fixtures/README.md) — safe use of the fictional roster.
