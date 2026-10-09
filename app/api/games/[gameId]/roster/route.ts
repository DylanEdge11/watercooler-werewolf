import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { randomToken, sha256 } from '../../../../../lib/auth/crypto';
import { defaultComposition } from '../../../../../lib/game/balance';
import { ROLE_CATALOG } from '../../../../../lib/game/catalog';
import { ROLE_KEYS } from '../../../../../lib/game/types';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { HttpError, routeError } from '../../../../../lib/http/errors';
import { respondJsonWithEtag } from '../../../../../lib/http/etag';
import { createInviteExport, parseRosterCsv } from '../../../../../lib/roster/csv';
import { loadRosterView } from '../../../../../lib/game/setup-view';
import { appendToRoster } from '../../../../../lib/roster/append-roster';
import { changes } from '../../../../../db/results';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    await requireGameModerator(gameId);
    return respondJsonWithEtag(request, { ok: true, ...(await loadRosterView(gameId)) });
  } catch (error) {
    return routeError(error, 'Unable to load the roster.');
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body = (await request.json()) as { csv?: string; mode?: unknown; expectedSeatCount?: unknown };
    // Without a mode the list replaces the roster, as it always has. ADD keeps everyone already on it.
    if (body.mode !== undefined && body.mode !== 'ADD' && body.mode !== 'REPLACE') throw new Error('Choose ADD or REPLACE.');
    const adding = body.mode === 'ADD';
    // A replace can say how many players the moderator was looking at, so a page that has gone stale cannot wipe a roster it never saw.
    if (body.expectedSeatCount !== undefined && (!Number.isInteger(body.expectedSeatCount) || Number(body.expectedSeatCount) < 0)) throw new Error('expectedSeatCount must be a whole number.');
    const expectedSeatCount = body.expectedSeatCount === undefined ? null : Number(body.expectedSeatCount);
    const parsed = parseRosterCsv(body.csv ?? '', adding ? { minPlayers: 1 } : {});
    if (parsed.errors.length) {
      return Response.json({ ok: false, errors: parsed.errors }, { status: 400 });
    }
    if (adding) {
      const added = await appendToRoster({ gameId, moderatorId: moderator.id, entries: parsed.entries, origin: new URL(request.url).origin });
      return Response.json({ ok: true, ...added, inviteCsv: createInviteExport(added.invites) });
    }

    const db = getDb();
    const game = await db
      .prepare('SELECT status, setup_revision AS setupRevision FROM games WHERE id = ? LIMIT 1')
      .bind(gameId)
      .first<{ status: string; setupRevision: number }>();
    if (!game) throw new HttpError(404, 'Game not found.');
    if (!['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW'].includes(game.status)) {
      throw new Error('The roster cannot be replaced after the game becomes active.');
    }
    const released = await db
      .prepare('SELECT COUNT(*) AS count FROM role_assignments WHERE game_id = ?')
      .bind(gameId)
      .first<{ count: number }>();
    if (Number(released?.count ?? 0) > 0) {
      throw new Error('The roster cannot be replaced after roles have been released.');
    }

    const existingSeats = await db
      .prepare("SELECT id FROM seats WHERE game_id = ? AND status != 'REMOVED'")
      .bind(gameId)
      .all<{ id: string }>();

    if (expectedSeatCount !== null && existingSeats.results.length !== expectedSeatCount) {
      return jsonError(`The roster changed while you were on this page: it has ${existingSeats.results.length} ${existingSeats.results.length === 1 ? 'player' : 'players'} now, but you were looking at ${expectedSeatCount}. Nothing was replaced. Check the roster, then try again.`, 409);
    }

    const now = new Date().toISOString();
    const origin = new URL(request.url).origin;
    const invites = await Promise.all(
      parsed.entries.map(async (entry) => {
        const seatCode = randomToken(9);
        return {
          id: crypto.randomUUID(),
          ...entry,
          seatCode,
          codeHash: await sha256(seatCode),
          claimUrl: `${origin}/claim/${encodeURIComponent(seatCode)}`,
        };
      }),
    );
    const composition = defaultComposition(invites.length);
    const expectedRevision = Number(game.setupRevision ?? 1);
    const nextRevision = expectedRevision + 1;
    const setupGuard = `EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = ? AND g.setup_revision = ? AND g.status = 'ROSTER_IMPORTING'
        AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = g.id)
    )`;
    const statements = [
      db
        .prepare(
          `UPDATE games SET status = 'ROSTER_IMPORTING', setup_revision = setup_revision + 1, updated_at = ?
           WHERE id = ? AND setup_revision = ? AND status IN ('DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW')
             AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = games.id)`,
        )
        .bind(now, gameId, expectedRevision),
      db.prepare(`DELETE FROM assignment_batches WHERE game_id = ? AND ${setupGuard}`).bind(gameId, gameId, nextRevision),
      db.prepare(`DELETE FROM game_role_counts WHERE game_id = ? AND ${setupGuard}`).bind(gameId, gameId, nextRevision),
    ];
    const archiveHashes = await Promise.all(existingSeats.results.map(async (seat) => ({ id: seat.id, hash: await sha256(randomToken(18)) })));
    for (const archived of archiveHashes) {
      statements.push(
        db
          .prepare(
            `UPDATE seats SET status = 'REMOVED', email = 'archived+' || id || '@invalid.test',
                              claim_code_hash = ?, pin_hash = NULL, session_version = session_version + 1,
                              alive = 0, claimed_at = NULL, updated_at = ?
             WHERE id = ? AND game_id = ? AND ${setupGuard}`,
          )
          .bind(archived.hash, now, archived.id, gameId, gameId, nextRevision),
        db.prepare(`DELETE FROM seat_sessions WHERE seat_id = ? AND ${setupGuard}`).bind(archived.id, gameId, nextRevision),
      );
    }
    // Replacing the roster archives every seat, including those made from sign-ups; those people go back to waiting.
    statements.push(
      db
        .prepare(
          `UPDATE signups SET status = 'PENDING', seat_id = NULL, decided_at = NULL, decided_by_moderator_id = NULL
           WHERE game_id = ? AND status = 'ACCEPTED' AND ${setupGuard}`,
        )
        .bind(gameId, gameId, nextRevision),
    );
    for (const invite of invites) {
      statements.push(
        db
          .prepare(
            `INSERT INTO seats
             (id, game_id, display_name, email, status, claim_code_hash, session_version, alive, created_at, updated_at)
             SELECT ?, ?, ?, ?, 'INVITED', ?, 1, 1, ?, ? WHERE ${setupGuard}`,
          )
          .bind(invite.id, gameId, invite.displayName, invite.email, invite.codeHash, now, now, gameId, nextRevision),
      );
    }
    // Anyone on the new list who had signed up (waiting, declined, or accepted before) is on the roster now, so the sign-up list says so.
    statements.push(
      db
        .prepare(
          `UPDATE signups
           SET status = 'ACCEPTED', decided_at = ?, decided_by_moderator_id = ?,
               seat_id = (SELECT s.id FROM seats s WHERE s.game_id = signups.game_id AND s.email = signups.email AND s.status != 'REMOVED' LIMIT 1)
           WHERE game_id = ? AND status != 'ACCEPTED'
             AND EXISTS (SELECT 1 FROM seats s WHERE s.game_id = signups.game_id AND s.email = signups.email AND s.status != 'REMOVED')
             AND ${setupGuard}`,
        )
        .bind(now, moderator.id, gameId, gameId, nextRevision),
    );
    for (const roleKey of ROLE_KEYS) {
      statements.push(
        db
          .prepare(
            `INSERT INTO game_role_counts (game_id, role_key, count, power_snapshot)
             SELECT ?, ?, ?, ? WHERE ${setupGuard}`,
          )
          .bind(gameId, roleKey, composition[roleKey], ROLE_CATALOG[roleKey].power, gameId, nextRevision),
      );
    }
    statements.push(
      // Record the import while setupGuard still holds, before clearing the claim.
      db
        .prepare(
          `INSERT INTO game_events
           (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
           SELECT ?, ?, 'ROSTER_IMPORTED', ?, ?, ? WHERE ${setupGuard}`,
        )
        .bind(
          crypto.randomUUID(),
          gameId,
          moderator.id,
          JSON.stringify({ playerCount: invites.length }),
          now,
          gameId,
          nextRevision,
        ),
      db
        .prepare(
          `UPDATE games SET status = 'REGISTRATION', updated_at = ?
           WHERE id = ? AND setup_revision = ? AND status = 'ROSTER_IMPORTING'
             AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = games.id)`,
        )
        .bind(now, gameId, nextRevision),
    );
    const result = await db.batch(statements);
    if (changes(result[0]) !== 1) {
      return jsonError('The game changed while the roster was being replaced. Refresh and try again.', 409);
    }

    const inviteRows = invites.map((invite) => ({
      displayName: invite.displayName,
      email: invite.email,
      claimUrl: invite.claimUrl,
      inviteCode: invite.seatCode,
    }));
    return Response.json({
      ok: true,
      playerCount: inviteRows.length,
      composition,
      invites: inviteRows,
      inviteCsv: createInviteExport(inviteRows),
    });
  } catch (error) {
    return routeError(error, 'Unable to import the roster.');
  }
}
