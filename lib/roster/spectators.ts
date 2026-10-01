import type { Database, PreparedStatement, SqlValue } from '../../db/contracts';

/**
 * Reset and Restore start a fresh run, so the old run's spectators and their
 * Afterlife messages go with it: links stop working and signed-in devices are
 * signed out. The caller's guard keeps these inside its own transaction.
 */
export function endSpectatorsStatements(db: Database, gameId: string, now: string, guard: string, guardArgs: SqlValue[]): PreparedStatement[] {
  return [
    db.prepare(`DELETE FROM spectator_messages WHERE room_id IN (SELECT id FROM chat_rooms WHERE game_id = ?) AND ${guard}`).bind(gameId, ...guardArgs),
    db.prepare(`DELETE FROM spectator_sessions WHERE spectator_id IN (SELECT id FROM spectators WHERE game_id = ?) AND ${guard}`).bind(gameId, ...guardArgs),
    db
      .prepare(`UPDATE spectators SET status = 'REMOVED', session_version = session_version + 1, updated_at = ? WHERE game_id = ? AND status != 'REMOVED' AND ${guard}`)
      .bind(now, gameId, ...guardArgs),
  ];
}
