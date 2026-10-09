import { defaultComposition, validateComposition } from './balance';
import { MAX_PLAYERS, MIN_PLAYERS } from './player-count';
import { ROLE_KEYS, type RoleComposition } from './types';

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

/**
 * A roster never drops from the minimum to below it. One still being built from sign-ups can hold
 * fewer players than that, and a player accepted by mistake can still be taken off it.
 */
export function canRemoveSeat(currentCount: number, seatStatus: string): RosterEditDecision {
  if (seatStatus !== 'INVITED') {
    return { allowed: false, error: 'Only players who have not claimed their seat can be removed.' };
  }
  if (currentCount === MIN_PLAYERS) return { allowed: false, error: `A game needs at least ${MIN_PLAYERS} players.` };
  return { allowed: true };
}

/** Sign-ups can fill an empty roster, so unlike a single added player they need no roster to start from. */
export function canAcceptSignups(currentCount: number): RosterEditDecision {
  if (currentCount >= MAX_PLAYERS) return { allowed: false, error: `A game can have at most ${MAX_PLAYERS} players.` };
  return { allowed: true };
}

export interface AdjustedComposition {
  composition: RoleComposition;
  /** True when the saved counts could not be kept and the preset was used instead. */
  resetToPreset: boolean;
}

/** Every role at zero: a roster below the minimum has no role counts to keep yet. */
function emptyComposition(): RoleComposition {
  return Object.fromEntries(ROLE_KEYS.map((role) => [role, 0])) as RoleComposition;
}

/**
 * Keeps the moderator's saved role counts and absorbs the change in Villagers.
 * Falls back to the standard preset for the new size when that is impossible
 * (no Villager left to remove, or the saved counts were already invalid).
 * `delta` is how many seats were added (positive) or removed (negative). A change of
 * more than one seat is a different size of game, so it starts from the preset again
 * rather than piling every new seat onto the Villagers. A roster still below the
 * minimum, as one built from sign-ups is on its way up, has no counts until it
 * reaches it.
 */
export function adjustCompositionForRosterChange(
  composition: RoleComposition,
  newPlayerCount: number,
  delta: number,
): AdjustedComposition {
  if (newPlayerCount < MIN_PLAYERS) return { composition: emptyComposition(), resetToPreset: false };
  if (Math.abs(delta) > 1) return { composition: defaultComposition(newPlayerCount), resetToPreset: true };
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
