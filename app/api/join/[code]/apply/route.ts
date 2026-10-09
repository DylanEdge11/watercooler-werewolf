import { getDb } from '@/db';
import { changes } from '@/db/results';
import { ensureDatabase } from '@/db/migrate';
import { JOIN_COPY } from '@/lib/game/join-copy';
import { MAX_OPEN_APPLICATIONS, parseApplicationNote } from '@/lib/game/moderator-applications';
import { honeypotFilled, parsePerson } from '@/lib/game/signups';
import { HttpError, jsonError, routeError } from '@/lib/http/errors';
import { enforceRateLimit, requestRateLimitKey } from '@/lib/http/rate-limit';
import { assertSameOrigin } from '@/lib/http/security';
import { lookupJoinPage } from '@/lib/join/lookup';
import type { RouteContext } from '@/lib/http/route-context';

/**
 * A visitor asks to co-moderate. As with player sign-ups, the reply is the same whether or not
 * the email already applied (or already moderates this game), and nothing is emailed to the
 * address until the owner approves the application.
 */
export async function POST(request: Request, context: RouteContext<{ code: string }>) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { code } = await context.params;
    // One allowance per address for every link, counted before the code is looked up and never keyed by it, so
    // guessing codes cannot create bookkeeping rows.
    await enforceRateLimit(requestRateLimitKey(request, 'apply'), 10, 60 * 60_000);
    const page = await lookupJoinPage(code);
    if (!page) return jsonError(JOIN_COPY.invalidLink, 404);
    if (!page.applications) throw new HttpError(409, JOIN_COPY.applicationsClosed(page.gameName));
    const body: unknown = await request.json().catch(() => null);
    // A hidden field only a bot fills in: it gets the success reply and no row, and does not count toward the game's allowance.
    if (honeypotFilled(body)) return Response.json({ ok: true });
    const person = parsePerson(body);
    if (!person.ok) return jsonError(person.error, 400);
    const note = parseApplicationNote((body as { note?: unknown }).note);
    if (!note.ok) return jsonError(note.error, 400);
    // The game-wide allowance is keyed by the game, not by what the visitor typed, and only a request about to write counts.
    await enforceRateLimit(`apply-flood:${page.gameId}`, 40, 60 * 60_000);

    const db = getDb();
    const inserted = await db
      .prepare(
        `INSERT OR IGNORE INTO moderator_applications (id, game_id, display_name, email, note, status, created_at)
         SELECT ?, ?, ?, ?, ?, 'PENDING', ?
         WHERE EXISTS (SELECT 1 FROM games WHERE id = ? AND moderator_applications_open = 1 AND status NOT IN ('CANCELLED', 'STOPPED', 'COMPLETED'))
           AND (SELECT COUNT(*) FROM moderator_applications WHERE game_id = ? AND status != 'DECLINED') < ?
           AND NOT EXISTS (
             SELECT 1 FROM game_moderators gm JOIN moderator_accounts ma ON ma.id = gm.moderator_id
             WHERE gm.game_id = ? AND ma.email = ?
           )`,
      )
      .bind(crypto.randomUUID(), page.gameId, person.displayName, person.email, note.note || null, new Date().toISOString(), page.gameId, page.gameId, MAX_OPEN_APPLICATIONS, page.gameId, person.email)
      .run();
    if (changes(inserted) === 0) {
      const again = await lookupJoinPage(code);
      if (!again || !again.applications) throw new HttpError(409, JOIN_COPY.applicationsClosed(page.gameName));
      const total = await db
        .prepare("SELECT COUNT(*) AS count FROM moderator_applications WHERE game_id = ? AND status != 'DECLINED'")
        .bind(page.gameId)
        .first<{ count: number }>();
      if (Number(total?.count ?? 0) >= MAX_OPEN_APPLICATIONS) throw new HttpError(409, JOIN_COPY.applicationsFull);
    }
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error, 'Unable to send the application.');
  }
}
