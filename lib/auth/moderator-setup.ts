import { getDb } from '../../db';
import { changes } from '../../db/results';
import { SETUP_LINK_DAYS, setupLinkExpired } from '../game/moderator-applications';
import { HttpError } from '../http/errors';
import { sha256 } from './crypto';
import { prepareModeratorAccount, type CreatedModerator } from './bootstrap';

export interface SetupLink {
  displayName: string;
  gameName: string;
  email: string;
}

/** The one-time link an approved applicant uses to choose a password. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/u;

interface SetupRow {
  id: string;
  gameId: string;
  gameName: string;
  gameStatus: string;
  displayName: string;
  email: string;
  decidedAt: string | null;
  decidedBy: string | null;
  accountExists: number;
}

async function findSetupRow(code: string): Promise<SetupRow | null> {
  if (!CODE_PATTERN.test(code)) return null;
  return getDb()
    .prepare(
      `SELECT a.id, a.game_id AS gameId, g.name AS gameName, g.status AS gameStatus, a.display_name AS displayName, a.email,
              a.decided_at AS decidedAt, a.decided_by_moderator_id AS decidedBy,
              EXISTS (SELECT 1 FROM moderator_accounts ma WHERE ma.email = a.email) AS accountExists
       FROM moderator_applications a JOIN games g ON g.id = a.game_id
       WHERE a.setup_code_hash = ? AND a.status = 'APPROVED' AND a.setup_used_at IS NULL AND a.moderator_id IS NULL
       LIMIT 1`,
    )
    .bind(await sha256(code))
    .first<SetupRow>();
}

const GAME_OVER = ['CANCELLED', 'STOPPED', 'COMPLETED'];

/** The applicant and game a setup link is for, or null when it is unknown, used, expired, or no longer usable. */
export async function lookupSetupLink(code: string): Promise<SetupLink | null> {
  const row = await findSetupRow(code);
  if (!row || setupLinkExpired(row.decidedAt, new Date()) || Number(row.accountExists) || GAME_OVER.includes(row.gameStatus)) return null;
  return { displayName: row.displayName, gameName: row.gameName, email: row.email };
}

/**
 * Creates the applicant's moderator account and adds it to the game as a co-moderator, in one
 * transaction that is conditional on the link still being unused and unexpired, no account existing
 * for the email, and the game not being over. Two uses of the link at once create one account.
 */
export async function redeemSetupLink(code: string, password: string): Promise<{ account: CreatedModerator; gameName: string }> {
  const row = await findSetupRow(code);
  if (!row || setupLinkExpired(row.decidedAt, new Date()) || GAME_OVER.includes(row.gameStatus)) throw new HttpError(404, 'invalid');
  if (Number(row.accountExists)) throw new HttpError(409, 'A moderator account already exists for this email. Sign in on the moderator page; if the game is not in your list, ask its owner to approve you again.');

  const prepared = await prepareModeratorAccount(row.email, password);
  const db = getDb();
  const now = new Date().toISOString();
  const codeHash = await sha256(code);
  const eventId = crypto.randomUUID();
  // Still the approval that was read (a fresh approval replaces the link) and still inside the link's lifetime.
  const oldest = new Date(Date.now() - SETUP_LINK_DAYS * 86_400_000).toISOString();
  const live = "EXISTS (SELECT 1 FROM moderator_applications WHERE id = ? AND setup_code_hash = ? AND status = 'APPROVED' AND setup_used_at IS NULL AND moderator_id IS NULL AND decided_at = ? AND decided_at > ?)";
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO moderator_accounts (id, email, password_hash, recovery_codes_json, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE ${live}
           AND NOT EXISTS (SELECT 1 FROM moderator_accounts WHERE email = ?)
           AND EXISTS (SELECT 1 FROM games WHERE id = ? AND status NOT IN ('CANCELLED', 'STOPPED', 'COMPLETED'))`,
      )
      .bind(...prepared.values, row.id, codeHash, row.decidedAt, oldest, row.email, row.gameId),
    db
      .prepare(
        `INSERT INTO game_moderators (game_id, moderator_id, role, added_at)
         SELECT ?, ?, 'CO_MODERATOR', ?
         WHERE EXISTS (SELECT 1 FROM moderator_accounts WHERE id = ?)
           AND NOT EXISTS (SELECT 1 FROM game_moderators WHERE game_id = ? AND moderator_id = ?)`,
      )
      .bind(row.gameId, prepared.account.id, now, prepared.account.id, row.gameId, prepared.account.id),
    db
      .prepare(
        `UPDATE moderator_applications SET setup_used_at = ?, moderator_id = ?, setup_code_hash = NULL
         WHERE id = ? AND setup_code_hash = ?
           AND EXISTS (SELECT 1 FROM game_moderators WHERE game_id = ? AND moderator_id = ?)`,
      )
      .bind(now, prepared.account.id, row.id, codeHash, row.gameId, prepared.account.id),
    db
      .prepare(
        `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
         SELECT ?, ?, 'CO_MODERATOR_ADDED', ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM moderator_applications WHERE id = ? AND moderator_id = ?)`,
      )
      .bind(eventId, row.gameId, row.decidedBy, JSON.stringify({ moderatorId: prepared.account.id, email: row.email, applicationId: row.id }), now, row.id, prepared.account.id),
  ]);
  if (changes(results[0]) !== 1 || changes(results[2]) !== 1) {
    throw new HttpError(409, 'This setup link was just used or is no longer valid. Ask the game owner to approve you again.');
  }
  return { account: prepared.account, gameName: row.gameName };
}
