import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { createModeratorAccount } from '../../../../../lib/auth/moderators';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
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
    return Response.json({ ok: true, moderators: rows.results });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load moderators.', 401);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const owner = await requireGameModerator(gameId);
    const ownerMembership = await getDb()
      .prepare("SELECT role FROM game_moderators WHERE game_id = ? AND moderator_id = ? AND role = 'OWNER'")
      .bind(gameId, owner.id)
      .first();
    if (!ownerMembership) throw new Error('Only the game owner can add co-moderators.');
    const body = (await request.json()) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase() ?? '';
    if (!/^\S+@\S+\.\S+$/u.test(email)) throw new Error('Enter a valid co-moderator email.');
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
    await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO game_moderators (game_id, moderator_id, role, added_at)
           VALUES (?, ?, 'CO_MODERATOR', ?)`,
        )
        .bind(gameId, account.id, now),
      db
        .prepare(
          `INSERT INTO game_events
           (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
           VALUES (?, ?, 'CO_MODERATOR_ADDED', ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), gameId, owner.id, JSON.stringify({ moderatorId: account.id, email: account.email }), now),
    ]);
    return Response.json({ ok: true, moderator: account, recoveryCodes });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to add the co-moderator.', 400);
  }
}
