import { describe, expect, it } from 'vitest';
import { canResetGame, canStopGame } from './lifecycle';

describe('game lifecycle safety policy', () => {
  it('requires confirmation and a reason to stop, and makes repeat stop harmless', () => {
    expect(canStopGame('ACTIVE', 'pause', false).allowed).toBe(false);
    expect(canStopGame('ACTIVE', 'pause', true).allowed).toBe(true);
    expect(canStopGame('STOPPED', 'pause', true)).toMatchObject({ allowed: true, idempotent: true });
    expect(canStopGame('COMPLETED', 'pause', true).allowed).toBe(false);
  });

  it('requires owner authorization and exact game-name confirmation to reset', () => {
    expect(canResetGame('ACTIVE', 'Office Game', 'Office Game', 'CO_MODERATOR', true).allowed).toBe(false);
    expect(canResetGame('ACTIVE', 'Office Game', 'office game', 'OWNER', true).allowed).toBe(false);
    expect(canResetGame('ACTIVE', 'Office Game', 'Office Game', 'OWNER', false).allowed).toBe(false);
    expect(canResetGame('ACTIVE', 'Office Game', 'Office Game', 'OWNER', true).allowed).toBe(true);
    expect(canResetGame('DRAFT', 'Office Game', 'Office Game', 'OWNER', true)).toMatchObject({ allowed: true, idempotent: true });
  });
});
