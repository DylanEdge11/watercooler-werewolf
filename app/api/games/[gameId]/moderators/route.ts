import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator, requireGameOwner } from '../../../../../lib/auth/authorization';
import { createModeratorAccount } from '../../../../../lib/auth/moderators';
import { assertSameOrigin } from '../../../../../lib/http/security';
import { HttpError, routeError } from '../../../../../lib/http/errors';
import { changes } from '../../../../../db/results';
import { isSingleEmailAddress } from '../../../../../lib/roster/email-address';
import { respondJsonWithEtag } from '../../../../../lib/http/etag';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    await requireGameModerator(gameId);
    const rows = await getDb()
      .prepare(
        `SELECT ma.id, ma.email, gm.role, gm.added_at AS addedAt
         FROM game_moderators gm JOIN moderator_accounts ma ON ma.id = gm.moderator_id
         WHERE gm.game_id = ? ORDER BY gm.role DESC, ma.email`,
      )
      .bind(gameId)
      .all();
    return respondJsonWithEtag(request, { ok: true, moderators: rows.results });
  } catch (error) {
    return routeError(error, 'Unable to load moderators.');
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const owner = await requireGameOwner(gameId, 'add co-moderators');
    const body = (await request.json()) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase() ?? '';
    if (!isSingleEmailAddress(email)) throw new Error('Enter a valid co-moderator email.');
    const db = getDb();
    let account = await db
      .prepare('SELECT id, email FROM moderator_accounts WHERE email = ? LIMIT 1')
      .bind(email)
      .first<{ id: string; email: string }>();
    let recoveryCodes: string[] = [];
    if (!account) {
      const created = await createModeratorAccount(email, body.password ?? '');
      account = { id: created.id, email: created.email };
      recoveryCodes = created.recoveryCodes;
    }
    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    // The event goes first, only while the caller still owns the game and the
    // account isn't already a moderator here; the membership follows the event.
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO game_events
           (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
           SELECT ?, ?, 'CO_MODERATOR_ADDED', ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM game_moderators WHERE game_id = ? AND moderator_id = ? AND role = 'OWNER')
             AND NOT EXISTS (SELECT 1 FROM game_moderators WHERE game_id = ? AND moderator_id = ?)`,
        )
        .bind(eventId, gameId, owner.id, JSON.stringify({ moderatorId: account.id, email: account.email }), now, gameId, owner.id, gameId, account.id),
      db
        .prepare(
          `INSERT INTO game_moderators (game_id, moderator_id, role, added_at)
           SELECT ?, ?, 'CO_MODERATOR', ? WHERE EXISTS (SELECT 1 FROM game_events WHERE id = ?)`,
        )
        .bind(gameId, account.id, now, eventId),
    ]);
    if (changes(results[0]) !== 1) throw new HttpError(409, `${account.email} is already a moderator of this game.`);
    return Response.json({ ok: true, moderator: account, recoveryCodes });
  } catch (error) {
    return routeError(error, 'Unable to add the co-moderator.');
  }
}
