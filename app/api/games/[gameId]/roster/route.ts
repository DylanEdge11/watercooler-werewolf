import { getD1 } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { randomToken, sha256 } from '../../../../../lib/auth/crypto';
import { defaultComposition } from '../../../../../lib/game/balance';
import { ROLE_CATALOG } from '../../../../../lib/game/catalog';
import { canonicalRoleKey, ROLE_KEYS } from '../../../../../lib/game/types';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { createInviteExport, parseRosterCsv } from '../../../../../lib/roster/csv';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    await requireGameModerator(gameId);
    const db = getD1();
    const roster = await db
      .prepare(
        `SELECT id, display_name AS displayName, email, status, claimed_at AS claimedAt
         FROM seats WHERE game_id = ? AND status != 'REMOVED'
         ORDER BY display_name COLLATE NOCASE`,
      )
      .bind(gameId)
      .all();
    const composition = await db
      .prepare(
        `SELECT role_key AS roleKey, count, power_snapshot AS powerSnapshot
         FROM game_role_counts WHERE game_id = ? ORDER BY role_key`,
      )
      .bind(gameId)
      .all();
    return Response.json({ ok: true, roster: roster.results, composition: composition.results.map((row) => ({ ...row, roleKey: canonicalRoleKey(String(row.roleKey)) })) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load the roster.', 401);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body = (await request.json()) as { csv?: string };
    const parsed = parseRosterCsv(body.csv ?? '');
    if (parsed.errors.length) {
      return Response.json({ ok: false, errors: parsed.errors }, { status: 400 });
    }

    const db = getD1();
    const game = await db
      .prepare('SELECT status, setup_revision AS setupRevision FROM games WHERE id = ? LIMIT 1')
      .bind(gameId)
      .first<{ status: string; setupRevision: number }>();
    if (!game) throw new Error('Game not found.');
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
    const statements: D1PreparedStatement[] = [
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
      db
        .prepare(
          `UPDATE games SET status = 'REGISTRATION', updated_at = ?
           WHERE id = ? AND setup_revision = ? AND status = 'ROSTER_IMPORTING'
             AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = games.id)`,
        )
        .bind(now, gameId, nextRevision),
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
    );
    const result = await db.batch(statements);
    if (Number(result[0]?.meta?.changes ?? 0) !== 1) {
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
    return jsonError(error instanceof Error ? error.message : 'Unable to import the roster.', 400);
  }
}
