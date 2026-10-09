import { getDb } from '@/db';
import { changes } from '@/db/results';
import { ensureDatabase } from '@/db/migrate';
import { requireGameModerator } from '@/lib/auth/authorization';
import { randomToken, sha256 } from '@/lib/auth/crypto';
import { isPinLocked, pinFailureCounts } from '@/lib/auth/pin-lockout';
import { spectatorLockoutId } from '@/lib/auth/spectator-link';
import { canAddSpectator, SPECTATOR_JOIN_STATUSES } from '@/lib/game/spectators';
import { assertSameOrigin, jsonError } from '@/lib/http/security';
import { routeError } from '@/lib/http/errors';
import { respondJsonWithEtag } from '@/lib/http/etag';
import { isSingleEmailAddress } from '@/lib/roster/email-address';
import type { RouteContext } from '@/lib/http/route-context';

/** The game's spectators, for the moderator console, with whether each is locked out by wrong PINs. */
export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    await requireGameModerator(gameId);
    const rows = await getDb()
      .prepare(
        `SELECT id, display_name AS displayName, email, status, claimed_at AS claimedAt, created_at AS createdAt
         FROM spectators WHERE game_id = ? AND status != 'REMOVED'
         ORDER BY display_name COLLATE NOCASE`,
      )
      .bind(gameId)
      .all<{ id: string; displayName: string; email: string; status: string; claimedAt: string | null; createdAt: string }>();
    // Spectators who have had too many wrong PINs in a row, so the moderator can see who needs a PIN reset.
    const failures = await pinFailureCounts(getDb(), rows.results.map((row) => spectatorLockoutId(row.id)));
    return respondJsonWithEtag(request, { ok: true, spectators: rows.results.map((row) => ({ ...row, locked: isPinLocked(failures.get(spectatorLockoutId(row.id))) })) });
  } catch (error) {
    return routeError(error, 'Unable to load spectators.');
  }
}

/**
 * Adds one spectator to a running game and returns their private link. The
 * moderator sends the link; the spectator chooses a PIN when they open it.
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
    const game = await db.prepare('SELECT status FROM games WHERE id = ? LIMIT 1').bind(gameId).first<{ status: string }>();
    if (!game) return jsonError('Game not found.', 404);
    const decision = canAddSpectator(game.status);
    if (!decision.allowed) return jsonError(decision.error, 409);
    // A player's own address can't become a spectator: a living player would then read the Afterlife.
    const [seat, spectator] = await Promise.all([
      db.prepare("SELECT 1 AS found FROM seats WHERE game_id = ? AND lower(email) = ? AND status != 'REMOVED' LIMIT 1").bind(gameId, email).first(),
      db.prepare("SELECT 1 AS found FROM spectators WHERE game_id = ? AND email = ? AND status != 'REMOVED' LIMIT 1").bind(gameId, email).first(),
    ]);
    if (seat) return jsonError('That email belongs to a player in this game. Players cannot also be spectators.', 409);
    if (spectator) return jsonError('A spectator with that email is already in this game.', 409);

    const spectatorId = crypto.randomUUID();
    const inviteCode = randomToken(9);
    const now = new Date().toISOString();
    const statusList = SPECTATOR_JOIN_STATUSES.map(() => '?').join(', ');
    // The same checks again inside the write, so a game that stopped or a
    // duplicate added in the meantime changes nothing.
    const result = await db.batch([
      db
        .prepare(
          `INSERT INTO spectators
           (id, game_id, display_name, email, status, claim_code_hash, session_version, added_by_moderator_id, created_at, updated_at)
           SELECT ?, ?, ?, ?, 'INVITED', ?, 1, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM games WHERE id = ? AND status IN (${statusList}))
             AND NOT EXISTS (SELECT 1 FROM seats WHERE game_id = ? AND lower(email) = ? AND status != 'REMOVED')
             AND NOT EXISTS (SELECT 1 FROM spectators WHERE game_id = ? AND email = ? AND status != 'REMOVED')`,
        )
        .bind(spectatorId, gameId, displayName, email, await sha256(inviteCode), moderator.id, now, now, gameId, ...SPECTATOR_JOIN_STATUSES, gameId, email, gameId, email),
      db
        .prepare(
          `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
           SELECT ?, ?, 'SPECTATOR_ADDED', ?, ?, ? WHERE EXISTS (SELECT 1 FROM spectators WHERE id = ?)`,
        )
        .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ spectatorId }), now, spectatorId),
    ]);
    if (changes(result[0]) !== 1) return jsonError('The game or its spectators changed. Refresh and try again.', 409);
    return Response.json({
      ok: true,
      spectator: { id: spectatorId, displayName, email, status: 'INVITED', claimedAt: null, createdAt: now },
      spectateUrl: `${new URL(request.url).origin}/spectate/${encodeURIComponent(inviteCode)}`,
    });
  } catch (error) {
    return routeError(error, 'Unable to add the spectator.');
  }
}
