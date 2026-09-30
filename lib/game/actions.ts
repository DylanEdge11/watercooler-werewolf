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

/**
 * What an eliminated player may do. On an open Day or Final ballot the
 * Afterlife may cast an optional vote that only breaks a tie in the living
 * vote; otherwise they watch.
 */
export function afterlifePermission(phaseKind: PhaseKind, slots: number, pendingHunter = false): ActionPermission {
  if (!pendingHunter && (phaseKind === 'DAY' || phaseKind === 'FINAL_BALLOT')) {
    return { actionKind: 'AFTERLIFE_VOTE', maxTargets: slots, label: 'Optional Afterlife tiebreak vote' };
  }
  return { actionKind: null, maxTargets: 0, label: 'Spectating the village' };
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

/** Actions that several players share. Only these may be counted across players. */
const SHARED_ACTION_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>(['DAY_VOTE', 'WOLF_VOTE', 'AFTERLIFE_VOTE']);

/**
 * The "N of M submitted" counter a player sees. Day ballots count every living
 * voter, the pack counts its own members, which Werewolves already know, and
 * the Afterlife counts every eliminated player, which is public.
 * Every other action is counted for the reader alone, so the counter can never
 * reveal how many players hold another Night role, including roles added later.
 */
export function participationCounter(input: {
  actionKind: ActionKind | null;
  livingPlayers: number;
  livingWerewolves: number;
  eliminatedPlayers?: number;
  /** Distinct players with a saved action of this kind; used only for shared actions. */
  sharedSubmissions: number;
  ownSubmission: boolean;
}): { submitted: number; eligible: number } {
  if (!input.actionKind) return { submitted: 0, eligible: 0 };
  if (!SHARED_ACTION_KINDS.has(input.actionKind)) return { submitted: input.ownSubmission ? 1 : 0, eligible: 1 };
  const eligible = input.actionKind === 'DAY_VOTE'
    ? input.livingPlayers
    : input.actionKind === 'AFTERLIFE_VOTE' ? input.eliminatedPlayers ?? 0 : input.livingWerewolves;
  return { submitted: Math.min(input.sharedSubmissions, eligible), eligible };
}

export function participationCountsAcrossPlayers(actionKind: ActionKind | null): boolean {
  return actionKind !== null && SHARED_ACTION_KINDS.has(actionKind);
}
