import { getD1 } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { randomToken, sha256 } from '../../../../../lib/auth/crypto';
import { defaultComposition } from '../../../../../lib/game/balance';
import { ROLE_CATALOG } from '../../../../../lib/game/catalog';
import { ROLE_KEYS } from '../../../../../lib/game/types';
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
    return Response.json({ ok: true, roster: roster.results, composition: composition.results });
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
      .prepare('SELECT status FROM games WHERE id = ? LIMIT 1')
      .bind(gameId)
      .first<{ status: string }>();
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

    const statements: D1PreparedStatement[] = [
      db.prepare('DELETE FROM assignment_batches WHERE game_id = ?').bind(gameId),
      db.prepare('DELETE FROM game_role_counts WHERE game_id = ?').bind(gameId),
      db.prepare('DELETE FROM seats WHERE game_id = ?').bind(gameId),
    ];
    for (const invite of invites) {
      statements.push(
        db
          .prepare(
            `INSERT INTO seats
             (id, game_id, display_name, email, status, claim_code_hash, session_version, alive, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'INVITED', ?, 1, 1, ?, ?)`,
          )
          .bind(invite.id, gameId, invite.displayName, invite.email, invite.codeHash, now, now),
      );
    }
    for (const roleKey of ROLE_KEYS) {
      statements.push(
        db
          .prepare(
            `INSERT INTO game_role_counts (game_id, role_key, count, power_snapshot)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(gameId, roleKey, composition[roleKey], ROLE_CATALOG[roleKey].power),
      );
    }
    statements.push(
      db
        .prepare("UPDATE games SET status = 'REGISTRATION', updated_at = ? WHERE id = ?")
        .bind(now, gameId),
      db
        .prepare(
          `INSERT INTO game_events
           (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
           VALUES (?, ?, 'ROSTER_IMPORTED', ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          gameId,
          moderator.id,
          JSON.stringify({ playerCount: invites.length }),
          now,
        ),
    );
    await db.batch(statements);

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
