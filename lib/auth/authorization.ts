import { getDb } from '../../db';
import { HttpError } from '../http/errors';
import { getCurrentModerator, type ModeratorIdentity } from './session';

export async function requireModerator(): Promise<ModeratorIdentity> {
  const moderator = await getCurrentModerator();
  if (!moderator) throw new HttpError(401, 'Moderator authentication required.');
  return moderator;
}

async function membershipRole(gameId: string, moderatorId: string): Promise<string | null> {
  const membership = await getDb()
    .prepare('SELECT role FROM game_moderators WHERE game_id = ? AND moderator_id = ? LIMIT 1')
    .bind(gameId, moderatorId)
    .first<{ role: string }>();
  return membership?.role ?? null;
}

export async function requireGameModerator(gameId: string): Promise<ModeratorIdentity> {
  const moderator = await requireModerator();
  if (!(await membershipRole(gameId, moderator.id))) throw new HttpError(403, 'You are not a moderator for this game.');
  return moderator;
}

export async function requireGameOwner(gameId: string, action = 'perform this recovery action'): Promise<ModeratorIdentity> {
  const moderator = await requireModerator();
  if ((await membershipRole(gameId, moderator.id)) !== 'OWNER') throw new HttpError(403, `Only the game owner can ${action}.`);
  return moderator;
}
