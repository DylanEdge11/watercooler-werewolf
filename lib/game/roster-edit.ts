import { defaultComposition, validateComposition } from './balance';
import { MAX_PLAYERS, MIN_PLAYERS } from './player-count';
import type { RoleComposition } from './types';

/**
 * Seats can be added or removed one at a time only before roles are
 * randomized. Once a preview exists, saving the role counts again discards it
 * and returns the game to REGISTRATION, which reopens the roster.
 */
export const ROSTER_EDIT_STATUSES = ['DRAFT', 'REGISTRATION'] as const;

export type RosterEditDecision = { allowed: true } | { allowed: false; error: string };

export function canEditRoster(status: string, rolesReleased: boolean): RosterEditDecision {
  if (rolesReleased || !['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW'].includes(status)) {
    return { allowed: false, error: 'Players can only be added or removed before roles are randomized.' };
  }
  if (status === 'ASSIGNMENT_PREVIEW') {
    return { allowed: false, error: 'Roles have been randomized, so the roster is locked. Save the role composition again to discard the preview and unlock it.' };
  }
  return { allowed: true };
}

export function canAddSeat(currentCount: number): RosterEditDecision {
  if (currentCount < 1) return { allowed: false, error: 'Import a roster before adding players.' };
  if (currentCount >= MAX_PLAYERS) return { allowed: false, error: `A game can have at most ${MAX_PLAYERS} players.` };
  return { allowed: true };
}

export function canRemoveSeat(currentCount: number, seatStatus: string): RosterEditDecision {
  if (seatStatus !== 'INVITED') {
    return { allowed: false, error: 'Only players who have not claimed their seat can be removed.' };
  }
  if (currentCount <= MIN_PLAYERS) return { allowed: false, error: `A game needs at least ${MIN_PLAYERS} players.` };
  return { allowed: true };
}

export interface AdjustedComposition {
  composition: RoleComposition;
  /** True when the saved counts could not be kept and the preset was used instead. */
  resetToPreset: boolean;
}

/**
 * Keeps the moderator's saved role counts and absorbs the change in Villagers.
 * Falls back to the standard preset for the new size when that is impossible
 * (no Villager left to remove, or the saved counts were already invalid).
 */
export function adjustCompositionForRosterChange(
  composition: RoleComposition,
  newPlayerCount: number,
  delta: 1 | -1,
): AdjustedComposition {
  const adjusted = { ...composition, VILLAGER: composition.VILLAGER + delta };
  if (validateComposition(adjusted, newPlayerCount).valid) {
    return { composition: adjusted, resetToPreset: false };
  }
  return { composition: defaultComposition(newPlayerCount), resetToPreset: true };
}

/** Late joiners are allowed only during the first Day and the first Night: the game's first two phases. */
export const LATE_JOIN_LAST_PHASE_SEQUENCE = 2;

/**
 * A late joiner is always a Villager and joins quietly. Allowed only once roles
 * are released and the game is running, and only until the second Day opens.
 */
export function canAddLateVillager(status: string, rolesReleased: boolean, latestPhaseSequence: number, seatCount: number): RosterEditDecision {
  if (status !== 'ACTIVE' || !rolesReleased) {
    return { allowed: false, error: 'Late Villagers can be added only while the game is running. Before roles are randomized, use Change the roster instead.' };
  }
  if (latestPhaseSequence > LATE_JOIN_LAST_PHASE_SEQUENCE) {
    return { allowed: false, error: 'Late Villagers can be added only during the first Day and Night.' };
  }
  if (seatCount >= MAX_PLAYERS) return { allowed: false, error: `A game can have at most ${MAX_PLAYERS} players.` };
  return { allowed: true };
}
