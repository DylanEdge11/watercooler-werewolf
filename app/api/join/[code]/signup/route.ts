import { getDb } from '../../../../../db';
import { changes } from '../../../../../db/results';
import { ensureDatabase } from '../../../../../db/migrate';
import { JOIN_COPY } from '../../../../../lib/game/join-copy';
import { honeypotFilled, MAX_OPEN_SIGNUPS, parsePerson } from '../../../../../lib/game/signups';
import { HttpError, jsonError, routeError } from '../../../../../lib/http/errors';
import { enforceRateLimit, requestRateLimitKey } from '../../../../../lib/http/rate-limit';
import { assertSameOrigin } from '../../../../../lib/http/security';
import { lookupJoinPage } from '../../../../../lib/join/lookup';

interface RouteContext {
  params: Promise<{ code: string }>;
}

/**
 * A visitor asks to play. The reply is the same whether or not the email was already on the list
 * or the roster, so the page can't be used to find out who has signed up, and no email is sent
 * to the address (a stranger can't use this to mail someone else). The person gets their private
 * seat link only once a moderator accepts them and sends invitations.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { code } = await context.params;
    // Several people at one office share an address, so the per-address allowance is generous; the
    // game-wide one stops a flood from anywhere.
    await enforceRateLimit(requestRateLimitKey(request, `signup:${code.slice(0, 80)}`), 60, 60 * 60_000);
    await enforceRateLimit(`signup-flood:${code.slice(0, 80)}`, 300, 60 * 60_000);
    const body: unknown = await request.json().catch(() => null);
    // A hidden field only a bot fills in: it gets the success reply and no row.
    if (honeypotFilled(body)) return Response.json({ ok: true });
    const person = parsePerson(body);
    if (!person.ok) return jsonError(person.error, 400);

    const page = await lookupJoinPage(code);
    if (!page) return jsonError(JOIN_COPY.invalidLink, 404);
    if (page.signups !== 'OPEN') return jsonError(JOIN_COPY.closed(page.gameName), 409);

    const db = getDb();
    const now = new Date().toISOString();
    const inserted = await db
      .prepare(
        `INSERT OR IGNORE INTO signups (id, game_id, display_name, email, status, created_at)
         SELECT ?, ?, ?, ?, 'PENDING', ?
         WHERE EXISTS (SELECT 1 FROM games WHERE id = ? AND signup_state = 'OPEN' AND status IN ('DRAFT', 'REGISTRATION'))
           AND (SELECT COUNT(*) FROM signups WHERE game_id = ? AND status != 'DECLINED') < ?
           AND NOT EXISTS (SELECT 1 FROM seats WHERE game_id = ? AND email = ? AND status != 'REMOVED')`,
      )
      .bind(crypto.randomUUID(), page.gameId, person.displayName, person.email, now, page.gameId, page.gameId, MAX_OPEN_SIGNUPS, page.gameId, person.email)
      .run();
    if (changes(inserted) === 0) {
      // Nothing was added: the list closed or filled up just now, or the person was already on it.
      const again = await lookupJoinPage(code);
      if (!again || again.signups !== 'OPEN') throw new HttpError(409, JOIN_COPY.closed(page.gameName));
      const total = await db
        .prepare("SELECT COUNT(*) AS count FROM signups WHERE game_id = ? AND status != 'DECLINED'")
        .bind(page.gameId)
        .first<{ count: number }>();
      if (Number(total?.count ?? 0) >= MAX_OPEN_SIGNUPS) throw new HttpError(409, JOIN_COPY.listFull);
    }
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error, 'Unable to sign up.');
  }
}
