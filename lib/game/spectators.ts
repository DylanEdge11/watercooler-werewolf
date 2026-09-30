/**
 * Spectators join a game once it has started. They hold no role, never vote,
 * and are never counted as players. They see what any player sees publicly,
 * and they may read and write in the Afterlife.
 */
export const SPECTATOR_JOIN_STATUSES = ['ACTIVE', 'FINAL_SHOWDOWN'] as const;

export type SpectatorDecision = { allowed: true } | { allowed: false; error: string };

export function canAddSpectator(gameStatus: string): SpectatorDecision {
  if ((SPECTATOR_JOIN_STATUSES as readonly string[]).includes(gameStatus)) return { allowed: true };
  return { allowed: false, error: 'Spectators can join only while the game is running, after roles are released.' };
}

/** Spectators post in the Afterlife on the same terms as eliminated players: an open room in a running game. */
export function spectatorCanPost(gameStatus: string, roomStatus: string): boolean {
  return roomStatus === 'OPEN' && (SPECTATOR_JOIN_STATUSES as readonly string[]).includes(gameStatus);
}

/** How a spectator's Afterlife message is labelled, so nobody mistakes them for an eliminated player. */
export function spectatorAuthorName(displayName: string): string {
  return `${displayName} (spectator)`;
}
