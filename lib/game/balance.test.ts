import { describe, expect, it } from 'vitest';
import {
  calculateEliminationSlots,
  countComposition,
  defaultComposition,
  recommendedWerewolves,
  scoreComposition,
  validateComposition,
} from './balance';

describe('role balance', () => {
  it('uses staged small-game presets without forcing every special role', () => {
    expect(defaultComposition(6)).toEqual({
      VILLAGER: 5,
      WEREWOLF: 1,
      SEER: 0,
      BODYGUARD: 0,
      HUNTER: 0,
      MASON: 0,
      APPRENTICE_SEER: 0,
      MAYOR: 0,
      CUPID: 0,
    });
    for (const count of [6, 7, 8, 9, 11, 12, 14, 15, 19]) {
      const composition = defaultComposition(count);
      expect(countComposition(composition)).toBe(count);
      expect(validateComposition(composition, count).valid).toBe(true);
    }
    expect(defaultComposition(7).SEER).toBe(0);
    expect(defaultComposition(19)).toMatchObject({ SEER: 1, BODYGUARD: 1, HUNTER: 0, MASON: 0 });
  });

  it('rejects counts outside the shared roster limits', () => {
    expect(() => defaultComposition(5)).toThrow('6–80');
    expect(() => defaultComposition(81)).toThrow('6–80');
  });

  it('builds the agreed 20-player default and recommends the nearest balancing wolf count', () => {
    const composition = defaultComposition(20);
    expect(composition).toEqual({
      VILLAGER: 12,
      WEREWOLF: 3,
      SEER: 1,
      BODYGUARD: 1,
      HUNTER: 1,
      MASON: 2,
      APPRENTICE_SEER: 0,
      MAYOR: 0,
      CUPID: 0,
    });
    expect(countComposition(composition)).toBe(20);
    expect(scoreComposition(composition)).toMatchObject({
      score: 5,
      label: 'STRONG_VILLAGE',
      suggestedWerewolves: 4,
    });
  });

  it('uses the nearest whole number to one wolf per six players', () => {
    expect(recommendedWerewolves(20)).toBe(3);
    expect(recommendedWerewolves(40)).toBe(7);
    expect(recommendedWerewolves(80)).toBe(13);
  });

  it('rejects duplicate unique roles, a lone Mason, and the wrong total', () => {
    const result = validateComposition(
      {
        VILLAGER: 13,
        WEREWOLF: 3,
        SEER: 2,
        BODYGUARD: 0,
        HUNTER: 0,
        MASON: 1,
        APPRENTICE_SEER: 0,
        MAYOR: 0,
        CUPID: 0,
      },
      20,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Seer is unique.');
    expect(result.errors).toContain('Masons require either zero or at least two seats.');
    expect(result.errors).toContain('Role counts must equal the claimed roster size.');
  });
});

describe('elimination scaling', () => {
  it.each([
    [6, 1],
    [20, 1],
    [30, 1],
    [31, 2],
    [40, 2],
    [60, 2],
    [61, 3],
    [80, 3],
  ])('gives %i living players %i slots at the default divisor', (living, slots) => {
    expect(calculateEliminationSlots(living, 30)).toBe(slots);
  });
});
