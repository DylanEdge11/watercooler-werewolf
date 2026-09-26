import { describe, expect, it } from 'vitest';
import { resolvePhase } from './engine';
import type { ActionSubmission, PlayerState } from './types';
import { describeTimelineEvent, eliminationCause, MAYOR_TOTALS_NOTE, publicVoteTotals, readableRole, type PublicTimelineEvent } from './timeline-view';

function event(eventType: string, payload: PublicTimelineEvent['payload']): PublicTimelineEvent {
  return { id: 'e1', eventType, createdAt: '2026-09-24T12:00:00.000Z', payload };
}

describe('timeline wording', () => {
  it('names a single Day elimination and offers the public ballot', () => {
    const view = describeTimelineEvent(event('PHASE_PUBLISHED', {
      kind: 'DAY',
      sequence: 3,
      eliminations: [{ displayName: 'Casey Rivera', role: 'WEREWOLF', cause: 'DAY_VOTE' }],
    }));
    expect(view).toMatchObject({
      eyebrow: 'Day · Cycle 3',
      title: 'DAY · Cycle 3 resolved',
      description: 'Casey Rivera · Werewolf',
      headline: 'Casey Rivera eliminated',
      tone: 'phase',
      publicBallot: true,
    });
  });

  it('joins several eliminations and keeps Night ballots private', () => {
    const view = describeTimelineEvent(event('PHASE_PUBLISHED', {
      kind: 'NIGHT',
      sequence: 4,
      eliminations: [
        { displayName: 'Morgan Lee', role: 'SEER', cause: 'WEREWOLF_ATTACK' },
        { displayName: 'Jamie Park', role: 'VILLAGER', cause: 'LOVER_BOND' },
        { displayName: 'Taylor Reed', role: 'HUNTER', cause: 'HUNTER_SHOT' },
      ],
    }));
    expect(view.headline).toBe('Morgan Lee, Jamie Park and Taylor Reed eliminated');
    expect(view.description).toBe('Morgan Lee · Seer, Jamie Park · Villager · lover bond, Taylor Reed · Hunter · Hunter shot');
    expect(view.publicBallot).toBe(false);
  });

  it('says only that no one was eliminated, whether or not a Bodyguard blocked the pack', () => {
    // An older payload may still carry the flag; the wording must not change because of it.
    const legacy = { kind: 'NIGHT', sequence: 2, eliminations: [], protectedAttackBlocked: true } as PublicTimelineEvent['payload'];
    const blocked = describeTimelineEvent(event('PHASE_PUBLISHED', legacy));
    const quiet = describeTimelineEvent(event('PHASE_PUBLISHED', { kind: 'NIGHT', sequence: 2, eliminations: [] }));
    expect(blocked.headline).toBe('No one was eliminated');
    expect(blocked.description).toBe('No one was eliminated.');
    expect(blocked).toEqual(quiet);
    expect(JSON.stringify(blocked)).not.toMatch(/bodyguard|protect/iu);
  });

  it('does not mention protection next to other deaths', () => {
    const legacy = {
      kind: 'NIGHT',
      sequence: 2,
      eliminations: [{ displayName: 'Jamie Park', role: 'VILLAGER', cause: 'LOVER_BOND' }],
      protectedAttackBlocked: true,
    } as PublicTimelineEvent['payload'];
    expect(describeTimelineEvent(event('PHASE_PUBLISHED', legacy)).description).toBe('Jamie Park · Villager · lover bond');
  });

  it('treats the final ballot as public', () => {
    expect(describeTimelineEvent(event('PHASE_PUBLISHED', { kind: 'FINAL_BALLOT', sequence: 9 }))).toMatchObject({ eyebrow: 'Final ballot · Cycle 9', publicBallot: true });
  });

  it.each([
    ['ANNOUNCEMENT', { title: 'Office party', body: 'Voting pauses Friday.' }, 'Moderator announcement', 'Office party', 'announcement'],
    ['GAME_COMPLETED', { winner: 'VILLAGE' }, 'Campaign complete', 'Village wins', 'milestone'],
    ['GAME_STOPPED', {}, 'Campaign stopped', 'The moderator stopped the campaign', 'milestone'],
    ['FINAL_SHOWDOWN_ENTERED', {}, 'Final showdown', 'The final showdown begins', 'milestone'],
  ] as const)('describes %s', (type, payload, eyebrow, headline, tone) => {
    expect(describeTimelineEvent(event(type, payload))).toMatchObject({ eyebrow, headline, tone, publicBallot: false });
  });

  it('names the winner the same way in the rail and the full Timeline', () => {
    const view = describeTimelineEvent(event('GAME_COMPLETED', { winner: 'WEREWOLF' }));
    expect(view.title).toBe('Werewolf wins');
    expect(view.headline).toBe('Werewolf wins');
  });

  it('formats roles and causes', () => {
    expect(readableRole('APPRENTICE_SEER')).toBe('Apprentice Seer');
    expect(readableRole(null)).toBe('Role unavailable');
    expect(eliminationCause('DAY_VOTE')).toBe('village vote');
    expect(eliminationCause('WEREWOLF_ATTACK')).toBe('pack attack');
    expect(eliminationCause('UNKNOWN')).toBe('');
  });
});

