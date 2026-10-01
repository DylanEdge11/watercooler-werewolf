import { describe, expect, it } from 'vitest';
import { encodeRoomHistoryCursor, moderatorCanPost, moderatorPostBlockedReason, parseRoomHistoryCursor } from './moderator-chat';

describe('moderatorCanPost', () => {
  it('allows posting only in an open room while the game runs', () => {
    expect(moderatorCanPost('ACTIVE', 'OPEN')).toBe(true);
    expect(moderatorCanPost('FINAL_SHOWDOWN', 'OPEN')).toBe(true);
    expect(moderatorCanPost('ACTIVE', 'READ_ONLY')).toBe(false);
    expect(moderatorCanPost('ACTIVE', 'PURGED')).toBe(false);
    for (const status of ['DRAFT', 'STOPPED', 'COMPLETED', 'CANCELLED']) expect(moderatorCanPost(status, 'OPEN')).toBe(false);
  });

  it('explains why posting is blocked', () => {
    expect(moderatorPostBlockedReason('ACTIVE', 'OPEN')).toBeNull();
    expect(moderatorPostBlockedReason('ACTIVE', 'READ_ONLY')).toBe('This room is read-only. Reopen it to post.');
    expect(moderatorPostBlockedReason('COMPLETED', 'READ_ONLY')).toBe('Posting is open only while the game is running.');
  });
});

describe('room history cursor', () => {
  it('round-trips a message position', () => {
    const cursor = { createdAt: '2026-10-01T09:30:00.000Z', id: 'f3a1' };
    expect(parseRoomHistoryCursor(encodeRoomHistoryCursor(cursor))).toEqual(cursor);
    expect(parseRoomHistoryCursor(null)).toBeNull();
  });

  it('rejects malformed cursors', () => {
    expect(() => parseRoomHistoryCursor('not-a-date~abc')).toThrow('Invalid message cursor.');
    expect(() => parseRoomHistoryCursor('2026-10-01T09:30:00.000Z')).toThrow('Invalid message cursor.');
    expect(() => parseRoomHistoryCursor('2026-10-01T09:30:00.000Z~')).toThrow('Invalid message cursor.');
  });
});
