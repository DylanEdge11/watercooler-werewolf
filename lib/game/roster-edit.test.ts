import { describe, expect, it } from 'vitest';
import { defaultComposition } from './balance';
import { MAX_PLAYERS, MIN_PLAYERS } from './player-count';
import { adjustCompositionForRosterChange, canAcceptSignups, canAddLateVillager, canAddSeat, canEditRoster, canRemoveSeat } from './roster-edit';

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

  it('let a roster still being built from sign-ups shrink below the minimum, but not drop to it from the minimum', () => {
    expect(canRemoveSeat(MIN_PLAYERS - 1, 'INVITED').allowed).toBe(true);
    expect(canRemoveSeat(1, 'INVITED').allowed).toBe(true);
    expect(canRemoveSeat(MIN_PLAYERS, 'INVITED')).toMatchObject({ allowed: false, error: expect.stringContaining(`${MIN_PLAYERS}`) });
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

describe('accepting sign-ups into the roster', () => {
  const zero = { VILLAGER: 0, WEREWOLF: 0, SEER: 0, BODYGUARD: 0, HUNTER: 0, MASON: 0, APPRENTICE_SEER: 0, MAYOR: 0, CUPID: 0 };

  it('can start from an empty roster and stops at the player limit', () => {
    expect(canAcceptSignups(0).allowed).toBe(true);
    expect(canAcceptSignups(MAX_PLAYERS - 1).allowed).toBe(true);
    expect(canAcceptSignups(MAX_PLAYERS)).toMatchObject({ allowed: false, error: expect.stringContaining(`${MAX_PLAYERS}`) });
  });

  it('keeps every role at zero until the roster reaches the minimum', () => {
    for (let count = 1; count < MIN_PLAYERS; count += 1) {
      expect(adjustCompositionForRosterChange(zero, count, 1)).toEqual({ composition: zero, resetToPreset: false });
    }
    expect(adjustCompositionForRosterChange(zero, 3, 3)).toEqual({ composition: zero, resetToPreset: false });
  });

  it('starts from the preset when a roster first reaches the minimum', () => {
    expect(adjustCompositionForRosterChange(zero, MIN_PLAYERS, 1)).toEqual({ composition: defaultComposition(MIN_PLAYERS), resetToPreset: true });
    expect(adjustCompositionForRosterChange(zero, 12, 12)).toEqual({ composition: defaultComposition(12), resetToPreset: true });
  });

  it('starts from the preset again when several players are added at once', () => {
    const custom = { ...defaultComposition(8), VILLAGER: 3, WEREWOLF: 2 };
    expect(adjustCompositionForRosterChange(custom, 11, 3)).toEqual({ composition: defaultComposition(11), resetToPreset: true });
  });

  it('still absorbs a single added player in Villagers', () => {
    const custom = { ...defaultComposition(8), VILLAGER: 6, WEREWOLF: 2 };
    expect(adjustCompositionForRosterChange(custom, 9, 1)).toEqual({ composition: { ...custom, VILLAGER: 7 }, resetToPreset: false });
  });

  it('empties the counts when removals take a roster below the minimum', () => {
    expect(adjustCompositionForRosterChange(defaultComposition(MIN_PLAYERS), MIN_PLAYERS - 1, -1)).toEqual({ composition: zero, resetToPreset: false });
  });
});

describe('late Villagers', () => {
  it('are allowed in a running game until the second Day opens', () => {
    expect(canAddLateVillager('ACTIVE', true, 0, 20)).toEqual({ allowed: true });
    expect(canAddLateVillager('ACTIVE', true, 1, 20)).toEqual({ allowed: true });
    expect(canAddLateVillager('ACTIVE', true, 2, 20)).toEqual({ allowed: true });
    expect(canAddLateVillager('ACTIVE', true, 3, 20)).toMatchObject({ allowed: false, error: expect.stringMatching(/first Day and Night/u) });
  });

  it('are refused before roles are released, outside a running game, or at the player limit', () => {
    expect(canAddLateVillager('REGISTRATION', false, 0, 20)).toMatchObject({ allowed: false, error: expect.stringMatching(/Change the roster/u) });
    expect(canAddLateVillager('FINAL_SHOWDOWN', true, 2, 20).allowed).toBe(false);
    expect(canAddLateVillager('STOPPED', true, 1, 20).allowed).toBe(false);
    expect(canAddLateVillager('ACTIVE', true, 1, MAX_PLAYERS)).toMatchObject({ allowed: false, error: expect.stringMatching(/at most/u) });
  });
});
