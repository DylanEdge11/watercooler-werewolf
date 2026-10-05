import { describe, expect, it } from 'vitest';
import { isEndedGameStatus, lockedSeatHiddenByEndedGame, withoutEndedGames } from './login-matches';

const seat = { kind: 'SEAT' as const, id: 'seat', gameStatus: 'ACTIVE' };
const endedSeat = { kind: 'SEAT' as const, id: 'ended-seat', gameStatus: 'COMPLETED' };
const runningWatcher = { kind: 'SPECTATOR' as const, id: 'running', gameStatus: 'ACTIVE' };
const endedWatcher = { kind: 'SPECTATOR' as const, id: 'ended', gameStatus: 'COMPLETED' };

describe('sign-in matches', () => {
  it('leaves a single match alone, even one in a finished game', () => {
    expect(withoutEndedGames([endedWatcher])).toEqual([endedWatcher]);
    expect(withoutEndedGames([endedSeat])).toEqual([endedSeat]);
    expect(withoutEndedGames([seat])).toEqual([seat]);
    expect(withoutEndedGames([])).toEqual([]);
  });

  it('never lets a seat or spectator of a finished game compete with another match', () => {
    expect(withoutEndedGames([endedWatcher, seat])).toEqual([seat]);
    expect(withoutEndedGames([seat, endedWatcher])).toEqual([seat]);
    expect(withoutEndedGames([endedWatcher, runningWatcher])).toEqual([runningWatcher]);
    expect(withoutEndedGames([endedSeat, seat])).toEqual([seat]);
    expect(withoutEndedGames([seat, endedSeat, endedWatcher])).toEqual([seat]);
  });

  it.each(['COMPLETED', 'STOPPED', 'CANCELLED'])('treats a %s game as finished', (gameStatus) => {
    expect(isEndedGameStatus(gameStatus)).toBe(true);
    expect(withoutEndedGames([{ kind: 'SPECTATOR' as const, id: 'x', gameStatus }, seat])).toEqual([seat]);
    expect(withoutEndedGames([{ kind: 'SEAT' as const, id: 'y', gameStatus }, seat])).toEqual([seat]);
  });

  it.each(['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW', 'ACTIVE', 'FINAL_SHOWDOWN', undefined])('does not treat %s as finished', (gameStatus) => {
    expect(isEndedGameStatus(gameStatus)).toBe(false);
  });

  it('keeps every match that is still ambiguous among games that have not ended, so the person is asked which game', () => {
    expect(withoutEndedGames([seat, runningWatcher])).toEqual([seat, runningWatcher]);
    expect(withoutEndedGames([seat, { ...seat, id: 'other-seat' }])).toEqual([seat, { ...seat, id: 'other-seat' }]);
  });

  it('keeps every match when all of them are in finished games', () => {
    expect(withoutEndedGames([endedWatcher, { ...endedWatcher, id: 'ended-two' }])).toHaveLength(2);
    expect(withoutEndedGames([endedSeat, endedWatcher])).toHaveLength(2);
  });

  it('flags a sign-in that would land in a finished game while a seat in a running game is locked', () => {
    expect(lockedSeatHiddenByEndedGame([endedSeat], [seat])).toBe(true);
    expect(lockedSeatHiddenByEndedGame([endedSeat, endedWatcher], [runningWatcher])).toBe(true);
  });

  it('does not flag it when nothing running is locked or the match is itself in a running game', () => {
    expect(lockedSeatHiddenByEndedGame([endedSeat], [])).toBe(false);
    expect(lockedSeatHiddenByEndedGame([endedSeat], [{ ...endedSeat, id: 'locked-ended' }])).toBe(false);
    expect(lockedSeatHiddenByEndedGame([seat], [{ ...seat, id: 'locked-running' }])).toBe(false);
    expect(lockedSeatHiddenByEndedGame([], [seat])).toBe(false);
  });
});
