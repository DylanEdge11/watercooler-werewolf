import { describe, expect, it } from 'vitest';
import { isSingleEmailAddress, MAX_EMAIL_LENGTH } from './email-address';

// The pattern this module used before it was made linear-time. Kept here only to
// prove the new check accepts and rejects exactly the same short addresses.
const PLAIN_PART = String.raw`[^\s@,;:<>"()[\]\\]+`;
const PREVIOUS_PATTERN = new RegExp(`^${PLAIN_PART}@${PLAIN_PART}\\.${PLAIN_PART}$`, 'u');

describe('isSingleEmailAddress', () => {
  it.each([
    'name@example.com',
    'ana.lee+werewolf@mail.corp.test',
    'a@b.c',
    'a@x.b.',
    'a@x..',
    "o'brien@example.com",
    'ünï@exämple.test',
  ])('accepts %s', (address) => {
    expect(isSingleEmailAddress(address)).toBe(true);
  });

  it.each([
    '',
    'plain',
    'name@example',
    '@example.com',
    'name@',
    'name@.com',
    'name@example.',
    'name@.',
    'a@b@c.test',
    'a@x.com;b@y.com',
    'a@x.com,b@y.com',
    'Ana <a@x.com>',
    '"Ana" a@x.com',
    'a b@x.com',
    'a@x .com',
    'a@x.com\n',
    'a@x.com\tb@y.com',
    '(c)a@x.com',
    'a[1]@x.com',
    'a\\b@x.com',
    'a:b@x.com',
  ])('rejects %j', (address) => {
    expect(isSingleEmailAddress(address)).toBe(false);
  });

  it('agrees with the previous pattern on every short string over a small alphabet', () => {
    const alphabet = ['a', '.', '@', ' ', ',', '<'];
    let checked = 0;
    const visit = (prefix: string, remaining: number) => {
      expect(isSingleEmailAddress(prefix), JSON.stringify(prefix)).toBe(PREVIOUS_PATTERN.test(prefix));
      checked += 1;
      if (!remaining) return;
      for (const letter of alphabet) visit(prefix + letter, remaining - 1);
    };
    visit('', 6);
    expect(checked).toBeGreaterThan(50_000);
  });

  it('refuses anything longer than 254 characters, even a well-formed address', () => {
    const local = 'a'.repeat(MAX_EMAIL_LENGTH - '@example.com'.length);
    expect(isSingleEmailAddress(`${local}@example.com`)).toBe(true);
    expect(isSingleEmailAddress(`${local}a@example.com`)).toBe(false);
  });

  it('stays fast on the long input that made the previous pattern take seconds', () => {
    for (const input of ['a@' + '.'.repeat(32_000) + ',', 'a@' + 'a.'.repeat(32_000), 'a'.repeat(64_000) + '@x', '@'.repeat(32_000), ('a@').repeat(16_000)]) {
      const start = performance.now();
      expect(isSingleEmailAddress(input)).toBe(false);
      expect(performance.now() - start).toBeLessThan(50);
    }
  });
});
