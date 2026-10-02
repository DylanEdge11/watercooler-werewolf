import { getDb } from '../../db';
import { buildGameStats, type GameStats, type StatsPublishedPhase } from '../game/game-stats';
import { afterlifeBrokeTie } from '../game/public-result';
import { canonicalRoleKey } from '../game/types';
import { loadRoster, parseTargetIds, RUN_BOUNDARY } from './dashboard-data';

/** The Town Hall room of a game. Binds (gameId). */
const TOWN_HALL_ROOM = "SELECT id FROM chat_rooms WHERE game_id = ? AND type = 'TOWN_HALL'";
/** The UTC quarter hour a message was written in, e.g. `2026-03-04T02:30`. */
const QUARTER_HOUR = "substr(created_at, 1, 14) || printf('%02d', (CAST(substr(created_at, 15, 2) AS INTEGER) / 15) * 15)";

const PHASE_KINDS = new Set(['DAY', 'NIGHT', 'FINAL_BALLOT']);

/**
 * Everything the Village stats view shows for one game, from information every
 * player already sees: published ballots in the current run, the roles of
 * eliminated players, and chat message counts. Open ballots, Night actions, and
 * living players' roles are never read. Returns null when the game does not exist.
 *
 * Reset and Restore delete the previous run's phases, votes, and chat, so the
 * stats start again from zero. Results and votes share one test for "a phase of
 * this run" (opened after the latest reset or restore, as the Timeline decides it),
 * so a result never appears without its votes.
 */
export async function loadGameStats(gameId: string): Promise<GameStats | null> {
  const db = getDb();
  const [game, roster, publishedRows, voteRows, chatTotal, quarterHours, authors] = await Promise.all([
    db.prepare('SELECT status, timezone FROM games WHERE id = ? LIMIT 1').bind(gameId).first<{ status: string; timezone: string }>(),
    loadRoster(gameId),
    db
      .prepare(
        `SELECT ge.phase_id AS phaseId, p.sequence, p.kind, ge.payload_json AS payloadJson, ge.created_at AS createdAt
         FROM game_events ge INDEXED BY idx_game_events_type JOIN phases p ON p.id = ge.phase_id
         WHERE ge.game_id = ? AND ge.event_type = 'PHASE_PUBLISHED'
           AND p.created_at > COALESCE(${RUN_BOUNDARY}, '')
         ORDER BY p.sequence ASC`,
      )
      .bind(gameId, gameId)
      .all<{ phaseId: string; sequence: number; kind: string; payloadJson: string; createdAt: string }>(),
    // The latest saved vote of every player in every published Day and Final ballot of this run.
    db
      .prepare(
        `SELECT p.id AS phaseId, a.actor_seat_id AS voterId, a.target_ids_json AS targetIdsJson
         FROM phases p JOIN action_submissions a ON a.phase_id = p.id
         WHERE p.game_id = ? AND p.status = 'PUBLISHED' AND p.kind IN ('DAY', 'FINAL_BALLOT')
           AND a.kind = 'DAY_VOTE' AND a.superseded_at IS NULL
           AND p.created_at > COALESCE(${RUN_BOUNDARY}, '')`,
      )
      .bind(gameId, gameId)
      .all<{ phaseId: string; voterId: string; targetIdsJson: string }>(),
    // Messages in every room by players, spectators, and moderators. Removed and purged messages are still rows, so they still count.
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM chat_messages WHERE room_id IN (SELECT id FROM chat_rooms WHERE game_id = ?))
           + (SELECT COUNT(*) FROM spectator_messages WHERE room_id IN (SELECT id FROM chat_rooms WHERE game_id = ?))
           + (SELECT COUNT(*) FROM moderator_messages WHERE room_id IN (SELECT id FROM chat_rooms WHERE game_id = ?)) AS total`,
      )
      .bind(gameId, gameId, gameId)
      .first<{ total: number }>(),
    // The Town Hall by quarter hour. Only this room is broken down: private rooms add to the total and nothing else.
    db
      .prepare(
        `SELECT bucket, COUNT(*) AS count FROM (
           SELECT ${QUARTER_HOUR} AS bucket FROM chat_messages WHERE room_id IN (${TOWN_HALL_ROOM})
           UNION ALL SELECT ${QUARTER_HOUR} FROM spectator_messages WHERE room_id IN (${TOWN_HALL_ROOM})
           UNION ALL SELECT ${QUARTER_HOUR} FROM moderator_messages WHERE room_id IN (${TOWN_HALL_ROOM})
         ) GROUP BY bucket ORDER BY bucket`,
      )
      .bind(gameId, gameId, gameId)
      .all<{ bucket: string; count: number }>(),
    db
      .prepare(
        `SELECT author_seat_id AS seatId, COUNT(*) AS count FROM chat_messages
         WHERE room_id IN (${TOWN_HALL_ROOM}) GROUP BY author_seat_id`,
      )
      .bind(gameId)
      .all<{ seatId: string; count: number }>(),
  ]);
  if (!game) return null;

  const published: StatsPublishedPhase[] = [];
  for (const row of publishedRows.results) {
    if (!PHASE_KINDS.has(row.kind)) continue;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
    } catch {
      continue;
    }
    const eliminations = Array.isArray(payload.eliminations) ? payload.eliminations : [];
    published.push({
      phaseId: row.phaseId,
      sequence: Number(row.sequence),
      kind: row.kind as StatsPublishedPhase['kind'],
      publishedAt: row.createdAt,
      afterlifeBrokeTie: afterlifeBrokeTie(payload),
      eliminations: eliminations.map((item) => {
        const elimination = item as Record<string, unknown>;
        return {
          playerId: String(elimination.playerId ?? ''),
          displayName: String(elimination.displayName ?? ''),
          role: typeof elimination.role === 'string' ? canonicalRoleKey(elimination.role) : null,
          cause: String(elimination.cause ?? ''),
        };
      }),
    });
  }

  return buildGameStats({
    timeZone: game.timezone,
    gameStatus: game.status,
    seats: roster.map(({ id, displayName }) => ({ id, displayName })),
    living: roster.filter((seat) => seat.alive).length,
    werewolvesLiving: roster.filter((seat) => seat.alive && seat.role === 'WEREWOLF').length,
    published,
    votes: voteRows.results.flatMap((row) =>
      parseTargetIds(row.targetIdsJson).map((targetId) => ({ phaseId: row.phaseId, voterId: row.voterId, targetId })),
    ),
    chat: {
      totalMessages: Number(chatTotal?.total ?? 0),
      townHallQuarterHours: quarterHours.results.map((row) => ({ bucket: row.bucket, count: Number(row.count) })),
      townHallByAuthor: authors.results.map((row) => ({ seatId: row.seatId, count: Number(row.count) })),
    },
  });
}
