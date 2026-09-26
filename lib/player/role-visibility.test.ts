import { describe, expect, it } from 'vitest';
import { parseRoleVisibility, roleVisibilityCookieValue } from './role-visibility';

describe('role visibility cookie', () => {
  it('round-trips a seat’s choice', () => {
    expect(parseRoleVisibility(roleVisibilityCookieValue('seat-1', true), 'seat-1')).toBe(true);
    expect(parseRoleVisibility(roleVisibilityCookieValue('seat-1', false), 'seat-1')).toBe(false);
  });

  it('ignores a missing, malformed, or other seat’s cookie', () => {
    expect(parseRoleVisibility(undefined, 'seat-1')).toBeNull();
    expect(parseRoleVisibility('seat-2.hidden', 'seat-1')).toBeNull();
    expect(parseRoleVisibility('seat-1.maybe', 'seat-1')).toBeNull();
    expect(parseRoleVisibility('hidden', 'seat-1')).toBeNull();
  });
});
