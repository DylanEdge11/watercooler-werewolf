import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS } from './player-count';
import {
  canOpenSignups,
  canReviewSignups,
  cleanText,
  describeAcceptance,
  formatStartDate,
  honeypotFilled,
  MAX_NAME_LENGTH,
  MAX_SIGNUP_NOTE_LENGTH,
  nextSignupState,
  parsePerson,
  parseSignupNote,
  planAcceptance,
  publicSignupAvailability,
  type PendingSignup,
} from './signups';

describe('opening sign-ups', () => {
  it('is allowed only before roles are randomized', () => {
    expect(canOpenSignups('DRAFT', false).allowed).toBe(true);
    expect(canOpenSignups('REGISTRATION', false).allowed).toBe(true);
    for (const status of ['ASSIGNMENT_PREVIEW', 'ACTIVE', 'STOPPED', 'COMPLETED', 'CANCELLED', 'ROSTER_IMPORTING']) {
      expect(canOpenSignups(status, false)).toMatchObject({ allowed: false, error: expect.stringContaining('before roles are randomized') });
    }
    expect(canOpenSignups('REGISTRATION', true).allowed).toBe(false);
  });

  it('moves between open and closed, and closing something never opened changes nothing', () => {
    expect(nextSignupState('NOT_OPEN', 'OPEN')).toBe('OPEN');
    expect(nextSignupState('OPEN', 'CLOSE')).toBe('CLOSED');
    expect(nextSignupState('CLOSED', 'OPEN')).toBe('OPEN');
    expect(nextSignupState('CLOSED', 'CLOSE')).toBe('CLOSED');
    expect(nextSignupState('NOT_OPEN', 'CLOSE')).toBe('NOT_OPEN');
  });
});

describe('what the public link offers', () => {
  it('is open only while the moderator has it open and the roster can change', () => {
    expect(publicSignupAvailability('OPEN', 'REGISTRATION')).toBe('OPEN');
    expect(publicSignupAvailability('OPEN', 'DRAFT')).toBe('OPEN');
    expect(publicSignupAvailability('CLOSED', 'REGISTRATION')).toBe('CLOSED');
    expect(publicSignupAvailability('NOT_OPEN', 'REGISTRATION')).toBe('NOT_OPEN');
  });

  it('pauses while roles are randomized and ends with the game', () => {
    for (const status of ['ASSIGNMENT_PREVIEW', 'ACTIVE', 'CANCELLED', 'COMPLETED']) {
      expect(publicSignupAvailability('OPEN', status)).toBe('CLOSED');
    }
  });
});

describe('reviewing the list', () => {
  it('stays possible until the game starts', () => {
    for (const status of ['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW']) expect(canReviewSignups(status, false).allowed).toBe(true);
    expect(canReviewSignups('ACTIVE', true)).toMatchObject({ allowed: false });
    expect(canReviewSignups('REGISTRATION', true).allowed).toBe(false);
    expect(canReviewSignups('CANCELLED', false).allowed).toBe(false);
  });
});

describe('what people type on the form', () => {
  it('takes a name and one plain email, lower-cased and tidied', () => {
    expect(parsePerson({ displayName: '  Ada   Lovelace ', email: ' Ada@Work.Example ' })).toEqual({ ok: true, displayName: 'Ada Lovelace', email: 'ada@work.example' });
  });

  it('refuses a missing or over-long name', () => {
    expect(parsePerson({ displayName: '   ', email: 'a@b.co' })).toMatchObject({ ok: false });
    expect(parsePerson({ displayName: 'x'.repeat(MAX_NAME_LENGTH + 1), email: 'a@b.co' })).toMatchObject({ ok: false });
    expect(parsePerson({ displayName: 'x'.repeat(MAX_NAME_LENGTH), email: 'a@b.co' }).ok).toBe(true);
    expect(parsePerson(null)).toMatchObject({ ok: false });
  });

  it('refuses an address list or a name with the address, which would send one link to several people', () => {
    for (const email of ['a@x.com;b@y.com', 'Ada <a@x.com>', 'a@x.com, b@y.com', 'no-at-sign', '']) {
      expect(parsePerson({ displayName: 'Ada', email })).toMatchObject({ ok: false });
    }
    expect(parsePerson({ displayName: 'Ada', email: `${'a'.repeat(250)}@x.com` })).toMatchObject({ ok: false });
  });

  it('drops control characters from a name', () => {
    expect(cleanText('Ada\u0000\n\tLovelace\u007f')).toBe('Ada Lovelace');
    expect(cleanText(42)).toBe('');
  });

  it('spots a filled-in hidden field', () => {
    expect(honeypotFilled({ website: 'http://spam.example' })).toBe(true);
    expect(honeypotFilled({ website: '   ' })).toBe(false);
    expect(honeypotFilled({})).toBe(false);
    expect(honeypotFilled(null)).toBe(false);
  });
});

