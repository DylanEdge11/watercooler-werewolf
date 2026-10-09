/**
 * Roster limits apply to players only; the moderator is not counted.
 * Keep these shared so imports, role setup, assignments, and restore cannot
 * drift apart.
 */
export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 80;
