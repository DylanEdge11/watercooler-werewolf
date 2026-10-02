import { describe, expect, it } from 'vitest';
import { withoutEndedSpectators } from './login-matches';

const seat = { kind: 'SEAT' as const, id: 'seat' };
const runningWatcher = { kind: 'SPECTATOR' as const, id: 'running', gameStatus: 'ACTIVE' };
const endedWatcher = { kind: 'SPECTATOR' as const, id: 'ended', gameStatus: 'COMPLETED' };

describe('sign-in matches', () => {
  it('leaves a single match alone, even a spectator of a finished game', () => {
    expect(withoutEndedSpectators([endedWatcher])).toEqual([endedWatcher]);
    expect(withoutEndedSpectators([seat])).toEqual([seat]);
    expect(withoutEndedSpectators([])).toEqual([]);
  });

  it('never lets a spectator of a finished game compete with another match', () => {
    expect(withoutEndedSpectators([endedWatcher, seat])).toEqual([seat]);
    expect(withoutEndedSpectators([seat, endedWatcher])).toEqual([seat]);
    expect(withoutEndedSpectators([endedWatcher, runningWatcher])).toEqual([runningWatcher]);
  });

  it.each(['COMPLETED', 'STOPPED', 'CANCELLED'])('treats a %s game as finished', (gameStatus) => {
    expect(withoutEndedSpectators([{ kind: 'SPECTATOR' as const, id: 'x', gameStatus }, seat])).toEqual([seat]);
  });

  it('keeps every match that is still ambiguous, so the person is asked for their seat code or link', () => {
    expect(withoutEndedSpectators([seat, runningWatcher])).toEqual([seat, runningWatcher]);
    expect(withoutEndedSpectators([seat, { ...seat, id: 'other-seat' }])).toEqual([seat, { ...seat, id: 'other-seat' }]);
    expect(withoutEndedSpectators([endedWatcher, { ...endedWatcher, id: 'ended-two' }])).toHaveLength(2);
  });
});
