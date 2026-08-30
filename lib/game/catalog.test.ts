import { describe, expect, it } from 'vitest';
import { ROLE_CATALOG } from './catalog';

describe('role catalog', () => {
  it('uses Bodyguard as the only village protective role', () => {
    expect(ROLE_CATALOG.BODYGUARD).toMatchObject({
      key: 'BODYGUARD',
      name: 'Bodyguard',
      actionKind: 'PROTECT',
      unique: true,
    });
    expect(Object.keys(ROLE_CATALOG)).not.toContain('DOCTOR');
  });
});
