import { getD1 } from '../../db';
import { getCurrentModerator, type ModeratorIdentity } from './session';

export async function requireModerator(): Promise<ModeratorIdentity> {
  const moderator = await getCurrentModerator();
  if (!moderator) throw new Error('Moderator authentication required.');
  return moderator;
}

export async function requireGameModerator(gameId: string): Promise<ModeratorIdentity> {
  const moderator = await requireModerator();
  const membership = await getD1()
    .prepare('SELECT role FROM game_moderators WHERE game_id = ? AND moderator_id = ? LIMIT 1')
    .bind(gameId, moderator.id)
    .first<{ role: string }>();
  if (!membership) throw new Error('You are not a moderator for this game.');
  return moderator;
}

export async function requireGameOwner(gameId: string): Promise<ModeratorIdentity> {
  const moderator = await requireModerator();
  const membership = await getD1()
    .prepare('SELECT role FROM game_moderators WHERE game_id = ? AND moderator_id = ? LIMIT 1')
    .bind(gameId, moderator.id)
    .first<{ role: string }>();
  if (membership?.role !== 'OWNER') throw new Error('Only the game owner can perform this recovery action.');
  return moderator;
}
