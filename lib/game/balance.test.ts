import { describe, expect, it } from 'vitest';
import { evaluateWinner } from './engine';
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

describe('a role mix that is already decided', () => {
  const mix = (werewolves: number, villagers: number) => ({ ...defaultComposition(6), WEREWOLF: werewolves, VILLAGER: villagers, SEER: 0, BODYGUARD: 0, HUNTER: 0, MASON: 0, APPRENTICE_SEER: 0, MAYOR: 0, CUPID: 0 });
  const decided = 'With these roles the Werewolves would already win before anyone votes. Use fewer Werewolves or more of the other roles.';

  it('refuses a mix where the Werewolves are at least as many as everyone else, with the plain message', () => {
    expect(validateComposition(mix(3, 3), 6)).toEqual({ valid: false, errors: [decided] });
    expect(validateComposition(mix(5, 1), 6).errors).toContain(decided);
    expect(validateComposition(mix(4, 2), 6).errors).toContain(decided);
  });

  it('accepts a mix where the Werewolves are still fewer than the rest', () => {
    expect(validateComposition(mix(2, 4), 6).valid).toBe(true);
    expect(validateComposition(mix(3, 4), 7).valid).toBe(true);
  });

  it('does not add the message when there is no Werewolf at all (that mistake has its own message)', () => {
    expect(validateComposition(mix(0, 6), 6).errors).toEqual(['At least one Werewolf is required.']);
  });

  it('agrees with the engine: a refused mix really is a Werewolf win before any vote', () => {
    const players = (werewolves: number, villagers: number) => [
      ...Array.from({ length: werewolves }, (_, index) => ({ id: `w${index}`, displayName: `Wolf ${index}`, role: 'WEREWOLF' as const, alive: true })),
      ...Array.from({ length: villagers }, (_, index) => ({ id: `v${index}`, displayName: `Villager ${index}`, role: 'VILLAGER' as const, alive: true })),
    ];
    expect(evaluateWinner(players(3, 3)).winner).toBe('WEREWOLF');
    expect(evaluateWinner(players(2, 4)).winner).toBeNull();
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
