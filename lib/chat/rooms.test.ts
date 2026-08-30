import { describe, expect, it } from 'vitest';
import { allowedRoomTypes, normalizeChatBody } from './policy';

describe('private room access', () => {
  it('keeps living factions private and moves eliminated players into the dead room', () => {
    expect(allowedRoomTypes('WEREWOLF', true)).toEqual(['WEREWOLF']);
    expect(allowedRoomTypes('MASON', false)).toEqual(['MASON', 'DEAD']);
    expect(allowedRoomTypes('VILLAGER', false)).toEqual(['DEAD']);
    expect(allowedRoomTypes('SEER', true)).toEqual([]);
  });

  it('normalizes messages and enforces the size limit', () => {
    expect(normalizeChatBody('  hello\r\npack  ')).toBe('hello\npack');
    expect(() => normalizeChatBody('   ')).toThrow('empty');
    expect(() => normalizeChatBody('x'.repeat(1_001))).toThrow('1,000');
  });
});
