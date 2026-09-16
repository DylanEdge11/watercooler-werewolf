# Technical Reference

This document preserves implementation details that are useful to maintainers but are too detailed for the main README.

## Runtime and database

Watercooler Werewolf requires Node.js 22.13 or newer and uses npm, Vinext, React, Cloudflare Workers, Cloudflare D1, and Drizzle.

The logical D1 binding is `DB`, configured in `.openai/hosting.json`. Wrangler/Miniflare stores local state under `.wrangler`.

`ensureDatabase()` applies the ordered checked-in migration registry before application queries run. Hosted deployments may provision those migrations before the Worker starts. Bootstrap recognizes a complete pre-provisioned schema, records it in the application ledger, applies only missing additive changes, and refuses to guess at or overwrite a partial initial schema.

The schema source is `db/schema.ts`. After schema changes:

```text
npm run db:generate
npx drizzle-kit check
```

Inspect and retain generated SQL and metadata under `drizzle/`. An unchanged schema should report "No schema changes"; do not apply duplicate generated migrations to an already-applied deployment.

Older D1 rows using the role key `DOCTOR` are migrated to the canonical `BODYGUARD` role.

## Time handling

Game deadlines are entered as local `datetime-local` values and converted server-side using the game's IANA timezone, including daylight-saving transitions. Stored `*_at` values are UTC ISO timestamps and displayed times use the viewer's locale.

Impossible dates and nonexistent DST-gap times are rejected. An ambiguous fall-back time uses the earlier occurrence.

## Phase engine

After role release, the first legal phase is `DAY`. Ordinary phases alternate `DAY → NIGHT → DAY`.

The resolution sequence is:

1. Moderator opens a legal phase with a future deadline.
2. Eligible players submit or revise actions.
3. Moderator locks responses and the deterministic engine proposes an outcome.
4. Hunter follow-up is collected when required.
5. Moderator approves the proposal or publishes a reasoned override.
6. Publication applies eliminations, private Seer results, room membership changes, timeline events, and win evaluation.

The engine keeps `proposedOutcome`, any `reviewedOutcome` used during Hunter follow-up, and the authoritative `publishedOutcome` separate. Override reason, reviewer, and review timestamp remain attached for audit.

Only the latest revision from each actor/action is counted. Invalid self-targets, dead targets, duplicate targets, and illegal faction targets are rejected server-side. Boundary ties use a recorded random draw included in the proposal/audit trail.

Stored weekday/day-night settings describe intended cadence; moderators still open phases. The scheduler does not create recurring phases or enforce weekdays. `AUTOMATIC` publication and the stored final-round duration are not wired into the review workflow.

## Final Showdown

Final Showdown is entered explicitly by a moderator after the configured final cutoff and after the latest ordinary phase has been published. It changes game status to `FINAL_SHOWDOWN`.

Only `FINAL_BALLOT` is legal in this state. It uses Day-style voting and the normal review, tie, no-vote, Hunter, elimination, and win rules. A winning publication completes the game. Otherwise the game remains in Final Showdown and another final ballot may be opened.

## Authentication and authorization

Moderator and player sessions use opaque HTTP-only cookies stored as hashes in D1. Passwords and six-digit PINs use salted PBKDF2-SHA256 at the Worker-supported 100,000-iteration maximum.

Every mutation performs same-origin checks plus server-side authorization and role/phase validation. Players receive only their own role, legal candidates, private results, permitted teammates, permitted rooms, and published events.

Werewolf, Mason, and Afterlife rooms enforce membership server-side. Eliminated faction members become read-only in their former room and receive access to Afterlife.

## Abuse controls

Pilot abuse controls are persisted in D1 and updated atomically. HTTP 429 responses include `Retry-After`.

- Moderator login: 5 attempts / 15 minutes
- Bootstrap: 3 / 15 minutes
- Player sign-in: 8 / 15 minutes
- Seat claiming: 3 / hour
- Player actions/private chat: 30 / 10 minutes
- Player feedback: 3 / hour
- Moderator feedback: 10 / hour

## Deadline monitoring

Operations polling reconciles deadlines as a fallback. For unattended monitoring, configure the private `WATERCOOLER_SCHEDULER_TOKEN` secret and invoke:

`POST /api/scheduler/deadlines`

once per minute with `Authorization: Bearer <token>`.

The endpoint returns HTTP 503 until the secret exists. It is retry-safe: due phases and their audit/operational events use conditional writes and stable IDs.

## Dependency/release notes

The compatible dependency set currently pins React/RSC 19.3.0, Vite 8.3.0, Vinext 1.0.0-beta.10, `@cloudflare/vite-plugin` 1.54.10, Wrangler 4.132.0, and lockfile-resolved peers.

At the documented audit snapshot, the production audit reported no production vulnerabilities. The full audit reported four moderate development-tool advisories through Drizzle Kit's deprecated esbuild loader. The available automated fix downgrades Drizzle Kit to 0.18.1 and is not accepted. Review this residual development-only exposure before each pilot.

See [../BUILD_STATUS.md](../BUILD_STATUS.md) for the current deployment checkpoint.
