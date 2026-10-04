import { getDb } from '../../db';
import { changes } from '../../db/results';
import { moderatorAddedMessage, moderatorSetupMessage } from '../game/join-copy';
import { nextApplicationStatus, canTakeApplications, type ApplicationDecision } from '../game/moderator-applications';
import { sendOneEmail, type SendOneResult } from '../email/send-one';
import { HttpError } from '../http/errors';
import { randomToken, sha256 } from './crypto';

export interface DecisionOutcome {
  /** ADDED: an existing account became a co-moderator now. LINK: a new account's setup link was issued. */
  outcome: 'ADDED' | 'ALREADY_MEMBER' | 'LINK' | 'DECLINED' | 'RECONSIDERED';
  /** The one-time setup link, shown to the owner once, only for LINK. */
  setupUrl?: string;
  /** What happened to the email to the applicant, when one was due. */
  email?: SendOneResult['status'];
  emailReason?: string;
}

interface ApplicationRow {
  id: string;
  gameName: string;
  gameStatus: string;
  displayName: string;
  email: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  moderatorId: string | null;
  setupUsedAt: string | null;
}

/**
 * The owner's decision on one application. Every write is conditional on the application still
 * being as read, on the caller still owning the game, and (for an approval) on the applicant not
 * having been added meanwhile, so a double click or a second owner tab changes nothing the second time.
 */
