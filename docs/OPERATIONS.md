# Operations and Recovery

Use this reference for recovery consequences. For button-by-button instructions and normal play, start with [How to Use Watercooler Werewolf](HOW_TO_USE_WATERCOOLER_WEREWOLF.md#help-and-recovery). Check **Selected game** before any operation; these controls are under **Communications & operations**.

## Rooms and announcements

Moderators can lock or reopen rooms, remove messages with a reason, purge messages beyond the configured retention period, and publish in-app announcements.

Announcements store email-ready subject/body text, but the application does not send email.

## Backups

JSON backups contain recoverable game state, including configuration, roster, role assignments, phases, actions, proposals, events, rooms, announcements, notifications, pilot feedback, and operational events.

Backups do **not** include PIN/password hashes, claim-code hashes, session tokens, or plaintext credentials.

Each backup receives a SHA-256 checksum and is stored as a moderator-only backup record. Historical removed seat rows may remain as audit references; restore re-imports only the current non-removed roster.

A local service restart retains the same SQLite file; Vercel uses persistent remote Turso/libSQL state. Export a backup before recovery operations.

## Stop

**Stop** is available to an authorized game moderator.

It requires explicit confirmation and a reason of at least five characters. Stop:

- changes the game to `STOPPED`;
- marks scheduled/open/review phases superseded;
- makes rooms read-only;
- blocks player actions and further gameplay; and
- displays a clear stopped-state message to players.

Stop is not a pause: there is no Resume control. Repeating Stop on an already stopped game has no additional effect. Completed and cancelled games cannot be stopped.

## Reset

**Reset** is owner-only and requires explicit confirmation plus the exact game name.

Before destructive changes, the application creates a recoverable backup. Reset is isolated to the selected game and:

- invalidates player sessions and old claim codes;
- returns seats to invited/living setup state;
- removes role assignments/counts/batches;
- removes phases, submissions, proposals, notifications, memberships, and chat messages;
- reopens empty rooms; and
- changes the game to `DRAFT`.

Existing event/audit history and the pre-reset backup remain. Re-importing a roster archives old seat rows rather than deleting referenced identities.

Reset does not resume the old game. Repeating Reset on a clean draft is harmless. Cancelled games cannot be reset. Re-import the roster before configuring roles again.

## Recovery Restore

Recovery Restore is an owner-only setup restore from a stored snapshot. It requires explicit confirmation and the exact game name.

The restore verifies checksum and game ID and creates a safety backup first. It restores the selected game's configuration, roster, and composition to `DRAFT`.

It deliberately clears active phases, role assignments, submissions, proposals, notifications, announcements, room memberships/messages, and player sessions. Existing audit/operational history and both backup records remain.

The UI selects an existing stored snapshot; it has no JSON-upload control. This restores setup, not a game in progress. Every restored seat receives a new one-time claim link. PINs, old claim links, role secrets, and sessions are never restored. Download the fresh invite CSV immediately because the codes are not shown again.

## Credential recovery

Bootstrap and co-moderator creation display eight one-time recovery codes exactly once. Store them in the operator's approved secret store; only salted hashes are kept in libSQL.

A moderator who forgets a password can use **Forgot password? Use a recovery code** to redeem one unused code, set a new password, and receive a new session. The code is single-use, the request is rate-limited, and previous moderator sessions are invalidated.

A forgotten player PIN is reset by an authorized moderator through **Player access recovery** in Operations. Deliver the new six-digit PIN privately. Previous player sessions are revoked.

There is no automatic email reset or temporary-password expiry promise.
