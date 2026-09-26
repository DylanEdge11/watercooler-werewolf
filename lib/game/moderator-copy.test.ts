import { describe, expect, it } from 'vitest';
import { announcementChatCopy, announcementEmailCopy, formatDeadlineForChat, nudgeMessage } from './moderator-copy';
import { outstandingResponders } from './outstanding';
import type { PlayerState } from './types';

const players: PlayerState[] = [
  { id: 'wolf-1', displayName: 'Wren', role: 'WEREWOLF', alive: true },
  { id: 'wolf-2', displayName: 'Wade', role: 'WEREWOLF', alive: true },
  { id: 'seer', displayName: 'Sky', role: 'SEER', alive: true },
  { id: 'apprentice', displayName: 'Ash', role: 'APPRENTICE_SEER', alive: true },
  { id: 'guard', displayName: 'Gale', role: 'BODYGUARD', alive: true },
  { id: 'cupid', displayName: 'Cory', role: 'CUPID', alive: true },
  { id: 'villager', displayName: 'Vic', role: 'VILLAGER', alive: true },
  { id: 'mayor', displayName: 'May', role: 'MAYOR', alive: true },
  { id: 'gone', displayName: 'Gus', role: 'VILLAGER', alive: false },
];

describe('outstanding responders', () => {
  it('lists every living player without a saved Day vote, by name', () => {
    const outstanding = outstandingResponders({
      phase: { kind: 'DAY', status: 'OPEN' },
      players,
      actions: [{ actorId: 'wolf-1', kind: 'DAY_VOTE' }, { actorId: 'mayor', kind: 'DAY_VOTE' }],
      cupidPairExists: false,
    });
    expect(outstanding.map((player) => player.displayName)).toEqual(['Ash', 'Cory', 'Gale', 'Sky', 'Vic', 'Wade']);
  });

  it('lists only players whose role acts tonight and who have not saved it', () => {
    const outstanding = outstandingResponders({
      phase: { kind: 'NIGHT', status: 'OPEN' },
      players,
      actions: [{ actorId: 'wolf-2', kind: 'WOLF_VOTE' }, { actorId: 'seer', kind: 'INVESTIGATE' }],
      cupidPairExists: false,
    });
    // The Apprentice waits while the Seer lives; Villagers and the Mayor have no Night action.
    expect(outstanding.map((player) => player.displayName)).toEqual(['Cory', 'Gale', 'Wren']);
  });

  it('drops Cupid once the pair is set and wakes the Apprentice after the Seer dies', () => {
    const withoutSeer = players.map((player) => player.id === 'seer' ? { ...player, alive: false } : player);
    const outstanding = outstandingResponders({
      phase: { kind: 'NIGHT', status: 'OPEN' },
      players: withoutSeer,
      actions: [],
      cupidPairExists: true,
    });
    expect(outstanding.map((player) => player.displayName)).toEqual(['Ash', 'Gale', 'Wade', 'Wren']);
  });

  it('counts a response of the wrong kind as missing', () => {
    const outstanding = outstandingResponders({
      phase: { kind: 'NIGHT', status: 'OPEN' },
      players: players.filter((player) => player.id === 'guard'),
      actions: [{ actorId: 'guard', kind: 'DAY_VOTE' }],
      cupidPairExists: true,
    });
    expect(outstanding.map((player) => player.id)).toEqual(['guard']);
  });

  it.each(['LOCKED', 'PENDING_HUNTER', 'PENDING_APPROVAL', 'PUBLISHED'])('lists nobody while the phase is %s', (status) => {
    expect(outstandingResponders({ phase: { kind: 'DAY', status }, players, actions: [], cupidPairExists: false })).toEqual([]);
  });
});

describe('nudge message', () => {
  const deadline = '2026-10-02T15:00:00.000Z'; // Friday 09:00 in America/Regina (UTC-6).

  it('formats the deadline in the game timezone', () => {
    expect(formatDeadlineForChat(deadline, 'America/Regina')).toBe('Friday 09:00');
  });

  it('names who still has to vote on a Day', () => {
    expect(nudgeMessage({ kind: 'DAY', sequence: 3, closesAt: deadline, timeZone: 'America/Regina', outstandingNames: ['Sky', 'Vic'], siteUrl: 'https://werewolf.example.test' }))
      .toBe('Day 3 ballot closes Friday 09:00 (America/Regina). Still to vote: Sky, Vic. Save your vote at https://werewolf.example.test');
  });

  it('says everyone has voted when nobody is outstanding', () => {
    expect(nudgeMessage({ kind: 'FINAL_BALLOT', sequence: 9, closesAt: deadline, timeZone: 'America/Regina', outstandingNames: [], siteUrl: 'https://werewolf.example.test' }))
      .toBe('Final ballot closes Friday 09:00 (America/Regina). Everyone has voted; you can still change your vote at https://werewolf.example.test');
  });

  it('never names anyone, or counts them, on a Night', () => {
    const text = nudgeMessage({ kind: 'NIGHT', sequence: 4, closesAt: deadline, timeZone: 'America/Regina', outstandingNames: ['Wren', 'Gale'], siteUrl: 'https://werewolf.example.test' });
    expect(text).toBe('Night 4 closes Friday 09:00 (America/Regina). If your role has a night action, save it before Friday 09:00 at https://werewolf.example.test');
    expect(text).not.toMatch(/Wren|Gale|\b2\b|werewolf |seer|bodyguard|cupid/iu);
  });
});

describe('announcement copy', () => {
  it('builds an email with its subject and body', () => {
    expect(announcementEmailCopy({ emailSubject: '[Watercooler Werewolf] Office party', emailBody: 'No votes Friday.\n\nOpen Watercooler Werewolf for the official game state.' }))
      .toBe('Subject: [Watercooler Werewolf] Office party\n\nNo votes Friday.\n\nOpen Watercooler Werewolf for the official game state.');
  });

  it('builds a chat post with a bold title, the body, and the site link', () => {
    expect(announcementChatCopy({ title: 'Office party', body: 'No votes Friday.' }, 'https://werewolf.example.test'))
      .toBe('*Office party*\nNo votes Friday.\n\nhttps://werewolf.example.test');
  });
});
