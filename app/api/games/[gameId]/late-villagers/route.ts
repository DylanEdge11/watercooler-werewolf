import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { randomToken, sha256 } from '../../../../../lib/auth/crypto';
import { MAX_PLAYERS } from '../../../../../lib/game/player-count';
import { canAddLateVillager, LATE_JOIN_LAST_PHASE_SEQUENCE } from '../../../../../lib/game/roster-edit';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { HttpError, routeError } from '../../../../../lib/http/errors';
import { isSingleEmailAddress } from '../../../../../lib/roster/email-address';
import { changes } from '../../../../../db/results';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

/**
 * Adds one late joiner to a running game, during the first Day or Night only.
 * The new seat is always a Villager and joins quietly: no announcement, and the
 * audit event is visible to moderators only. The seat is unclaimed until the
 * player opens the private link returned here, so it counts toward votes and
 * win conditions only once claimed, like every other seat.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body: unknown = await request.json().catch(() => null);
    const raw = (body && typeof body === 'object' ? body : {}) as { displayName?: unknown; email?: unknown };
    const displayName = typeof raw.displayName === 'string' ? raw.displayName.trim() : '';
    const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
    if (!displayName || displayName.length > 80) return jsonError('Enter a display name of up to 80 characters.', 400);
    if (!isSingleEmailAddress(email)) return jsonError('Enter one plain email address, like name@example.com.', 400);

    const db = getDb();
    const game = await db
      .prepare(
        `SELECT status,
                EXISTS (SELECT 1 FROM role_assignments WHERE game_id = games.id) AS released,
                (SELECT COALESCE(MAX(sequence), 0) FROM phases WHERE game_id = games.id) AS latestSequence,
                (SELECT COUNT(*) FROM seats WHERE game_id = games.id AND status != 'REMOVED') AS seatCount
         FROM games WHERE id = ? LIMIT 1`,
      )
      .bind(gameId)
      .first<{ status: string; released: number; latestSequence: number; seatCount: number }>();
    if (!game) throw new HttpError(404, 'Game not found.');
    const decision = canAddLateVillager(game.status, Boolean(Number(game.released)), Number(game.latestSequence), Number(game.seatCount));
    if (!decision.allowed) return jsonError(decision.error, 409);

    const [seat, spectator] = await Promise.all([
      db.prepare("SELECT 1 AS found FROM seats WHERE game_id = ? AND lower(email) = ? AND status != 'REMOVED' LIMIT 1").bind(gameId, email).first(),
      db.prepare("SELECT 1 AS found FROM spectators WHERE game_id = ? AND lower(email) = ? AND status != 'REMOVED' LIMIT 1").bind(gameId, email).first(),
    ]);
    if (seat) return jsonError('A player with that email is already in this game.', 409);
    if (spectator) return jsonError('That email belongs to a spectator in this game. Remove them from Spectators first; players cannot also be spectators.', 409);

    const seatId = crypto.randomUUID();
    const inviteCode = randomToken(9);
    const codeHash = await sha256(inviteCode);
    const now = new Date().toISOString();
    const seatExists = 'EXISTS (SELECT 1 FROM seats WHERE id = ? AND game_id = ? AND status = \'INVITED\')';
    const result = await db.batch([
      // The seat goes in only if the game is still running, roles are released, the
      // second Day has not opened, and the email and player limit are still free.
      db
        .prepare(
          `INSERT INTO seats
           (id, game_id, display_name, email, status, claim_code_hash, session_version, alive, created_at, updated_at)
           SELECT ?, ?, ?, ?, 'INVITED', ?, 1, 1, ?, ?
           WHERE EXISTS (SELECT 1 FROM games WHERE id = ? AND status = 'ACTIVE')
             AND EXISTS (SELECT 1 FROM assignment_batches WHERE game_id = ? AND released_at IS NOT NULL)
             AND (SELECT COALESCE(MAX(sequence), 0) FROM phases WHERE game_id = ?) <= ?
             AND (SELECT COUNT(*) FROM seats WHERE game_id = ? AND status != 'REMOVED') < ?
             AND NOT EXISTS (SELECT 1 FROM seats WHERE game_id = ? AND lower(email) = ? AND status != 'REMOVED')
             AND NOT EXISTS (SELECT 1 FROM spectators WHERE game_id = ? AND lower(email) = ? AND status != 'REMOVED')`,
        )
        .bind(
          seatId, gameId, displayName, email, codeHash, now, now,
          gameId, gameId, gameId, LATE_JOIN_LAST_PHASE_SEQUENCE, gameId, MAX_PLAYERS, gameId, email, gameId, email,
        ),
      // Always a Villager, recorded against the released assignment batch.
      db
        .prepare(
          `INSERT INTO role_assignments (game_id, seat_id, role_key, assignment_batch_id)
           SELECT ?, ?, 'VILLAGER',
                  (SELECT id FROM assignment_batches WHERE game_id = ? AND released_at IS NOT NULL ORDER BY revision DESC LIMIT 1)
           WHERE ${seatExists}`,
        )
        .bind(gameId, seatId, gameId, seatId, gameId),
      // Keep the moderator's role counts in step with the seats.
      db
        .prepare(`UPDATE game_role_counts SET count = count + 1 WHERE game_id = ? AND role_key = 'VILLAGER' AND ${seatExists}`)
        .bind(gameId, seatId, gameId),
      db
        .prepare(
          `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
           SELECT ?, ?, 'LATE_VILLAGER_ADDED', ?, ?, ? WHERE ${seatExists}`,
        )
        .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ seatId, role: 'VILLAGER' }), now, seatId, gameId),
    ]);
    if (changes(result[0]) !== 1) {
      return jsonError('The game changed before the player could be added. Refresh and try again.', 409);
    }
    return Response.json({
      ok: true,
      seat: { id: seatId, displayName, email, status: 'INVITED', role: 'VILLAGER' },
      claimUrl: `${new URL(request.url).origin}/claim/${encodeURIComponent(inviteCode)}`,
      inviteCode,
    });
  } catch (error) {
    return routeError(error, 'Unable to add the late Villager.');
  }
}
