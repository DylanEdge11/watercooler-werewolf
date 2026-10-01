import { describe, expect, it } from 'vitest';
import { validateDeadlineExtension, validateFinalShowdownEntry, validatePhaseOpen } from './phase-policy';

describe('phase sequencing policy', () => {
  it('requires a Day ballot first and alternates Day and Night', () => {
    expect(validatePhaseOpen({ gameStatus: 'ACTIVE', latestPhase: null, requestedKind: 'DAY' })).toBeNull();
    expect(validatePhaseOpen({ gameStatus: 'ACTIVE', latestPhase: null, requestedKind: 'NIGHT' })).toContain('first');
    expect(validatePhaseOpen({ gameStatus: 'ACTIVE', latestPhase: { kind: 'DAY', status: 'PUBLISHED' }, requestedKind: 'NIGHT' })).toBeNull();
    expect(validatePhaseOpen({ gameStatus: 'ACTIVE', latestPhase: { kind: 'DAY', status: 'PUBLISHED' }, requestedKind: 'DAY' })).toContain('alternate');
  });

  it('requires explicit final-showdown entry before a final ballot', () => {
    expect(validatePhaseOpen({ gameStatus: 'ACTIVE', latestPhase: { kind: 'NIGHT', status: 'PUBLISHED' }, requestedKind: 'FINAL_BALLOT' })).toContain('final showdown');
    expect(validateFinalShowdownEntry({
      gameStatus: 'ACTIVE',
      latestPhase: { kind: 'NIGHT', status: 'PUBLISHED' },
      finalCutoffAt: '2026-10-01T16:00:00Z',
      now: new Date('2026-10-01T15:59:59Z'),
    })).toContain('before');
    expect(validateFinalShowdownEntry({
      gameStatus: 'ACTIVE',
      latestPhase: { kind: 'NIGHT', status: 'PUBLISHED' },
      finalCutoffAt: '2026-10-01T16:00:00Z',
      now: new Date('2026-10-01T16:00:00Z'),
    })).toBeNull();
  });

  it('rejects stopped and completed games and allows unresolved final ballots to repeat', () => {
    expect(validatePhaseOpen({ gameStatus: 'STOPPED', latestPhase: null, requestedKind: 'DAY' })).toContain('stopped');
    expect(validatePhaseOpen({ gameStatus: 'COMPLETED', latestPhase: null, requestedKind: 'DAY' })).toContain('complete');
    expect(validatePhaseOpen({ gameStatus: 'FINAL_SHOWDOWN', latestPhase: { kind: 'FINAL_BALLOT', status: 'PUBLISHED', winner: null }, requestedKind: 'FINAL_BALLOT' })).toBeNull();
    expect(validatePhaseOpen({ gameStatus: 'FINAL_SHOWDOWN', latestPhase: { kind: 'FINAL_BALLOT', status: 'PUBLISHED', winner: 'VILLAGE' }, requestedKind: 'FINAL_BALLOT' })).toContain('winner');
  });
});

describe('deadline extension policy', () => {
  const now = new Date('2026-10-01T17:00:00Z');
  const base = { gameStatus: 'ACTIVE', phaseStatus: 'OPEN', currentClosesAt: '2026-10-01T17:14:00.000Z', now };

  it('allows moving an open phase\'s deadline later', () => {
    expect(validateDeadlineExtension({ ...base, requestedClosesAt: new Date('2026-10-01T22:00:00Z') })).toBeNull();
    expect(validateDeadlineExtension({ ...base, gameStatus: 'FINAL_SHOWDOWN', requestedClosesAt: new Date('2026-10-01T22:00:00Z') })).toBeNull();
  });

  it('never shortens a deadline or keeps it the same', () => {
    expect(validateDeadlineExtension({ ...base, requestedClosesAt: new Date('2026-10-01T17:10:00Z') })).toMatch(/later than the current one/u);
    expect(validateDeadlineExtension({ ...base, requestedClosesAt: new Date('2026-10-01T17:14:00Z') })).toMatch(/later than the current one/u);
  });

  it('refuses once voting has closed, or for a phase that is not open', () => {
    expect(validateDeadlineExtension({ ...base, now: new Date('2026-10-01T17:14:00Z'), requestedClosesAt: new Date('2026-10-01T22:00:00Z') })).toMatch(/already closed/u);
    expect(validateDeadlineExtension({ ...base, phaseStatus: 'LOCKED', requestedClosesAt: new Date('2026-10-01T22:00:00Z') })).toMatch(/open phase/u);
    expect(validateDeadlineExtension({ ...base, gameStatus: 'STOPPED', requestedClosesAt: new Date('2026-10-01T22:00:00Z') })).toMatch(/running game/u);
    expect(validateDeadlineExtension({ ...base, requestedClosesAt: new Date('nope') })).toMatch(/not a valid/u);
  });
});
