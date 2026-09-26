import type { Database, PreparedStatement } from '../../db/contracts';

interface MembershipChange {
  gameId: string;
  /** The owner making the change. */
  ownerId: string;
  /** The co-moderator being removed or made owner. */
  moderatorId: string;
  eventId: string;
  now: string;
}

/**
 * True only while the actor still owns the game and the target is still a
 * co-moderator. Each change inserts its audit event under this guard first;
 * the membership writes then run only if that event exists, so a change that
 * lost a race (a second owner click, a removal, a transfer) writes nothing.
 */
const GUARD = `EXISTS (SELECT 1 FROM game_moderators WHERE game_id = ? AND moderator_id = ? AND role = 'OWNER')
  AND EXISTS (SELECT 1 FROM game_moderators WHERE game_id = ? AND moderator_id = ? AND role = 'CO_MODERATOR')`;

/** The event names the co-moderator; `actor_moderator_id` is the owner who acted. */
function guardedEvent(db: Database, change: MembershipChange, eventType: 'CO_MODERATOR_REMOVED' | 'OWNERSHIP_TRANSFERRED'): PreparedStatement {
  return db
    .prepare(
      `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
       SELECT ?, ?, '${eventType}', ?, json_object('moderatorId', ma.id, 'email', ma.email), ?
       FROM moderator_accounts ma WHERE ma.id = ? AND ${GUARD}`,
    )
    .bind(change.eventId, change.gameId, change.ownerId, change.now, change.moderatorId,
      change.gameId, change.ownerId, change.gameId, change.moderatorId);
}

/** Removes a co-moderator from one game. Their account and other games are untouched. The first statement's changes are 0 when nothing happened. */
export function removeCoModeratorStatements(db: Database, change: MembershipChange): PreparedStatement[] {
  return [
    guardedEvent(db, change, 'CO_MODERATOR_REMOVED'),
    db
      .prepare("DELETE FROM game_moderators WHERE game_id = ? AND moderator_id = ? AND role = 'CO_MODERATOR' AND EXISTS (SELECT 1 FROM game_events WHERE id = ?)")
      .bind(change.gameId, change.moderatorId, change.eventId),
  ];
}

/** Makes a co-moderator the owner; the previous owner stays on as a co-moderator. The first statement's changes are 0 when nothing happened. */
export function transferOwnershipStatements(db: Database, change: MembershipChange): PreparedStatement[] {
  return [
    guardedEvent(db, change, 'OWNERSHIP_TRANSFERRED'),
    db
      .prepare("UPDATE game_moderators SET role = 'OWNER' WHERE game_id = ? AND moderator_id = ? AND EXISTS (SELECT 1 FROM game_events WHERE id = ?)")
      .bind(change.gameId, change.moderatorId, change.eventId),
    db
      .prepare("UPDATE game_moderators SET role = 'CO_MODERATOR' WHERE game_id = ? AND moderator_id = ? AND EXISTS (SELECT 1 FROM game_events WHERE id = ?)")
      .bind(change.gameId, change.ownerId, change.eventId),
  ];
}
