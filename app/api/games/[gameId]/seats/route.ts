import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { randomToken, sha256 } from '../../../../../lib/auth/crypto';
import { canAddSeat } from '../../../../../lib/game/roster-edit';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { routeError } from '../../../../../lib/http/errors';
import { applySeatChange, loadEditableRoster } from '../../../../../lib/roster/edit-roster';
import { isSingleEmailAddress } from '../../../../../lib/roster/email-address';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

/** Adds one player to a roster that has not been randomized yet. */
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

    const snapshot = await loadEditableRoster(gameId);
    const size = canAddSeat(snapshot.seatCount);
    if (!size.allowed) return jsonError(size.error, 409);
    const db = getDb();
    const duplicate = await db
      .prepare("SELECT 1 AS found FROM seats WHERE game_id = ? AND email = ? AND status != 'REMOVED' LIMIT 1")
      .bind(gameId, email)
      .first();
    if (duplicate) return jsonError('A player with that email is already on the roster.', 409);

    const seatId = crypto.randomUUID();
    const inviteCode = randomToken(9);
    const codeHash = await sha256(inviteCode);
    const now = new Date().toISOString();
    const result = await applySeatChange({
      gameId,
      moderatorId: moderator.id,
      snapshot,
      delta: 1,
      eventType: 'SEAT_ADDED',
      eventPayload: { seatId },
      extraClaimCondition: {
        sql: "NOT EXISTS (SELECT 1 FROM seats s WHERE s.game_id = games.id AND s.email = ? AND s.status != 'REMOVED')",
        args: [email],
      },
      seatStatements: (guard, guardArgs) => [
        db
          .prepare(
            `INSERT INTO seats
             (id, game_id, display_name, email, status, claim_code_hash, session_version, alive, created_at, updated_at)
             SELECT ?, ?, ?, ?, 'INVITED', ?, 1, 1, ?, ? WHERE ${guard}`,
          )
          .bind(seatId, gameId, displayName, email, codeHash, now, now, ...guardArgs),
      ],
    });
    return Response.json({
      ok: true,
      seat: { id: seatId, displayName, email, status: 'INVITED' },
      claimUrl: `${new URL(request.url).origin}/claim/${encodeURIComponent(inviteCode)}`,
      inviteCode,
      ...result,
    });
  } catch (error) {
    return routeError(error, 'Unable to add the player.');
  }
}
