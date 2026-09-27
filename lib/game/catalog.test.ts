import { describe, expect, it } from 'vitest';
import { investigationMessage, ROLE_CATALOG, roleWithArticle } from './catalog';

describe('role catalog', () => {
  it('uses Bodyguard as the only village protective role', () => {
    expect(ROLE_CATALOG.BODYGUARD).toMatchObject({
      key: 'BODYGUARD',
      name: 'Bodyguard',
      actionKind: 'PROTECT',
      unique: true,
    });
    expect(Object.keys(ROLE_CATALOG)).not.toContain('DOCTOR');
  });
});

describe('role wording', () => {
  it('uses "the" for one-of-a-kind roles and "a" for the rest', () => {
    expect(roleWithArticle('SEER')).toBe('the Seer');
    expect(roleWithArticle('APPRENTICE_SEER')).toBe('the Apprentice Seer');
    expect(roleWithArticle('WEREWOLF')).toBe('a Werewolf');
    expect(roleWithArticle('VILLAGER')).toBe('a Villager');
  });

  it('writes the Seer result in words, never as a role code', () => {
    expect(investigationMessage('Ana', 'WEREWOLF')).toBe('Ana is a Werewolf.');
    expect(investigationMessage('Ben', 'APPRENTICE_SEER')).toBe('Ben is the Apprentice Seer.');
  });
});
