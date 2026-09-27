import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { randomToken, sha256 } from '../../../../../lib/auth/crypto';
import { isReservedTestAddress, readSmtpSettings } from '../../../../../lib/email/settings';
import { openMailer } from '../../../../../lib/email/smtp';
import { MAX_PLAYERS } from '../../../../../lib/game/player-count';
import { enforceRateLimit } from '../../../../../lib/http/rate-limit';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { routeError } from '../../../../../lib/http/errors';
import { isSingleEmailAddress } from '../../../../../lib/roster/email-address';
import { inviteMessage } from '../../../../../lib/roster/invite-message';

// Up to 80 invitations over three SMTP connections.
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

interface InviteResult {
  seatId: string;
  displayName: string;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  reason?: string;
}

/**
 * Emails each unclaimed player a fresh claim link. Only a hash of each claim
 * code is stored, so sending replaces the player's previous link (from the
 * CSV or an earlier email). Claimed seats are never touched.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    // Anything but a JSON object is refused; unreadable input must never fall
    // through to "email every unclaimed player".
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonError('Send a JSON object with seatIds.', 400);
    }
    const requested = (body as { seatIds?: unknown }).seatIds;
    if (requested !== undefined && (!Array.isArray(requested) || requested.length > MAX_PLAYERS || requested.some((id) => typeof id !== 'string' || id.length > 64))) {
      return jsonError('seatIds must be a list of seat IDs.', 400);
    }
    const settings = readSmtpSettings();
    if (!settings) {
      return jsonError('Invite email is not set up for this site. Download the invite CSV instead, or ask the site operator to configure email.', 503);
    }
    // A single-player Resend has its own allowance per player, so fixing one
    // lost invitation never uses up the game's allowance for bulk sends.
    if (Array.isArray(requested) && requested.length === 1) {
      await enforceRateLimit(`invite-email:${gameId}:seat:${requested[0]}`, 5, 60 * 60_000);
    } else {
      await enforceRateLimit(`invite-email:${gameId}`, 30, 60 * 60_000);
    }

    const db = getDb();
    const game = await db
      .prepare(
        `SELECT status, EXISTS (SELECT 1 FROM role_assignments WHERE game_id = games.id) AS released
         FROM games WHERE id = ? LIMIT 1`,
      )
      .bind(gameId)
      .first<{ status: string; released: number }>();
    if (!game) return jsonError('Game not found.', 404);
    if (!['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW'].includes(game.status) || Number(game.released)) {
      return jsonError('Invitations can only be emailed before roles are released.', 409);
    }

    const seats = await db
      .prepare(
        `SELECT id, display_name AS displayName, email, claim_code_hash AS claimCodeHash
         FROM seats WHERE game_id = ? AND status = 'INVITED'
         ORDER BY display_name COLLATE NOCASE`,
      )
      .bind(gameId)
      .all<{ id: string; displayName: string; email: string; claimCodeHash: string }>();
    const wanted = requested ? new Set(requested as string[]) : null;
    const targets = seats.results.filter((seat) => !wanted || wanted.has(seat.id));
    if (!targets.length) {
      return jsonError(wanted ? 'Those players have already claimed their seats.' : 'Every player has already claimed their seat.', 409);
    }

    const results: InviteResult[] = [];
    const deliverable = targets.filter((seat) => {
      // Seats imported before this check, or restored from a backup, may hold
      // an address list; never send a private link to more than one recipient.
      if (!isSingleEmailAddress(seat.email)) {
        results.push({ seatId: seat.id, displayName: seat.displayName, status: 'FAILED', reason: 'Not a single email address; fix it in the roster.' });
        return false;
      }
      if (!isReservedTestAddress(seat.email)) return true;
      results.push({ seatId: seat.id, displayName: seat.displayName, status: 'SKIPPED', reason: 'Test address; not sent.' });
      return false;
    });

    // Sign in before replacing any links, so a misconfigured account cannot
    // invalidate links the moderator already sent another way.
    const mailer = deliverable.length ? openMailer(settings) : null;
    try {
      if (mailer) {
        const signIn = await mailer.verify();
        if (!signIn.ok) return jsonError(signIn.reason, 502);
      }

      const now = new Date().toISOString();
      const origin = new URL(request.url).origin;
      const invites = await Promise.all(
        deliverable.map(async (seat) => {
          const code = randomToken(9);
          return { seat, codeHash: await sha256(code), claimUrl: `${origin}/claim/${encodeURIComponent(code)}` };
        }),
      );
      // Each seat is replaced only if it is still unclaimed with the link we
      // read, so a concurrent claim or send is skipped rather than overwritten.
      const rotated = invites.length
        ? await db.batch(
          invites.map((invite) =>
            db
              .prepare(
                `UPDATE seats SET claim_code_hash = ?, updated_at = ?
                 WHERE id = ? AND game_id = ? AND status = 'INVITED' AND claim_code_hash = ?
                   AND EXISTS (
                     SELECT 1 FROM games g WHERE g.id = seats.game_id
                       AND g.status IN ('DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW')
                       AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = g.id)
                   )`,
              )
              .bind(invite.codeHash, now, invite.seat.id, gameId, invite.seat.claimCodeHash),
          ),
        )
        : [];
      const ready = invites.filter((_, index) => Number(rotated[index]?.meta?.changes ?? 0) === 1);
      if (invites.length && !ready.length) {
        return jsonError('The roster changed while invitations were being prepared. Refresh and try again.', 409);
      }
      for (const invite of invites) {
        if (!ready.includes(invite)) {
          results.push({ seatId: invite.seat.id, displayName: invite.seat.displayName, status: 'FAILED', reason: 'Changed during sending; refresh and retry.' });
        }
      }

      const deliveries = await Promise.all(
        ready.map(async (invite) => {
          const message = inviteMessage(invite.seat.displayName, invite.claimUrl);
          return { invite, delivery: await mailer!.send({ to: invite.seat.email, ...message }) };
        }),
      );
      const sentAt = new Date().toISOString();
      const sent = deliveries.filter(({ delivery }) => delivery.ok).map(({ invite }) => invite);
      if (sent.length) {
        // Recorded only while the emailed link is still the seat's live link.
        await db.batch(
          sent.map((invite) =>
            db
              .prepare(
                `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
                 SELECT ?, ?, 'INVITE_EMAILED', ?, ?, ?
                 WHERE EXISTS (SELECT 1 FROM seats WHERE id = ? AND game_id = ? AND claim_code_hash = ?)`,
              )
              .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ seatId: invite.seat.id }), sentAt, invite.seat.id, gameId, invite.codeHash),
          ),
        );
      }
      for (const { invite, delivery } of deliveries) {
        results.push(delivery.ok
          ? { seatId: invite.seat.id, displayName: invite.seat.displayName, status: 'SENT' }
          : { seatId: invite.seat.id, displayName: invite.seat.displayName, status: 'FAILED', reason: delivery.reason });
      }
    } finally {
      mailer?.close();
    }

    results.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
    return Response.json({ ok: true, sent: results.filter((result) => result.status === 'SENT').length, results });
  } catch (error) {
    return routeError(error, 'Unable to email invitations.');
  }
}
