import { getDb } from '@/db';
import { changes } from '@/db/results';
import { ensureDatabase } from '@/db/migrate';
import { requireGameOwner } from '@/lib/auth/authorization';
import { setupLinkExpired, canTakeApplications } from '@/lib/game/moderator-applications';
import { readSmtpSettings } from '@/lib/email/settings';
import { HttpError, routeError } from '@/lib/http/errors';
import { respondJsonWithEtag } from '@/lib/http/etag';
import { assertSameOrigin } from '@/lib/http/security';
import { joinLink, newJoinCode } from '@/lib/roster/signup-store';
import type { RouteContext } from '@/lib/http/route-context';

interface ApplicationRow {
  id: string;
  displayName: string;
  email: string;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  decidedAt: string | null;
  createdAt: string;
  joined: number;
}

async function loadApplicationsView(gameId: string, origin: string) {
  const db = getDb();
  const [game, rows] = await Promise.all([
    db
      .prepare('SELECT signup_code AS code, moderator_applications_open AS open FROM games WHERE id = ? LIMIT 1')
      .bind(gameId)
      .first<{ code: string | null; open: number }>(),
    db
      .prepare(
        `SELECT id, display_name AS displayName, email, note, status, decided_at AS decidedAt, created_at AS createdAt,
                (moderator_id IS NOT NULL) AS joined
         FROM moderator_applications WHERE game_id = ? ORDER BY created_at, id`,
      )
      .bind(gameId)
      .all<ApplicationRow>(),
  ]);
  if (!game) throw new HttpError(404, 'Game not found.');
  const now = new Date();
  return {
    open: Boolean(Number(game.open)),
    link: game.code ? joinLink(origin, game.code) : null,
    emailConfigured: readSmtpSettings() !== null,
    applications: rows.results.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      email: row.email,
      note: row.note ?? '',
      status: row.status,
      createdAt: row.createdAt,
      // An approved applicant is waiting on their link until they use it (joined) or it expires.
      joined: Boolean(Number(row.joined)),
      linkExpired: row.status === 'APPROVED' && !Number(row.joined) && setupLinkExpired(row.decidedAt, now),
    })),
  };
}

/** The applications to co-moderate this game. Only the owner adds co-moderators, so only the owner sees them. */
export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    await requireGameOwner(gameId, 'review moderator applications');
    return respondJsonWithEtag(request, { ok: true, ...(await loadApplicationsView(gameId, new URL(request.url).origin)) });
  } catch (error) {
    return routeError(error, 'Unable to load the applications.');
  }
}

/** Starts or stops taking applications through the game's public link. */
export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const owner = await requireGameOwner(gameId, 'take moderator applications');
    const body: unknown = await request.json().catch(() => null);
    const action = (body && typeof body === 'object' ? (body as { action?: unknown }).action : undefined);
    if (action !== 'OPEN' && action !== 'CLOSE') throw new Error('Choose OPEN or CLOSE.');

    const db = getDb();
    const game = await db.prepare('SELECT status, moderator_applications_open AS open FROM games WHERE id = ? LIMIT 1').bind(gameId).first<{ status: string; open: number }>();
    if (!game) throw new HttpError(404, 'Game not found.');
    const origin = new URL(request.url).origin;
    const open = action === 'OPEN';
    if (Boolean(Number(game.open)) === open) return Response.json({ ok: true, ...(await loadApplicationsView(gameId, origin)) });
    if (open) {
      const allowed = canTakeApplications(game.status);
      if (!allowed.allowed) throw new HttpError(409, allowed.error);
    }
    const now = new Date().toISOString();
    const results = await db.batch([
      db
        .prepare(
          `UPDATE games SET moderator_applications_open = ?, signup_code = COALESCE(signup_code, ?), updated_at = ?
           WHERE id = ? AND moderator_applications_open = ? ${open ? "AND status NOT IN ('CANCELLED', 'STOPPED', 'COMPLETED')" : ''}`,
        )
        .bind(open ? 1 : 0, newJoinCode(), now, gameId, open ? 0 : 1),
      db
        .prepare(
          `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
           SELECT ?, ?, ?, ?, '{}', ? WHERE EXISTS (SELECT 1 FROM games WHERE id = ? AND updated_at = ?)`,
        )
        .bind(crypto.randomUUID(), gameId, open ? 'MODERATOR_APPLICATIONS_OPENED' : 'MODERATOR_APPLICATIONS_CLOSED', owner.id, now, gameId, now),
    ]);
    if (changes(results[0]) !== 1) throw new HttpError(409, 'The game changed while you were editing it. Refresh and try again.');
    return Response.json({ ok: true, ...(await loadApplicationsView(gameId, origin)) });
  } catch (error) {
    return routeError(error, 'Unable to update moderator applications.');
  }
}
