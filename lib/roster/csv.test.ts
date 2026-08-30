import { describe, expect, it } from 'vitest';
import { createInviteExport, parseRosterCsv } from './csv';

function validCsv(count = 20): string {
  return [
    'display_name,email',
    ...Array.from({ length: count }, (_, index) => `Player ${index + 1},player${index + 1}@example.com`),
  ].join('\n');
}

describe('roster CSV', () => {
  it('parses the required headers and a valid 20-player roster', () => {
    const result = parseRosterCsv(validCsv());
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(20);
    expect(result.entries[0]).toEqual({ displayName: 'Player 1', email: 'player1@example.com' });
  });

  it('supports quoted names and identifies duplicate emails', () => {
    const result = parseRosterCsv(
      `${validCsv(19)}\n"Chen, Maya",player1@example.com`,
    );
    expect(result.errors).toContain('Line 21: email is duplicated.');
  });

  it('creates a private mail-merge export without exposing roles', () => {
    const csv = createInviteExport([
      {
        displayName: 'Maya Chen',
        email: 'maya@example.com',
        claimUrl: 'https://game.test/claim/abc',
        inviteCode: 'ABC123',
      },
    ]);
    expect(csv).toContain('Maya Chen');
    expect(csv).toContain('ABC123');
    expect(csv).not.toMatch(/"role"|"WEREWOLF"|"SEER"|"DOCTOR"|"HUNTER"|"MASON"/u);
  });
});
