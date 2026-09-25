import { describe, expect, it } from 'vitest';
import { defaultComposition } from './balance';
import { MAX_PLAYERS, MIN_PLAYERS } from './player-count';
import { adjustCompositionForRosterChange, canAddSeat, canEditRoster, canRemoveSeat } from './roster-edit';

describe('single-seat roster edits', () => {
  it('are open only before roles are randomized', () => {
    expect(canEditRoster('DRAFT', false).allowed).toBe(true);
    expect(canEditRoster('REGISTRATION', false).allowed).toBe(true);
    expect(canEditRoster('ASSIGNMENT_PREVIEW', false)).toMatchObject({ allowed: false, error: expect.stringContaining('randomized') });
    expect(canEditRoster('REGISTRATION', true).allowed).toBe(false);
    for (const status of ['ACTIVE', 'STOPPED', 'COMPLETED', 'CANCELLED', 'ROSTER_IMPORTING']) {
      expect(canEditRoster(status, false).allowed).toBe(false);
    }
  });

  it('keep the roster within the supported size', () => {
    expect(canAddSeat(0).allowed).toBe(false);
    expect(canAddSeat(MAX_PLAYERS - 1).allowed).toBe(true);
    expect(canAddSeat(MAX_PLAYERS).allowed).toBe(false);
    expect(canRemoveSeat(MIN_PLAYERS + 1, 'INVITED').allowed).toBe(true);
    expect(canRemoveSeat(MIN_PLAYERS, 'INVITED').allowed).toBe(false);
  });

  it('remove only players who have not claimed their seat', () => {
    expect(canRemoveSeat(20, 'CLAIMED')).toMatchObject({ allowed: false, error: expect.stringContaining('not claimed') });
    expect(canRemoveSeat(20, 'REMOVED').allowed).toBe(false);
  });

  it('absorb the change in Villagers and keep custom counts', () => {
    const custom = { ...defaultComposition(20), VILLAGER: 10, WEREWOLF: 4, MASON: 2, HUNTER: 0, SEER: 1, BODYGUARD: 1, CUPID: 1, MAYOR: 1 };
    expect(adjustCompositionForRosterChange(custom, 21, 1)).toEqual({ composition: { ...custom, VILLAGER: 11 }, resetToPreset: false });
    expect(adjustCompositionForRosterChange(custom, 19, -1)).toEqual({ composition: { ...custom, VILLAGER: 9 }, resetToPreset: false });
  });

  it('fall back to the preset when no Villager can be removed', () => {
    const noVillagers = { ...defaultComposition(8), VILLAGER: 0, WEREWOLF: 2, SEER: 1, BODYGUARD: 1, HUNTER: 1, MASON: 2, CUPID: 1 };
    expect(adjustCompositionForRosterChange(noVillagers, 7, -1)).toEqual({ composition: defaultComposition(7), resetToPreset: true });
  });

  it('fall back to the preset when the saved counts no longer match the roster', () => {
    expect(adjustCompositionForRosterChange(defaultComposition(20), 22, 1)).toEqual({ composition: defaultComposition(22), resetToPreset: true });
  });
});
