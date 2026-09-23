import { getDb } from '../../db';
import type { LoverPair } from './types';

export async function loadCurrentLoverPair(gameId: string): Promise<LoverPair | null> {
  const row = await getDb()
    .prepare(
      `SELECT ge.payload_json AS payloadJson
       FROM game_events ge
       WHERE ge.game_id = ? AND ge.event_type = 'CUPID_PAIR_SET'
         AND ge.created_at > COALESCE((
           SELECT MAX(boundary.created_at) FROM game_events boundary
           WHERE boundary.game_id = ge.game_id AND boundary.event_type IN ('GAME_RESET', 'GAME_RESTORED')
         ), '')
       ORDER BY ge.created_at DESC, ge.id DESC LIMIT 1`,
    )
    .bind(gameId)
    .first<{ payloadJson: string }>();
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payloadJson) as Partial<LoverPair>;
    const ids = payload.playerIds;
    if (
      typeof payload.cupidId !== 'string'
      || !Array.isArray(ids)
      || ids.length !== 2
      || ids.some((id) => typeof id !== 'string')
      || ids[0] === ids[1]
    ) return null;
    return { cupidId: payload.cupidId, playerIds: [ids[0], ids[1]] };
  } catch {
    return null;
  }
}
