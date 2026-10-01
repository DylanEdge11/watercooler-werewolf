import { describe, expect, it } from 'vitest';
import { canAddSpectator, spectatorAuthorName, spectatorCanPost } from './spectators';

describe('spectators', () => {
  it('join only a running game', () => {
    expect(canAddSpectator('ACTIVE')).toEqual({ allowed: true });
    expect(canAddSpectator('FINAL_SHOWDOWN')).toEqual({ allowed: true });
    for (const status of ['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW', 'COMPLETED', 'STOPPED', 'CANCELLED']) {
      expect(canAddSpectator(status).allowed).toBe(false);
    }
  });

  it('post in an open Afterlife while the game runs', () => {
    expect(spectatorCanPost('ACTIVE', 'OPEN')).toBe(true);
    expect(spectatorCanPost('ACTIVE', 'READ_ONLY')).toBe(false);
    expect(spectatorCanPost('COMPLETED', 'OPEN')).toBe(false);
  });

  it('are labelled in the Afterlife', () => {
    expect(spectatorAuthorName('Riley Chen')).toBe('Riley Chen (spectator)');
  });
});
