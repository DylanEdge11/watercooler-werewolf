/**
 * "Hide role" is remembered per device in localStorage. The dashboard also
 * mirrors it into this cookie so the server-rendered page never shows a role
 * the player chose to hide. The value names the seat, so a shared device
 * never applies one player's choice to another.
 */
export const ROLE_VISIBILITY_COOKIE = 'ww_role_visibility';

export function roleVisibilityCookieValue(playerId: string, hidden: boolean): string {
  return `${playerId}.${hidden ? 'hidden' : 'shown'}`;
}

/** true or false when the cookie is for this seat; null when there is no usable cookie. */
export function parseRoleVisibility(value: string | undefined, playerId: string): boolean | null {
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator <= 0 || value.slice(0, separator) !== playerId) return null;
  const state = value.slice(separator + 1);
  return state === 'hidden' ? true : state === 'shown' ? false : null;
}

interface Permission<Kind extends string> {
  actionKind: Kind | null;
  maxTargets: number;
  label: string;
}

/** Shown in place of the ballot while the role is hidden and the player may have a private action. */
export const CONCEALED_ACTION_LABEL = 'Your role is hidden';
export const CONCEALED_ACTION_HINT = 'You may have a private action — show your role to see it.';

/**
 * What the ballot area shows while "Hide role" is on, so the page looks the
 * same for every role. The Day vote and the Afterlife vote are the same for
 * everyone who has them and stay. Any role's own action (the pack's targets,
 * an investigation, a protection, Cupid's pair, the Hunter's shot) is hidden,
 * and so is every living player's open Night, where a Villager's "No private
 * action this night" would otherwise stand out.
 */
export function concealedPermission<Kind extends string>(
  permission: Permission<Kind>,
  phase: { kind: string; status: string } | null,
  alive: boolean,
): { permission: Permission<Kind>; masked: boolean } {
  const shared = permission.actionKind === 'DAY_VOTE' || permission.actionKind === 'AFTERLIFE_VOTE';
  const roleAction = permission.actionKind !== null && !shared;
  const openNight = alive && phase?.kind === 'NIGHT' && phase.status === 'OPEN';
  if (!roleAction && !openNight) return { permission, masked: false };
  return { permission: { actionKind: null, maxTargets: 0, label: CONCEALED_ACTION_LABEL }, masked: true };
}
