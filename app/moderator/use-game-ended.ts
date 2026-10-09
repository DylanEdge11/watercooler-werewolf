import { useEffect, useRef } from 'react';
import { isEndedGameStatus } from '@/lib/auth/login-matches';

/**
 * Whether the game has ended (completed, stopped, or cancelled), for a poll's `stopWhen`.
 * A ref, because the poll's timer outlives any one render and must read the latest status.
 */
export function useGameEnded(status: string | null | undefined) {
  const ended = useRef(isEndedGameStatus(status ?? undefined));
  useEffect(() => {
    ended.current = isEndedGameStatus(status ?? undefined);
  }, [status]);
  return ended;
}
