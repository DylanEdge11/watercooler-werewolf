/**
 * Roster limits apply to players only; the moderator is not counted.
 * Keep these shared so imports, role setup, assignments, and restore cannot
 * drift apart.
 */
export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 80;

export function isValidPlayerCount(playerCount: number): boolean {
  return Number.isInteger(playerCount) && playerCount >= MIN_PLAYERS && playerCount <= MAX_PLAYERS;
}
