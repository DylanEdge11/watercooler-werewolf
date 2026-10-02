import type { RoleKey } from '../game/types';

/** The game's rooms. The Town Hall is open to everyone; the other three are private. */
export type PrivateRoomType = 'WEREWOLF' | 'MASON' | 'DEAD' | 'TOWN_HALL';

/**
 * The rooms a seated player belongs to. Everyone is in the Town Hall (living
 * players post, eliminated players only read); Werewolves and Masons have
 * their room, and eliminated players the Afterlife.
 */
export function allowedRoomTypes(role: RoleKey | null, alive: boolean): PrivateRoomType[] {
  const rooms: PrivateRoomType[] = ['TOWN_HALL'];
  if (role === 'WEREWOLF') rooms.push('WEREWOLF');
  if (role === 'MASON') rooms.push('MASON');
  if (!alive) rooms.push('DEAD');
  return rooms;
}

export function normalizeChatBody(value: string): string {
  const normalized = value.replace(/\r\n?/gu, '\n').trim();
  if (!normalized) throw new Error('Message cannot be empty.');
  if (normalized.length > 1_000) throw new Error('Messages are limited to 1,000 characters.');
  return normalized;
}
