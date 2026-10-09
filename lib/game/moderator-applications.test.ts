import { describe, expect, it } from 'vitest';
import {
  applicationsAvailable,
  canTakeApplications,
  MAX_APPLICATION_NOTE_LENGTH,
  nextApplicationStatus,
  parseApplicationNote,
  setupLinkExpired,
  setupLinkExpiresAt,
  SETUP_LINK_DAYS,
} from './moderator-applications';

describe('taking applications', () => {
  it('is possible until the game is over', () => {
    for (const status of ['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW', 'ACTIVE', 'FINAL_SHOWDOWN']) expect(canTakeApplications(status).allowed).toBe(true);
    for (const status of ['CANCELLED', 'STOPPED', 'COMPLETED']) expect(canTakeApplications(status)).toMatchObject({ allowed: false });
  });

  it('shows the public form only while open and the game is not over', () => {
    expect(applicationsAvailable(true, 'REGISTRATION')).toBe(true);
    expect(applicationsAvailable(true, 'ACTIVE')).toBe(true);
    expect(applicationsAvailable(false, 'REGISTRATION')).toBe(false);
    expect(applicationsAvailable(true, 'COMPLETED')).toBe(false);
  });
});

describe('the applicant’s note', () => {
  it('is optional and tidied', () => {
    expect(parseApplicationNote(undefined)).toEqual({ ok: true, note: '' });
    expect(parseApplicationNote('  I ran\n the last   one.  ')).toEqual({ ok: true, note: 'I ran the last one.' });
  });

  it('has a length limit', () => {
    expect(parseApplicationNote('x'.repeat(MAX_APPLICATION_NOTE_LENGTH)).ok).toBe(true);
    expect(parseApplicationNote('x'.repeat(MAX_APPLICATION_NOTE_LENGTH + 1))).toMatchObject({ ok: false });
    expect(parseApplicationNote(3)).toMatchObject({ ok: false });
  });
});

describe('deciding an application', () => {
  it('approves or declines a waiting application', () => {
    expect(nextApplicationStatus('PENDING', 'APPROVE', false)).toBe('APPROVED');
    expect(nextApplicationStatus('PENDING', 'DECLINE', false)).toBe('DECLINED');
  });

  it('issues a fresh link when an approved application has not been used, or withdraws it', () => {
    expect(nextApplicationStatus('APPROVED', 'APPROVE', false)).toBe('APPROVED');
    expect(nextApplicationStatus('APPROVED', 'DECLINE', false)).toBe('DECLINED');
  });

  it('puts a declined application back, and nothing else', () => {
    expect(nextApplicationStatus('DECLINED', 'RECONSIDER', false)).toBe('PENDING');
    expect(nextApplicationStatus('PENDING', 'RECONSIDER', false)).toBeNull();
    expect(nextApplicationStatus('DECLINED', 'APPROVE', false)).toBeNull();
    expect(nextApplicationStatus('DECLINED', 'DECLINE', false)).toBeNull();
  });

  it('leaves a used application alone', () => {
    for (const decision of ['APPROVE', 'DECLINE', 'RECONSIDER'] as const) expect(nextApplicationStatus('APPROVED', decision, true)).toBeNull();
  });
});

describe('the setup link’s lifetime', () => {
  it('lasts seven days from approval', () => {
    expect(SETUP_LINK_DAYS).toBe(7);
    expect(setupLinkExpiresAt('2026-10-01T10:00:00.000Z')).toBe('2026-10-08T10:00:00.000Z');
    expect(setupLinkExpired('2026-10-01T10:00:00.000Z', new Date('2026-10-08T09:59:59.000Z'))).toBe(false);
    expect(setupLinkExpired('2026-10-01T10:00:00.000Z', new Date('2026-10-08T10:00:00.000Z'))).toBe(true);
  });

  it('is expired when there is no approval time', () => {
    expect(setupLinkExpired(null, new Date())).toBe(true);
  });
});
