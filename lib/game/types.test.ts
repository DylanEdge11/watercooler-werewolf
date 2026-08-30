import { describe, expect, it } from 'vitest';
import { canonicalRoleKey, ROLE_KEYS } from './types';

describe('canonical role keys', () => {
  it('exposes only Bodyguard as the protective role while reading legacy Doctor safely', () => {
    expect(ROLE_KEYS).toContain('BODYGUARD');
    expect(ROLE_KEYS).not.toContain('DOCTOR' as never);
    expect(canonicalRoleKey('BODYGUARD')).toBe('BODYGUARD');
    expect(canonicalRoleKey('DOCTOR')).toBe('BODYGUARD');
  });
});
