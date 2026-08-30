import { describe, expect, it } from 'vitest';
import { validateFinalShowdownEntry, validatePhaseOpen } from './phase-policy';

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
