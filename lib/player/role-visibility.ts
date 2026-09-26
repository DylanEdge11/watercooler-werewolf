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