describe('the moderator’s note on the sign-up page', () => {
  it('is optional and keeps line breaks', () => {
    expect(parseSignupNote(undefined)).toEqual({ ok: true, note: '' });
    expect(parseSignupNote(null)).toEqual({ ok: true, note: '' });
    expect(parseSignupNote('  Bring snacks.\r\n\r\n\r\n\r\nSee you there.  ')).toEqual({ ok: true, note: 'Bring snacks.\n\nSee you there.' });
  });

  it('has a length limit and refuses what can’t be shown', () => {
    expect(parseSignupNote('x'.repeat(MAX_SIGNUP_NOTE_LENGTH)).ok).toBe(true);
    expect(parseSignupNote('x'.repeat(MAX_SIGNUP_NOTE_LENGTH + 1))).toMatchObject({ ok: false });
    expect(parseSignupNote('a\u0000b')).toMatchObject({ ok: false });
    expect(parseSignupNote(7)).toMatchObject({ ok: false });
  });
});

describe('the start date shown to players', () => {
  it('names the weekday and month, with no timezone shift', () => {
    expect(formatStartDate('2026-10-05')).toBe('Monday, October 5');
    expect(formatStartDate('2026-01-01')).toBe('Thursday, January 1');
  });

  it('shows an unreadable date as written', () => {
    expect(formatStartDate('soon')).toBe('soon');
  });
});

describe('accepting sign-ups', () => {
  const signup = (id: string, email: string, createdAt: string): PendingSignup => ({ id, displayName: id, email, createdAt });

  it('adds the oldest first and marks people already on the roster', () => {
    const plan = planAcceptance({
      signups: [signup('c', 'c@x.test', '2026-01-03'), signup('a', 'a@x.test', '2026-01-01'), signup('b', 'b@x.test', '2026-01-02')],
      seatCount: 4,
      rosterEmails: new Set(['b@x.test']),
    });
    expect(plan.add.map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(plan.onRoster.map((entry) => entry.id)).toEqual(['b']);
    expect(plan.full).toEqual([]);
  });

  it('leaves the newest waiting when the roster fills up', () => {
    const signups = Array.from({ length: 5 }, (_, index) => signup(`s${index}`, `s${index}@x.test`, `2026-01-0${index + 1}`));
    const plan = planAcceptance({ signups, seatCount: MAX_PLAYERS - 3, rosterEmails: new Set() });
    expect(plan.add.map((entry) => entry.id)).toEqual(['s0', 's1', 's2']);
    expect(plan.full.map((entry) => entry.id)).toEqual(['s3', 's4']);
  });

  it('adds nobody to a full roster', () => {
    const plan = planAcceptance({ signups: [signup('a', 'a@x.test', '2026-01-01')], seatCount: MAX_PLAYERS, rosterEmails: new Set() });
    expect(plan.add).toEqual([]);
    expect(plan.full).toHaveLength(1);
  });

  it('breaks a tie on time by id, so the order is stable', () => {
    const plan = planAcceptance({ signups: [signup('b', 'b@x.test', '2026-01-01'), signup('a', 'a@x.test', '2026-01-01')], seatCount: 0, rosterEmails: new Set() });
    expect(plan.add.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('describes what happened in one line', () => {
    const base = { add: [signup('a', 'a@x.test', '1')], onRoster: [], full: [] };
    expect(describeAcceptance(base)).toBe('1 player added to the roster.');
    expect(describeAcceptance({ ...base, add: [base.add[0], signup('b', 'b@x.test', '2')] })).toBe('2 players added to the roster.');
    expect(describeAcceptance({ add: [], onRoster: [signup('b', 'b@x.test', '2')], full: [signup('c', 'c@x.test', '3'), signup('d', 'd@x.test', '4')] }))
      .toBe(`0 players added to the roster. 1 was already on it. 2 are still waiting because a game holds at most ${MAX_PLAYERS} players.`);
  });
});
