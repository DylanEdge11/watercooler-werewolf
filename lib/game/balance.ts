import { ROLE_CATALOG } from './catalog';
import { MAX_PLAYERS, MIN_PLAYERS } from './player-count';
import { ROLE_KEYS, type RoleComposition } from './types';

export type BalanceLabel =
  | 'BALANCED'
  | 'VILLAGE_LEAN'
  | 'WEREWOLF_LEAN'
  | 'STRONG_VILLAGE'
  | 'STRONG_WEREWOLF';

export interface BalanceResult {
  score: number;
  normalized: number;
  label: BalanceLabel;
  suggestedWerewolves: number;
}

export interface CompositionValidation {
  valid: boolean;
  errors: string[];
}

export function recommendedWerewolves(playerCount: number): number {
  if (!Number.isInteger(playerCount) || playerCount < 1) return 0;
  return Math.max(1, Math.round(playerCount / 6));
}

export function defaultComposition(playerCount: number): RoleComposition {
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Watercooler Werewolf supports ${MIN_PLAYERS}–${MAX_PLAYERS} players.`);
  }

  const composition: RoleComposition = {
    VILLAGER: 0,
    WEREWOLF: 0,
    SEER: 0,
    BODYGUARD: 0,
    HUNTER: 0,
    MASON: 0,
    APPRENTICE_SEER: 0,
    MAYOR: 0,
    CUPID: 0,
  };

  // Small games deliberately add information and follow-up roles in stages.
  // This is an initial playable preset policy, not a claim of balance proof.
  if (playerCount <= 8) {
    composition.WEREWOLF = 1;
  } else if (playerCount <= 11) {
    composition.WEREWOLF = 1;
    composition.SEER = 1;
  } else if (playerCount <= 14) {
    composition.WEREWOLF = 2;
    composition.SEER = 1;
  } else if (playerCount < 20) {
    composition.WEREWOLF = 3;
    composition.SEER = 1;
    composition.BODYGUARD = 1;
  } else {
    // Preserve the established 20-player composition and its existing
    // one-Werewolf-per-six recommendation for larger games.
    composition.WEREWOLF = recommendedWerewolves(playerCount);
    composition.SEER = 1;
    composition.BODYGUARD = 1;
    composition.HUNTER = 1;
    composition.MASON = 2;
  }
  composition.VILLAGER = playerCount - countComposition(composition);

  if (composition.VILLAGER < 0) {
    throw new Error('The player count is too small for the default role set.');
  }

  return composition;
}

export function countComposition(composition: RoleComposition): number {
  return ROLE_KEYS.reduce((total, role) => total + composition[role], 0);
}

export function scoreComposition(composition: RoleComposition): BalanceResult {
  const playerCount = countComposition(composition);
  const score = ROLE_KEYS.reduce(
    (total, role) => total + composition[role] * ROLE_CATALOG[role].power,
    0,
  );
  const normalized = playerCount === 0 ? 0 : score / playerCount;
  const magnitude = Math.abs(normalized);
  let label: BalanceLabel = 'BALANCED';
  if (magnitude > 0.15) label = score > 0 ? 'STRONG_VILLAGE' : 'STRONG_WEREWOLF';
  else if (magnitude > 0.05) label = score > 0 ? 'VILLAGE_LEAN' : 'WEREWOLF_LEAN';

  const currentWerewolves = composition.WEREWOLF;
  const candidates = [
    Math.max(1, currentWerewolves - 1),
    currentWerewolves,
    currentWerewolves + 1,
  ];
  const suggestedWerewolves = candidates.reduce((best, candidate) => {
    const shiftedScore = score - (candidate - currentWerewolves) * 6;
    const bestScore = score - (best - currentWerewolves) * 6;
    return Math.abs(shiftedScore) < Math.abs(bestScore) ? candidate : best;
  }, currentWerewolves);

  return { score, normalized, label, suggestedWerewolves };
}

export function validateComposition(
  composition: RoleComposition,
  playerCount: number,
): CompositionValidation {
  const errors: string[] = [];
  for (const role of ROLE_KEYS) {
    if (!Number.isInteger(composition[role]) || composition[role] < 0) {
      errors.push(`${role} count must be a non-negative integer.`);
    }
  }
  if (countComposition(composition) !== playerCount) {
    errors.push('Role counts must equal the claimed roster size.');
  }
  for (const role of ROLE_KEYS) {
    if (ROLE_CATALOG[role].unique && composition[role] > 1) errors.push(`${ROLE_CATALOG[role].name} is unique.`);
  }
  if (composition.MASON === 1) errors.push('Masons require either zero or at least two seats.');
  if (composition.WEREWOLF < 1) errors.push('At least one Werewolf is required.');
  // The engine ends a game as a Werewolf win when the Werewolf side is at least as large as the rest.
  const werewolfSide = ROLE_KEYS.reduce((total, role) => total + (ROLE_CATALOG[role].faction === 'WEREWOLF' ? composition[role] : 0), 0);
  if (werewolfSide >= 1 && werewolfSide >= countComposition(composition) - werewolfSide) {
    errors.push('With these roles the Werewolves would already win before anyone votes. Use fewer Werewolves or more of the other roles.');
  }

  return { valid: errors.length === 0, errors };
}

export function calculateEliminationSlots(livingPlayers: number, divisor: number): number {
  if (!Number.isInteger(livingPlayers) || livingPlayers < 1) return 0;
  if (!Number.isInteger(divisor) || divisor < 1) {
    throw new Error('The elimination divisor must be a positive integer.');
  }
  return Math.max(1, Math.ceil(livingPlayers / divisor));
}
