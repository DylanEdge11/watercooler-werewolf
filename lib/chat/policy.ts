import type { RoleKey } from '../game/types';

export type PrivateRoomType = 'WEREWOLF' | 'MASON' | 'DEAD';

export function allowedRoomTypes(role: RoleKey | null, alive: boolean): PrivateRoomType[] {
  const rooms: PrivateRoomType[] = [];
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
