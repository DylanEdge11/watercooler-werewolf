import { sha256 } from '../auth/crypto';
import { validateComposition } from './balance';
import { ROLE_KEYS, type RoleComposition, type RoleKey } from './types';

export interface AssignmentPreview {
  assignments: Array<{ seatId: string; role: RoleKey }>;
  randomRolls: number[];
  evidenceHash: string;
}

/** Fingerprints bind a preview to the exact setup inputs used to create it. */
export async function fingerprintRoster(seatIds: string[]): Promise<string> {
  return sha256(JSON.stringify([...seatIds].sort()));
}

export async function fingerprintComposition(composition: RoleComposition): Promise<string> {
  return sha256(JSON.stringify(ROLE_KEYS.map((role) => [role, composition[role]])));
}

export async function createAssignmentPreview(
  seatIds: string[],
  composition: RoleComposition,
  randomRolls: number[],
): Promise<AssignmentPreview> {
  const validation = validateComposition(composition, seatIds.length);
  if (!validation.valid) throw new Error(validation.errors.join(' '));

  const roles = ROLE_KEYS.flatMap((role) => Array.from({ length: composition[role] }, () => role));
  if (randomRolls.length < Math.max(0, roles.length - 1)) {
    throw new Error('The shuffle requires one recorded random roll per swap.');
  }

  for (let index = roles.length - 1; index > 0; index -= 1) {
    const roll = randomRolls[roles.length - 1 - index];
    if (roll < 0 || roll >= 1) throw new Error('Shuffle rolls must be in the range [0, 1).');
    const swapIndex = Math.floor(roll * (index + 1));
    [roles[index], roles[swapIndex]] = [roles[swapIndex], roles[index]];
  }

  const sortedSeatIds = [...seatIds].sort();
  const assignments = sortedSeatIds.map((seatId, index) => ({ seatId, role: roles[index] }));
  const evidenceHash = await sha256(JSON.stringify({ seatIds: sortedSeatIds, composition, randomRolls }));
  return { assignments, randomRolls, evidenceHash };
}