export async function decideApplication(options: { gameId: string; applicationId: string; ownerId: string; decision: ApplicationDecision; origin: string }): Promise<DecisionOutcome> {
  const { gameId, applicationId, ownerId, decision, origin } = options;
  const db = getDb();
  const application = await db
    .prepare(
      `SELECT a.id, g.name AS gameName, g.status AS gameStatus, a.display_name AS displayName, a.email, a.status,
              a.moderator_id AS moderatorId, a.setup_used_at AS setupUsedAt
       FROM moderator_applications a JOIN games g ON g.id = a.game_id
       WHERE a.id = ? AND a.game_id = ? LIMIT 1`,
    )
    .bind(applicationId, gameId)
    .first<ApplicationRow>();
  if (!application) throw new HttpError(404, 'That application was not found.');
  const used = Boolean(application.setupUsedAt || application.moderatorId);
  if (!nextApplicationStatus(application.status, decision, used)) {
    throw new HttpError(409, used ? `${application.email} was already added. Nothing more to do.` : 'That application has already been dealt with. Refresh the list.');
  }

  const now = new Date().toISOString();
  const ownerGuard = "EXISTS (SELECT 1 FROM game_moderators WHERE game_id = ? AND moderator_id = ? AND role = 'OWNER')";
  const waiting = "status IN ('PENDING', 'APPROVED') AND moderator_id IS NULL AND setup_used_at IS NULL";
  const event = (eventType: string, payload: Record<string, unknown>, guard: string, guardArgs: Array<string | number>) => db
    .prepare(
      `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
       SELECT ?, ?, ?, ?, ?, ? WHERE ${guard}`,
    )
    .bind(crypto.randomUUID(), gameId, eventType, ownerId, JSON.stringify({ applicationId, email: application.email, ...payload }), now, ...guardArgs);
  const lost = () => new HttpError(409, 'The application changed while you were deciding. Refresh the list.');

  if (decision === 'DECLINE') {
    const results = await db.batch([
      db
        .prepare(`UPDATE moderator_applications SET status = 'DECLINED', setup_code_hash = NULL, decided_at = ?, decided_by_moderator_id = ? WHERE id = ? AND game_id = ? AND ${waiting} AND ${ownerGuard}`)
        .bind(now, ownerId, applicationId, gameId, gameId, ownerId),
      event('MODERATOR_APPLICATION_DECLINED', {}, "EXISTS (SELECT 1 FROM moderator_applications WHERE id = ? AND status = 'DECLINED' AND decided_at = ?)", [applicationId, now]),
    ]);
    if (changes(results[0]) !== 1) throw lost();
    return { outcome: 'DECLINED' };
  }

  if (decision === 'RECONSIDER') {
    const result = await db
      .prepare(`UPDATE moderator_applications SET status = 'PENDING', decided_at = NULL, decided_by_moderator_id = NULL WHERE id = ? AND game_id = ? AND status = 'DECLINED' AND ${ownerGuard}`)
      .bind(applicationId, gameId, gameId, ownerId)
      .run();
    if (changes(result) !== 1) throw lost();
    return { outcome: 'RECONSIDERED' };
  }

  const open = canTakeApplications(application.gameStatus);
  if (!open.allowed) throw new HttpError(409, open.error);

  const account = await db.prepare('SELECT id FROM moderator_accounts WHERE email = ? LIMIT 1').bind(application.email).first<{ id: string }>();
  if (account) {
    const member = await db.prepare('SELECT 1 AS found FROM game_moderators WHERE game_id = ? AND moderator_id = ? LIMIT 1').bind(gameId, account.id).first();
    if (member) {
      // Already a moderator of this game (added another way since they applied): record it and stop.
      await db
        .prepare(`UPDATE moderator_applications SET status = 'APPROVED', moderator_id = ?, setup_code_hash = NULL, decided_at = ?, decided_by_moderator_id = ? WHERE id = ? AND game_id = ? AND ${waiting}`)
        .bind(account.id, now, ownerId, applicationId, gameId)
        .run();
      return { outcome: 'ALREADY_MEMBER' };
    }
    const eventId = crypto.randomUUID();
    const results = await db.batch([
      db
        .prepare(
          `UPDATE moderator_applications SET status = 'APPROVED', moderator_id = ?, setup_code_hash = NULL, decided_at = ?, decided_by_moderator_id = ?
           WHERE id = ? AND game_id = ? AND ${waiting} AND ${ownerGuard}
             AND NOT EXISTS (SELECT 1 FROM game_moderators WHERE game_id = ? AND moderator_id = ?)`,
        )
        .bind(account.id, now, ownerId, applicationId, gameId, gameId, ownerId, gameId, account.id),
      db
        .prepare(
          `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
           SELECT ?, ?, 'CO_MODERATOR_ADDED', ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM moderator_applications WHERE id = ? AND moderator_id = ? AND decided_at = ?)`,
        )
        .bind(eventId, gameId, ownerId, JSON.stringify({ moderatorId: account.id, email: application.email, applicationId }), now, applicationId, account.id, now),
      db
        .prepare("INSERT INTO game_moderators (game_id, moderator_id, role, added_at) SELECT ?, ?, 'CO_MODERATOR', ? WHERE EXISTS (SELECT 1 FROM game_events WHERE id = ?)")
        .bind(gameId, account.id, now, eventId),
    ]);
    if (changes(results[0]) !== 1) throw lost();
    const sent = await sendOneEmail(application.email, moderatorAddedMessage(application.displayName, application.gameName, `${origin}/moderator`));
    return { outcome: 'ADDED', email: sent.status, ...(sent.status === 'FAILED' ? { emailReason: sent.reason } : {}) };
  }

  // No account yet: a one-time link lets them choose a password. Approving again replaces the link.
  const code = randomToken(9);
  const results = await db.batch([
    db
      .prepare(`UPDATE moderator_applications SET status = 'APPROVED', setup_code_hash = ?, decided_at = ?, decided_by_moderator_id = ? WHERE id = ? AND game_id = ? AND ${waiting} AND ${ownerGuard}`)
      .bind(await sha256(code), now, ownerId, applicationId, gameId, gameId, ownerId),
    event('MODERATOR_APPLICATION_APPROVED', {}, "EXISTS (SELECT 1 FROM moderator_applications WHERE id = ? AND status = 'APPROVED' AND decided_at = ?)", [applicationId, now]),
  ]);
  if (changes(results[0]) !== 1) throw lost();
  const setupUrl = `${origin}/moderator/join/${encodeURIComponent(code)}`;
  const sent = await sendOneEmail(application.email, moderatorSetupMessage(application.displayName, application.gameName, setupUrl));
  return { outcome: 'LINK', setupUrl, email: sent.status, ...(sent.status === 'FAILED' ? { emailReason: sent.reason } : {}) };
}
