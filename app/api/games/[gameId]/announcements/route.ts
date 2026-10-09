import { getDb } from '@/db';
import { ensureDatabase } from '@/db/migrate';
import { requireGameModerator } from '@/lib/auth/authorization';
import { assertSameOrigin } from '@/lib/http/security';
import { routeError } from '@/lib/http/errors';
import type { RouteContext } from '@/lib/http/route-context';

export async function GET(_request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    await requireGameModerator(gameId);
    const rows = await getDb()
      .prepare(
        `SELECT id, title, body, email_subject AS emailSubject, email_body AS emailBody, created_at AS createdAt
         FROM announcements WHERE game_id = ? ORDER BY created_at DESC`,
      )
      .bind(gameId)
      .all();
    return Response.json({ ok: true, announcements: rows.results });
  } catch (error) {
    return routeError(error, 'Unable to load announcements.');
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body = (await request.json()) as { title?: string; body?: string; emailSubject?: string; emailBody?: string };
    const title = body.title?.trim() ?? '';
    const announcementBody = body.body?.trim() ?? '';
    if (title.length < 3 || title.length > 100) throw new Error('Announcement title must be 3–100 characters.');
    if (announcementBody.length < 3 || announcementBody.length > 2_000) throw new Error('Announcement body must be 3–2,000 characters.');
    const emailSubject = body.emailSubject?.trim() || `[Watercooler Werewolf] ${title}`;
    const emailBody = body.emailBody?.trim() || `${announcementBody}\n\nOpen Watercooler Werewolf for the official game state.`;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const db = getDb();
    const seats = await db
      .prepare("SELECT id FROM seats WHERE game_id = ? AND status = 'CLAIMED'")
      .bind(gameId)
      .all<{ id: string }>();
    await db.batch([
      db
        .prepare(
          `INSERT INTO announcements
           (id, game_id, moderator_id, title, body, email_subject, email_body, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, gameId, moderator.id, title, announcementBody, emailSubject, emailBody, now),
      db
        .prepare(
          `INSERT INTO game_events
           (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
           VALUES (?, ?, 'ANNOUNCEMENT', ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ title, body: announcementBody }), now),
      ...seats.results.map((seat) =>
        db
          .prepare(
            `INSERT INTO notifications (id, seat_id, type, title, body, created_at)
             VALUES (?, ?, 'ANNOUNCEMENT', ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), seat.id, title, announcementBody, now),
      ),
    ]);
    return Response.json({ ok: true, announcement: { id, title, body: announcementBody, emailSubject, emailBody, createdAt: now } }, { status: 201 });
  } catch (error) {
    return routeError(error, 'Unable to publish the announcement.');
  }
}
