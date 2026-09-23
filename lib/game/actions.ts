import type { ActionKind, PhaseKind, PlayerState, RoleKey } from './types';

export interface ActionPermission {
  actionKind: ActionKind | null;
  maxTargets: number;
  label: string;
}

export interface RolePermissionState {
  seerAlive?: boolean;
  cupidPairExists?: boolean;
}

export function permissionForRole(
  role: RoleKey,
  phaseKind: PhaseKind,
  slots: number,
  pendingHunter = false,
  state: RolePermissionState = {},
): ActionPermission {
  if (pendingHunter) {
    return role === 'HUNTER'
      ? { actionKind: 'HUNTER_SHOT', maxTargets: 1, label: 'Choose your final target' }
      : { actionKind: null, maxTargets: 0, label: 'Waiting for the Hunter' };
  }
  if (phaseKind === 'DAY' || phaseKind === 'FINAL_BALLOT') {
    return { actionKind: 'DAY_VOTE', maxTargets: slots, label: 'Cast your village ballot' };
  }
  if (role === 'WEREWOLF') return { actionKind: 'WOLF_VOTE', maxTargets: slots, label: 'Choose the pack targets' };
  if (role === 'SEER') return { actionKind: 'INVESTIGATE', maxTargets: 1, label: 'Choose a player to investigate' };
  if (role === 'APPRENTICE_SEER' && state.seerAlive === false) return { actionKind: 'INVESTIGATE', maxTargets: 1, label: 'Choose a player to investigate' };
  if (role === 'BODYGUARD') return { actionKind: 'PROTECT', maxTargets: 1, label: 'Choose a player to protect' };
  if (role === 'CUPID' && !state.cupidPairExists) return { actionKind: 'CUPID_PAIR', maxTargets: 2, label: 'Choose two players to link as lovers' };
  return { actionKind: null, maxTargets: 0, label: 'No private action this night' };
}

export function validateActionTargets(input: {
  actor: PlayerState;
  players: PlayerState[];
  actionKind: ActionKind;
  targetIds: string[];
  maxTargets: number;
  hunterEliminatedIds?: string[];
}): string[] {
  const errors: string[] = [];
  const uniqueTargetIds = [...new Set(input.targetIds)];
  if (uniqueTargetIds.length !== input.targetIds.length) errors.push('Targets must be unique.');
  if (input.actionKind === 'CUPID_PAIR' && uniqueTargetIds.length !== 2) {
    errors.push('Choose exactly two players to link as lovers.');
  } else if (uniqueTargetIds.length < 1 || uniqueTargetIds.length > input.maxTargets) {
    errors.push(`Choose between 1 and ${input.maxTargets} target${input.maxTargets === 1 ? '' : 's'}.`);
  }
  const players = new Map(input.players.map((player) => [player.id, player]));
  for (const targetId of uniqueTargetIds) {
    const target = players.get(targetId);
    if (!target?.alive) errors.push('Every target must be a living player.');
    if (targetId === input.actor.id && input.actionKind !== 'CUPID_PAIR') errors.push('You cannot target yourself.');
    if (input.actionKind === 'WOLF_VOTE' && target?.role === 'WEREWOLF') {
      errors.push('Werewolves cannot target pack members.');
    }
    if (input.actionKind === 'HUNTER_SHOT' && input.hunterEliminatedIds?.includes(targetId)) {
      errors.push('The Hunter cannot target someone already eliminated by this phase.');
    }
  }
  return [...new Set(errors)];
}
