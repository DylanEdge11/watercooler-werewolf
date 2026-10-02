import { describe, expect, it } from 'vitest';
import { allowedRoomTypes, normalizeChatBody } from './policy';

describe('private room access', () => {
  it('keeps living factions private, moves eliminated players into the dead room, and seats everyone in the Town Hall', () => {
    expect(allowedRoomTypes('WEREWOLF', true)).toEqual(['TOWN_HALL', 'WEREWOLF']);
    expect(allowedRoomTypes('MASON', false)).toEqual(['TOWN_HALL', 'MASON', 'DEAD']);
    expect(allowedRoomTypes('VILLAGER', false)).toEqual(['TOWN_HALL', 'DEAD']);
    expect(allowedRoomTypes('SEER', true)).toEqual(['TOWN_HALL']);
  });

  it('normalizes messages and enforces the size limit', () => {
    expect(normalizeChatBody('  hello\r\npack  ')).toBe('hello\npack');
    expect(() => normalizeChatBody('   ')).toThrow('empty');
    expect(() => normalizeChatBody('x'.repeat(1_001))).toThrow('1,000');
  });
});
