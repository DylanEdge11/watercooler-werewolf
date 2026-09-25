import { describe, expect, it } from 'vitest';
import { createInviteExport, parseRosterCsv } from './csv';

function validCsv(count = 20): string {
  return [
    'display_name,email',
    ...Array.from({ length: count }, (_, index) => `Player ${index + 1},player${index + 1}@example.com`),
  ].join('\n');
}

describe('roster CSV', () => {
  it.each([6, 19, 20, 80])('accepts a %i-player roster', (count) => {
    const result = parseRosterCsv(validCsv(count));
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(count);
  });

  it.each([5, 81])('rejects a %i-player roster', (count) => {
    const result = parseRosterCsv(validCsv(count));
    expect(result.entries).toHaveLength(count);
    expect(result.errors).toContain('The roster must contain between 6 and 80 valid players.');
  });

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

  // A cell holding several addresses would send one player's private claim
  // link to every address in it.
  it.each([
    'ana@corp.test;bob@corp.test',
    '"ana@corp.test,bob@corp.test"',
    'Ana <ana@corp.test>',
    '<ana@corp.test>',
    'ana@corp.test;',
    'ana@bob@corp.test',
  ])('rejects %s as more than one plain address', (cell) => {
    const result = parseRosterCsv(`${validCsv(20)}\nAna,${cell}`);
    expect(result.errors).toContain('Line 22: email must be one plain address, like name@example.com.');
    expect(result.entries.map((entry) => entry.displayName)).not.toContain('Ana');
  });

  it('accepts an apostrophe, which mail tools do not treat as a separator', () => {
    const result = parseRosterCsv(`${validCsv(20)}\nSean,sean.o'brien@corp.test`);
    expect(result.errors).toEqual([]);
  });

  it('accepts ordinary addresses, including plus aliases and subdomains', () => {
    const result = parseRosterCsv(`${validCsv(20)}\nAna,Ana.Lee+werewolf@mail.corp.test`);
    expect(result.errors).toEqual([]);
    expect(result.entries.at(-1)).toEqual({ displayName: 'Ana', email: 'ana.lee+werewolf@mail.corp.test' });
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
    expect(csv).not.toMatch(/"role"|"WEREWOLF"|"SEER"|"BODYGUARD"|"DOCTOR"|"HUNTER"|"MASON"/u);
  });
});
