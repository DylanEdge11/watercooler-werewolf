/** Games that have ended. A spectator of one only comes back to re-read how it finished. */
const ENDED_GAME_STATUSES = new Set(['COMPLETED', 'STOPPED', 'CANCELLED']);

export interface LoginMatch {
  kind: 'SEAT' | 'SPECTATOR';
  /** Only spectators carry their game's status. */
  gameStatus?: string;
}

/**
 * When one email and PIN match more than one seat or spectator, a spectator of a
 * finished game never competes with another match: the person is signing in to
 * something that is still running. A lone match, and matches that stay
 * ambiguous, are returned unchanged, so the person is asked for their seat code
 * or private link.
 */
export function withoutEndedSpectators<T extends LoginMatch>(matches: T[]): T[] {
  if (matches.length < 2) return matches;
  const current = matches.filter((match) => !(match.kind === 'SPECTATOR' && match.gameStatus !== undefined && ENDED_GAME_STATUSES.has(match.gameStatus)));
  return current.length ? current : matches;
}
