import { describe, expect, it } from 'vitest';
import { cycleNumber, describeTimelineEvent, eliminationCause, phaseName, readableRole, type PublicTimelineEvent } from './timeline-view';

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
      eyebrow: 'Day 2',
      title: 'Day 2 resolved',
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

  it('reports a protected night with no deaths', () => {
    const view = describeTimelineEvent(event('PHASE_PUBLISHED', { kind: 'NIGHT', sequence: 2, eliminations: [], protectedAttackBlocked: true }));
    expect(view.headline).toBe('No one was eliminated');
    expect(view.description).toBe('Bodyguard protection stopped a pack attack. No one died.');
  });

  it('treats the final ballot as public', () => {
    expect(describeTimelineEvent(event('PHASE_PUBLISHED', { kind: 'FINAL_BALLOT', sequence: 9 }))).toMatchObject({ eyebrow: 'Final ballot', publicBallot: true });
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

describe('phase names', () => {
  it('numbers a Day and the Night after it as one cycle', () => {
    expect([1, 2, 3, 4, 5].map(cycleNumber)).toEqual([1, 1, 2, 2, 3]);
    expect(phaseName('DAY', 1)).toBe('Day 1');
    expect(phaseName('NIGHT', 2)).toBe('Night 1');
    expect(phaseName('DAY', 3)).toBe('Day 2');
    expect(phaseName('NIGHT', 4)).toBe('Night 2');
  });

  it('names Final ballots without a number and copes with a missing sequence', () => {
    expect(phaseName('FINAL_BALLOT', 9)).toBe('Final ballot');
    expect(phaseName('DAY', null)).toBe('Day');
  });
});
