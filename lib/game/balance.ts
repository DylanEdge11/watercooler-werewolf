import { ROLE_CATALOG } from './catalog';
import { ROLE_KEYS, type RoleComposition, type RoleKey } from './types';

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
  if (!Number.isInteger(playerCount) || playerCount < 20) {
    throw new Error('Watercooler Werewolf requires at least 20 players.');
  }

  const composition: RoleComposition = {
    VILLAGER: 0,
    WEREWOLF: recommendedWerewolves(playerCount),
    SEER: 1,
    DOCTOR: 1,
    HUNTER: 1,
    MASON: 2,
  };
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
  for (const role of ['SEER', 'DOCTOR', 'HUNTER'] as RoleKey[]) {
    if (composition[role] > 1) errors.push(`${ROLE_CATALOG[role].name} is unique.`);
  }
  if (composition.MASON === 1) errors.push('Masons require either zero or at least two seats.');
  if (composition.WEREWOLF < 1) errors.push('At least one Werewolf is required.');

  return { valid: errors.length === 0, errors };
}

export function calculateEliminationSlots(livingPlayers: number, divisor: number): number {
  if (!Number.isInteger(livingPlayers) || livingPlayers < 1) return 0;
  if (!Number.isInteger(divisor) || divisor < 1) {
    throw new Error('The elimination divisor must be a positive integer.');
  }
  return Math.max(1, Math.ceil(livingPlayers / divisor));
}

