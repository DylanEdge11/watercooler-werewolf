/** Games that have ended. Their seats and spectators only come back to re-read how it finished. */
export const ENDED_GAME_STATUSES = ['COMPLETED', 'STOPPED', 'CANCELLED'] as const;

export function isEndedGameStatus(status: string | undefined): boolean {
  return status !== undefined && (ENDED_GAME_STATUSES as readonly string[]).includes(status);
}

export interface LoginMatch {
  id: string;
  kind: 'SEAT' | 'SPECTATOR';
  gameStatus?: string;
}

/**
 * One option in the "which game?" list the sign-in route sends back. It is only
 * sent after the email and PIN have both been proven, and holds nothing secret:
 * no role, seat code, hash, email, or session.
 */
export interface SignInChoice {
  id: string;
  kind: 'SEAT' | 'SPECTATOR';
  gameName: string;
  displayName: string;
}

/**
 * When one email and PIN match more than one seat or spectator, a game that has
 * ended never competes with one that has not: the person is signing in to
 * something still running. A lone match, matches that are all in ended games,
 * and matches that are still ambiguous among games that have not ended are
 * returned unchanged.
 */
export function withoutEndedGames<T extends LoginMatch>(matches: T[]): T[] {
  if (matches.length < 2) return matches;
  const current = matches.filter((match) => !isEndedGameStatus(match.gameStatus));
  return current.length ? current : matches;
}

/**
 * True when signing in would land in an ended game while a seat the person also
 * holds in a game that has not ended is locked. They must hear about the lock,
 * not be quietly taken somewhere else.
 */
export function lockedSeatHiddenByEndedGame(matches: LoginMatch[], locked: LoginMatch[]): boolean {
  return matches.length > 0
    && matches.every((match) => isEndedGameStatus(match.gameStatus))
    && locked.some((candidate) => !isEndedGameStatus(candidate.gameStatus));
}
