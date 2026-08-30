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
  it('builds the agreed 20-player default and recommends the nearest balancing wolf count', () => {
    const composition = defaultComposition(20);
    expect(composition).toEqual({
      VILLAGER: 12,
      WEREWOLF: 3,
      SEER: 1,
      BODYGUARD: 1,
      HUNTER: 1,
      MASON: 2,
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
      { VILLAGER: 13, WEREWOLF: 3, SEER: 2, BODYGUARD: 0, HUNTER: 0, MASON: 1 },
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
