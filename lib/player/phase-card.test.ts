import { describe, expect, test } from 'vitest';
import { phaseCardCaption, phaseIsClosed } from './phase-card';

describe('the deadline card while a result is on its way', () => {
  test('a locked, pending-approval or publishing phase is closed; an open or pending-Hunter phase is not', () => {
    expect(['LOCKED', 'PENDING_APPROVAL', 'PUBLISHING'].every(phaseIsClosed)).toBe(true);
    expect(phaseIsClosed('OPEN')).toBe(false);
    expect(phaseIsClosed('PENDING_HUNTER')).toBe(false);
    expect(phaseIsClosed(null)).toBe(false);
    expect(phaseIsClosed(undefined)).toBe(false);
  });

  test('the small line says what is being waited for, in the approved words', () => {
    expect(phaseCardCaption('PENDING_APPROVAL')).toBe('Waiting for the moderator to publish the result.');
    expect(phaseCardCaption('PENDING_HUNTER')).toBe('Waiting for the Hunter.');
  });

  test('an open phase keeps showing its status as before', () => {
    expect(phaseCardCaption('OPEN')).toBeNull();
    expect(phaseCardCaption(undefined)).toBeNull();
  });
});
