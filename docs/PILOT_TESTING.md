# Pilot testing

For fictional local or isolated Preview games only. To learn normal play, use [How to Use Watercooler Werewolf](HOW_TO_USE_WATERCOOLER_WEREWOLF.md). Never use test helpers against Production or mix fictional players with a real roster.

## Prepare a local rehearsal

Use Node.js 24.x LTS. The package supports Node.js `>=24`; CI verifies Node 24.x. From `project`, follow [local setup](../VERCEL_SETUP_GUIDE.md#proof-a-run-everything-locally-with-dummy-data): configure a disposable database, run `npm ci`, `npm run db:migrate`, and `npm run owner:bootstrap`, then start `npm run dev`.

Keep that server running. In a second PowerShell window, provide the **same fictional moderator email/password used for bootstrap**:

```powershell
$env:PILOT_ALLOW_MUTATION = 'yes'
$env:PILOT_MODERATOR_EMAIL = 'owner@example.test'
# Set PILOT_MODERATOR_PASSWORD through your local secret/environment mechanism.
# It must match the bootstrapped fictional account and be at least 12 characters.
npm run pilot:setup
```

The helper defaults to `http://localhost:3000`, creates a 20-player fictional game, and writes a one-time invite CSV under `outputs/`. Store it privately. The helper imports the fixture for you; do not import it again unless deliberately replacing those invitations.

For an approved isolated Preview, use the [hosted runbook](PLAYWRIGHT_HOSTED_RUNBOOK.md) and verify the deployment/environment first. The pilot helper additionally requires `PILOT_BASE_URL` and `PILOT_ALLOW_REMOTE=yes` for remote use.

## Rehearse the whole game

Use the [user guide](HOW_TO_USE_WATERCOOLER_WEREWOLF.md) as the instructions under test. Give the moderator and each player a separate browser profile/context; private windows in the same browser may share a session.

1. Claim every fictional seat. Save counts, randomize, inspect the private assignments, and release roles.
2. Run Day, revise a vote, lock/calculate, review, and publish. Confirm only the latest saved response counts.
3. Run Night with wolves, Seer, and Bodyguard. Confirm protection and private exact-role results.
4. Exercise the Hunter window, a missed response, a boundary tie, and a reasoned override.
5. Check Pack/Mason/Afterlife access, eliminated-player restrictions, message moderation, notices, and feedback.
6. Check expired deadlines. After a published ordinary phase and a past cutoff, enter Final showdown; test a no-vote Final ballot and continue to victory.
7. Verify the winner, completed state, and read-only rooms. Export a backup.
8. In a separate disposable game, test Stop, owner-only Reset/restore, fresh invitations, and invalidation of old sessions. Completed games cannot be stopped.

For the scripted HTTP rehearsal, with the same fictional credentials available:

```text
npm run pilot:rehearsal
```

It covers claim/review/privacy/recovery paths and does not send invitations. It is a mutating rehearsal, not a read-only health check. Browser checks and their evidence are separate: [local suite](PLAYWRIGHT_READINESS.md), [hosted suite](PLAYWRIGHT_HOSTED_RUNBOOK.md), [recorded hosted results](PLAYWRIGHT_HOSTED_QA_REPORT.md).

## Release verification

From `project`:

```text
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm audit --omit=dev --audit-level=moderate
npm audit --json > audit-full.json
```

Review both dependency reports. Complete relevant browser/hosted checks for the candidate deployment and record its identity, results, and limitations. Historical passing reports do not certify a later deployment. A first-time human moderator should also rehearse with the user guide and record any step that needs outside explanation.
