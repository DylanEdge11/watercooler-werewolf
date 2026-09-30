import { describe, expect, test, vi } from 'vitest';

vi.mock('../../db', () => ({ getDb: () => ({}) }));

import { emailNotificationsAvailable, siteOrigin } from './config';
import { closingReminderDue } from './notifications';

const smtp = { SMTP_HOST: 'smtp.example.io', SMTP_USER: 'sender', SMTP_PASSWORD: 'fictional', EMAIL_FROM: 'Game <game@example.io>' };

describe('email availability', () => {
  test('needs both a mail account and a site address', () => {
    expect(emailNotificationsAvailable({ ...smtp, SITE_ORIGIN: 'https://game.example.io' })).toBe(true);
    expect(emailNotificationsAvailable({ SITE_ORIGIN: 'https://game.example.io' })).toBe(false);
    expect(emailNotificationsAvailable({ ...smtp })).toBe(false);
  });

  test('uses SITE_ORIGIN, then the Vercel deployment address, and ignores anything that is not a web address', () => {
    expect(siteOrigin({ SITE_ORIGIN: 'https://game.example.io/some/path' })).toBe('https://game.example.io');
    expect(siteOrigin({ VERCEL_URL: 'game-git-branch.vercel.app' })).toBe('https://game-git-branch.vercel.app');
    expect(siteOrigin({ SITE_ORIGIN: 'javascript:alert(1)' })).toBeNull();
    expect(siteOrigin({ SITE_ORIGIN: 'not a url' })).toBeNull();
    expect(siteOrigin({})).toBeNull();
  });
});

describe('closing reminder timing', () => {
  const phase = { status: 'OPEN', opensAt: '2026-10-07T09:00:00.000Z', closesAt: '2026-10-09T09:00:00.000Z', closingReminderAt: null };
  const at = (iso: string) => new Date(iso);

  test('is due only in the last thirty minutes', () => {
    expect(closingReminderDue(phase, at('2026-10-09T08:29:59.000Z'))).toBe(false);
    expect(closingReminderDue(phase, at('2026-10-09T08:30:00.000Z'))).toBe(true);
    expect(closingReminderDue(phase, at('2026-10-09T08:59:00.000Z'))).toBe(true);
    expect(closingReminderDue(phase, at('2026-10-09T09:00:00.000Z'))).toBe(false);
  });

  test('is not due once sent, for a phase that is not open, or for a phase of an hour or less', () => {
    expect(closingReminderDue({ ...phase, closingReminderAt: '2026-10-09T08:31:00.000Z' }, at('2026-10-09T08:40:00.000Z'))).toBe(false);
    expect(closingReminderDue({ ...phase, status: 'LOCKED' }, at('2026-10-09T08:40:00.000Z'))).toBe(false);
    expect(closingReminderDue({ ...phase, opensAt: '2026-10-09T08:00:00.000Z' }, at('2026-10-09T08:40:00.000Z'))).toBe(false);
    expect(closingReminderDue({ ...phase, opensAt: '2026-10-09T08:00:01.000Z' }, at('2026-10-09T08:40:00.000Z'))).toBe(false);
    expect(closingReminderDue({ ...phase, opensAt: '2026-10-09T07:59:00.000Z' }, at('2026-10-09T08:40:00.000Z'))).toBe(true);
  });
});