describe('public vote totals', () => {
  const players: PlayerState[] = [
    { id: 'mayor', displayName: 'Avery Mayor', role: 'MAYOR', alive: true },
    { id: 'v1', displayName: 'Casey', role: 'VILLAGER', alive: true },
    { id: 'v2', displayName: 'Morgan', role: 'VILLAGER', alive: true },
    { id: 'v3', displayName: 'Riley', role: 'VILLAGER', alive: true },
    { id: 'wolf', displayName: 'Jordan', role: 'WEREWOLF', alive: true },
  ];
  const names = new Map(players.map((player) => [player.id, player.displayName]));
  function vote(actorId: string, targetId: string): ActionSubmission {
    return { id: `${actorId}-vote`, actorId, kind: 'DAY_VOTE', targetIds: [targetId], version: 1, submittedAt: '2026-10-01T15:00:00Z' };
  }

  it('counts a living Mayor’s Day vote twice, matching the engine’s result', () => {
    // Two voters each: without the Mayor's weight this reads "Jordan 2, Riley 2" and Jordan's elimination looks like a tie.
    const outcome = resolvePhase({
      phaseId: 'day-1',
      kind: 'DAY',
      slots: 1,
      players,
      actions: [vote('mayor', 'wolf'), vote('v1', 'wolf'), vote('v2', 'v3'), vote('wolf', 'v3')],
    });
    expect(outcome.eliminations.map((item) => item.playerId)).toEqual(['wolf']);
    expect(publicVoteTotals('DAY', outcome, names)).toEqual([
      { name: 'Jordan', votes: 3 },
      { name: 'Riley', votes: 2 },
    ]);
  });

  it('weights the Final ballot the same way', () => {
    const outcome = resolvePhase({
      phaseId: 'final-1',
      kind: 'FINAL_BALLOT',
      slots: 1,
      players,
      actions: [vote('mayor', 'v3'), vote('wolf', 'v1')],
    });
    expect(publicVoteTotals('FINAL_BALLOT', outcome, names)).toEqual([
      { name: 'Riley', votes: 2 },
      { name: 'Casey', votes: 1 },
    ]);
  });

  it('never returns totals for a Night', () => {
    const outcome = resolvePhase({
      phaseId: 'night-1',
      kind: 'NIGHT',
      slots: 1,
      players,
      actions: [{ ...vote('wolf', 'v1'), kind: 'WOLF_VOTE' }],
    });
    expect(publicVoteTotals('NIGHT', outcome, names)).toBeUndefined();
  });

  it('keeps ties in name order and skips malformed or unknown entries', () => {
    expect(publicVoteTotals('DAY', {
      tally: [
        { playerId: 'v2', votes: 1 },
        { playerId: 'v1', votes: 1 },
        { playerId: 'gone', votes: 4 },
        { playerId: 'v3', votes: 'lots' },
        null,
      ],
    }, names)).toEqual([{ name: 'Casey', votes: 1 }, { name: 'Morgan', votes: 1 }]);
    expect(publicVoteTotals('DAY', null, names)).toEqual([]);
  });

  it('explains why totals can exceed the number of voters', () => {
    expect(MAYOR_TOTALS_NOTE).toBe('The Mayor’s vote counts twice, so totals can be higher than the number of voters.');
  });
});
