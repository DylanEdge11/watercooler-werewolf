import { describe, expect, test } from 'vitest';
import { closingSoonMessage, phaseName, phaseOpenedMessage, resultPublishedMessage, unsubscribePageUrl, unsubscribePostUrl } from './messages';

const origin = 'https://game.example.io';
const recipient = { displayName: 'Ana Fictional', unsubscribeToken: 'token-abc_123' };
const phase = { gameName: 'Office Campaign', kind: 'DAY' as const, sequence: 3, closesAt: '2026-10-09T08:00:00.000Z', timeZone: 'Europe/London' };

const ROLE_WORDS = /werewolf|wolf|seer|bodyguard|hunter|mason|mayor|cupid|villager|role/iu;

describe('player email wording', () => {
  test('names phases the way the Timeline does', () => {
    expect(phaseName('DAY', 3)).toBe('Day 2');
    expect(phaseName('NIGHT', 4)).toBe('Night 2');
    expect(phaseName('FINAL_BALLOT', 9)).toBe('The final ballot');
  });

  test('a phase-opened email gives the deadline in the game timezone and a working unsubscribe link', () => {
    const email = phaseOpenedMessage(origin, recipient, phase);
    expect(email.subject).toBe('Office Campaign: Day 2 is open');
    expect(email.text).toContain('Hi Ana Fictional,');
    expect(email.text).toContain('before Friday 09:00 (Europe/London)');
    expect(email.text).toContain(`Open the game: ${origin}`);
    expect(email.text).toContain(`Turn them off here: ${unsubscribePageUrl(origin, 'token-abc_123')}`);
    expect(email.unsubscribeUrl).toBe(unsubscribePostUrl(origin, 'token-abc_123'));
  });

  test('a closes-soon email says the move is not saved yet', () => {
    const email = closingSoonMessage(origin, recipient, phase);
    expect(email.subject).toBe('Office Campaign: Day 2 closes soon');
    expect(email.text).toContain('closes at Friday 09:00 (Europe/London) and you have not saved your move yet');
  });

  test('a result email carries the story and the link, and the final ballot reads naturally', () => {
    const email = resultPublishedMessage(origin, recipient, { gameName: 'Office Campaign', kind: 'FINAL_BALLOT', sequence: 9 }, 'The village has spoken.');
    expect(email.subject).toBe('Office Campaign: the final ballot result is in');
    expect(email.text).toContain('The village has spoken.');
    expect(email.text).toContain(`See the full result and what happens next: ${origin}`);
  });

  test('no email names a role or says what kind of move is due, on a Day or a Night', () => {
    for (const kind of ['DAY', 'NIGHT', 'FINAL_BALLOT'] as const) {
      for (const email of [
        phaseOpenedMessage(origin, recipient, { ...phase, kind }),
        closingSoonMessage(origin, recipient, { ...phase, kind }),
      ]) {
        // The game's own name is not a role.
        expect(`${email.subject}\n${email.text}`.replaceAll('Watercooler Werewolf', '')).not.toMatch(ROLE_WORDS);
      }
    }
  });

  test('unsubscribe links escape the token', () => {
    expect(unsubscribePageUrl(origin, 'a b&c')).toBe(`${origin}/email/unsubscribe?token=a%20b%26c`);
  });
});
