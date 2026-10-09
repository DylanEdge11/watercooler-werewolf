import { getDb } from '@/db';
import { changes } from '@/db/results';
import { ensureDatabase } from '@/db/migrate';
import { requireGameModerator } from '@/lib/auth/authorization';
import { canOpenSignups, parseSignupNote } from '@/lib/game/signups';
import { HttpError, routeError } from '@/lib/http/errors';
import { respondJsonWithEtag } from '@/lib/http/etag';
import { assertSameOrigin } from '@/lib/http/security';
import { loadSignupsView, newJoinCode } from '@/lib/roster/signup-store';
import type { RouteContext } from '@/lib/http/route-context';

const SETUP_STATUSES = "('DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW')";

/** The sign-up list and the public link, for the console's Sign-ups card. */
export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    await requireGameModerator(gameId);
    return respondJsonWithEtag(request, { ok: true, ...(await loadSignupsView(gameId, new URL(request.url).origin)) });
  } catch (error) {
    return routeError(error, 'Unable to load the sign-ups.');
  }
}

type Action = 'OPEN' | 'CLOSE' | 'SET_NOTE' | 'ROTATE_LINK';
const ACTIONS: readonly string[] = ['OPEN', 'CLOSE', 'SET_NOTE', 'ROTATE_LINK'] satisfies Action[];

/**
 * Opens or closes sign-ups, saves the note shown on the public page, or replaces the public link
 * (the old one stops working). Each change is one guarded write that also records its audit event.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body: unknown = await request.json().catch(() => null);
    const raw = (body && typeof body === 'object' ? body : {}) as { action?: unknown; note?: unknown };
    if (typeof raw.action !== 'string' || !ACTIONS.includes(raw.action)) throw new Error('Choose an action: OPEN, CLOSE, SET_NOTE, or ROTATE_LINK.');
    const action = raw.action as Action;

    const db = getDb();
    const game = await db
      .prepare(
        `SELECT status, signup_state AS state, signup_code AS code,
                EXISTS (SELECT 1 FROM role_assignments WHERE game_id = games.id) AS released
         FROM games WHERE id = ? LIMIT 1`,
      )
      .bind(gameId)
      .first<{ status: string; state: string; code: string | null; released: number }>();
    if (!game) throw new HttpError(404, 'Game not found.');

    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const event = (type: string, stateGuard: string) => db
      .prepare(
        `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
         SELECT ?, ?, ?, ?, '{}', ? WHERE EXISTS (SELECT 1 FROM games WHERE id = ? AND updated_at = ? AND ${stateGuard})`,
      )
      .bind(eventId, gameId, type, moderator.id, now, gameId, now);
    const origin = new URL(request.url).origin;
    const view = async () => Response.json({ ok: true, ...(await loadSignupsView(gameId, origin)) });
    const lost = () => new HttpError(409, 'The game changed while you were editing it. Refresh and try again.');

    if (action === 'OPEN') {
      if (game.state === 'OPEN') return view();
      const decision = canOpenSignups(game.status, Boolean(Number(game.released)));
      if (!decision.allowed) throw new HttpError(409, decision.error);
      const results = await db.batch([
        db
          .prepare(
            `UPDATE games SET signup_state = 'OPEN', signup_code = COALESCE(signup_code, ?), updated_at = ?
             WHERE id = ? AND signup_state = ? AND status IN ('DRAFT', 'REGISTRATION')
               AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = games.id)`,
          )
          .bind(newJoinCode(), now, gameId, game.state),
        event('SIGNUPS_OPENED', "signup_state = 'OPEN'"),
      ]);
      if (changes(results[0]) !== 1) throw lost();
      return view();
    }

    if (action === 'CLOSE') {
      if (game.state === 'CLOSED') return view();
      if (game.state !== 'OPEN') throw new HttpError(409, 'Sign-ups are not open.');
      const results = await db.batch([
        db.prepare("UPDATE games SET signup_state = 'CLOSED', updated_at = ? WHERE id = ? AND signup_state = 'OPEN'").bind(now, gameId),
        event('SIGNUPS_CLOSED', "signup_state = 'CLOSED'"),
      ]);
      if (changes(results[0]) !== 1) throw lost();
      return view();
    }

    if (action === 'SET_NOTE') {
      const note = parseSignupNote(raw.note);
      if (!note.ok) throw new Error(note.error);
      const result = await db
        .prepare(`UPDATE games SET signup_note = ?, updated_at = ? WHERE id = ? AND status IN ${SETUP_STATUSES}`)
        .bind(note.note || null, now, gameId)
        .run();
      if (changes(result) !== 1) throw new HttpError(409, 'The note can be changed only before the game starts.');
      return view();
    }

    // ROTATE_LINK
    if (!game.code) throw new HttpError(409, 'There is no link to replace yet. Open sign-ups first.');
    const results = await db.batch([
      db.prepare('UPDATE games SET signup_code = ?, updated_at = ? WHERE id = ? AND signup_code = ?').bind(newJoinCode(), now, gameId, game.code),
      event('SIGNUP_LINK_REPLACED', 'signup_code IS NOT NULL'),
    ]);
    if (changes(results[0]) !== 1) throw lost();
    return view();
  } catch (error) {
    return routeError(error, 'Unable to update sign-ups.');
  }
}
