import { describe, expect, it } from 'vitest';
import { automaticStepDueAt, nextAutomaticStep, resolveAutoOpenNextPhase, resolveAutomationSettings, type AutomationGame, type AutomationPhase } from './automation';

const now = new Date('2026-10-05T15:00:00.000Z');
const game: AutomationGame = {
  status: 'ACTIVE',
  publicationMode: 'AUTOMATIC',
  reviewWindowMinutes: 60,
  pausedAt: null,
  autoOpenNextPhase: false,
  timezone: 'UTC',
  schedule: { dayCloses: '17:00', nightCloses: '08:00', activeWeekdays: [1, 2, 3, 4, 5] },
  finalCutoffAt: '2026-12-01T00:00:00.000Z',
};
function phase(partial: Partial<AutomationPhase>): AutomationPhase {
  return { id: 'p1', status: 'OPEN', closesAt: '2026-10-05T16:00:00.000Z', hunterDeadlineAt: null, updatedAt: '2026-10-05T14:00:00.000Z', hunterShotSaved: false, ...partial };
}

describe('next automatic step', () => {
  it('waits while an open phase is still before its deadline', () => {
    expect(nextAutomaticStep(game, phase({}), now)).toBeNull();
  });

  it('locks and calculates an open phase at its deadline, and a phase already locked', () => {
    expect(nextAutomaticStep(game, phase({ closesAt: '2026-10-05T15:00:00.000Z' }), now)).toEqual({ kind: 'LOCK_AND_PROPOSE', phaseId: 'p1' });
    expect(nextAutomaticStep(game, phase({ status: 'LOCKED' }), now)).toEqual({ kind: 'LOCK_AND_PROPOSE', phaseId: 'p1' });
  });

  it('publishes only after the review window has passed since the result was calculated', () => {
    expect(nextAutomaticStep(game, phase({ status: 'PENDING_APPROVAL', updatedAt: '2026-10-05T14:00:01.000Z' }), now)).toBeNull();
    expect(nextAutomaticStep(game, phase({ status: 'PENDING_APPROVAL', updatedAt: '2026-10-05T14:00:00.000Z' }), now))
      .toEqual({ kind: 'PUBLISH', phaseId: 'p1', reviewCutoff: '2026-10-05T14:00:00.000Z' });
  });

  it('publishes straight away with a zero-minute window', () => {
    expect(nextAutomaticStep({ ...game, reviewWindowMinutes: 0 }, phase({ status: 'PENDING_APPROVAL', updatedAt: now.toISOString() }), now))
      .toMatchObject({ kind: 'PUBLISH' });
  });

  it('finishes a Hunter follow-up once the shot is saved or the window has closed', () => {
    const waiting = phase({ status: 'PENDING_HUNTER', hunterDeadlineAt: '2026-10-05T18:00:00.000Z' });
    expect(nextAutomaticStep(game, waiting, now)).toBeNull();
    expect(nextAutomaticStep(game, { ...waiting, hunterShotSaved: true }, now)).toEqual({ kind: 'FINALIZE_HUNTER', phaseId: 'p1', skipHunter: false });
    expect(nextAutomaticStep(game, { ...waiting, hunterDeadlineAt: '2026-10-05T15:00:00.000Z' }, now)).toEqual({ kind: 'FINALIZE_HUNTER', phaseId: 'p1', skipHunter: true });
  });

  it('never acts in review mode, while paused, or when the game is not running', () => {
    const due = phase({ status: 'PENDING_APPROVAL', updatedAt: '2026-10-01T00:00:00.000Z' });
    expect(nextAutomaticStep({ ...game, publicationMode: 'REVIEW' }, due, now)).toBeNull();
    expect(nextAutomaticStep({ ...game, pausedAt: '2026-10-05T10:00:00.000Z' }, due, now)).toBeNull();
    for (const status of ['REGISTRATION', 'COMPLETED', 'STOPPED', 'CANCELLED']) {
      expect(nextAutomaticStep({ ...game, status }, due, now)).toBeNull();
    }
    expect(nextAutomaticStep({ ...game, status: 'FINAL_SHOWDOWN' }, due, now)).toMatchObject({ kind: 'PUBLISH' });
  });

  it('leaves in-flight and finished phases alone', () => {
    for (const status of ['PUBLISHING', 'HUNTER_FINALIZING', 'PUBLISHED', 'SUPERSEDED']) {
      expect(nextAutomaticStep(game, phase({ status, closesAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }), now)).toBeNull();
    }
    expect(nextAutomaticStep(game, null, now)).toBeNull();
  });
});

describe('when the next automatic step is due', () => {
  it('reports the lock, Hunter, and publish times, and nothing when automation is off', () => {
    expect(automaticStepDueAt(game, phase({}))).toEqual({ kind: 'LOCK_AND_PROPOSE', at: '2026-10-05T16:00:00.000Z' });
    expect(automaticStepDueAt(game, phase({ status: 'PENDING_HUNTER', hunterDeadlineAt: '2026-10-05T18:00:00.000Z' }))).toEqual({ kind: 'FINALIZE_HUNTER', at: '2026-10-05T18:00:00.000Z' });
    expect(automaticStepDueAt(game, phase({ status: 'PENDING_APPROVAL', updatedAt: '2026-10-05T14:30:00.000Z' }))).toEqual({ kind: 'PUBLISH', at: '2026-10-05T15:30:00.000Z' });
    expect(automaticStepDueAt({ ...game, pausedAt: 'x' }, phase({}))).toBeNull();
    expect(automaticStepDueAt({ ...game, publicationMode: 'REVIEW' }, phase({}))).toBeNull();
  });
});

describe('opening the next phase', () => {
  const opening: AutomationGame = { ...game, autoOpenNextPhase: true };
  const afterNight = { kind: 'NIGHT', status: 'PUBLISHED' };
  const afterDay = { kind: 'DAY', status: 'PUBLISHED' };

  it('stays off unless the moderator turned it on', () => {
    expect(nextAutomaticStep(game, null, now, afterNight)).toBeNull();
  });

  it('opens a Day after a published Night, closing at the game\'s next Day close time', () => {
    expect(nextAutomaticStep(opening, null, now, afterNight)).toEqual({ kind: 'OPEN_NEXT', phaseKind: 'DAY', closesAt: '2026-10-05T17:00:00.000Z' });
  });

  it('opens a Night after a published Day, closing at the next Night close time', () => {
    expect(nextAutomaticStep(opening, null, now, afterDay)).toEqual({ kind: 'OPEN_NEXT', phaseKind: 'NIGHT', closesAt: '2026-10-06T08:00:00.000Z' });
  });

  it('skips days the game is not played and times too close to give players a fair window', () => {
    // Friday evening: the Night closes on the next active day, Monday morning.
    expect(nextAutomaticStep(opening, null, new Date('2026-10-09T18:00:00.000Z'), afterDay)).toMatchObject({ phaseKind: 'NIGHT', closesAt: '2026-10-12T08:00:00.000Z' });
    // Ten minutes before today's Day close, the Day runs to tomorrow's close instead.
    expect(nextAutomaticStep(opening, null, new Date('2026-10-05T16:50:00.000Z'), afterNight)).toMatchObject({ phaseKind: 'DAY', closesAt: '2026-10-06T17:00:00.000Z' });
  });

  it('never opens in review mode, while paused, or when the game is not in its regular rounds', () => {
    expect(nextAutomaticStep({ ...opening, publicationMode: 'REVIEW' }, null, now, afterNight)).toBeNull();
    expect(nextAutomaticStep({ ...opening, pausedAt: '2026-10-05T10:00:00.000Z' }, null, now, afterNight)).toBeNull();
    for (const status of ['REGISTRATION', 'FINAL_SHOWDOWN', 'COMPLETED', 'STOPPED', 'CANCELLED']) {
      expect(nextAutomaticStep({ ...opening, status }, null, now, afterNight)).toBeNull();
    }
  });

  it('waits for a published result, and leaves the first Day and the final ballot to the moderator', () => {
    expect(nextAutomaticStep(opening, null, now, null)).toBeNull();
    for (const status of ['OPEN', 'LOCKED', 'PENDING_HUNTER', 'PENDING_APPROVAL', 'PUBLISHING', 'SUPERSEDED']) {
      expect(nextAutomaticStep(opening, null, now, { kind: 'NIGHT', status })).toBeNull();
    }
    expect(nextAutomaticStep(opening, null, now, { kind: 'FINAL_BALLOT', status: 'PUBLISHED' })).toBeNull();
  });

  it('does not open anything while a phase is still in progress', () => {
    expect(nextAutomaticStep(opening, phase({ status: 'PENDING_APPROVAL', updatedAt: '2026-10-05T14:30:00.000Z' }), now, afterNight)).toBeNull();
  });

  it('stops short of the final cutoff, so final showdown stays with the moderator', () => {
    expect(nextAutomaticStep({ ...opening, finalCutoffAt: '2026-10-05T16:59:59.000Z' }, null, now, afterNight)).toBeNull();
    expect(nextAutomaticStep({ ...opening, finalCutoffAt: '2026-10-05T17:00:00.000Z' }, null, now, afterNight)).toMatchObject({ kind: 'OPEN_NEXT' });
  });

  it('does nothing when the game has no usable close times', () => {
    expect(nextAutomaticStep({ ...opening, schedule: null }, null, now, afterNight)).toBeNull();
    expect(nextAutomaticStep({ ...opening, schedule: { dayCloses: '', nightCloses: '' } }, null, now, afterNight)).toBeNull();
  });

  it('is not reported as a step due later, because it happens as soon as a result publishes', () => {
    expect(automaticStepDueAt(opening, null)).toBeNull();
  });
});

describe('opening the next phase: setting', () => {
  it('takes true or false, keeps the current value when left out, and rejects anything else', () => {
    expect(resolveAutoOpenNextPhase(true, false)).toEqual({ value: true, errors: [] });
    expect(resolveAutoOpenNextPhase(false, true)).toEqual({ value: false, errors: [] });
    expect(resolveAutoOpenNextPhase(undefined, true)).toEqual({ value: true, errors: [] });
    expect(resolveAutoOpenNextPhase(null, false)).toEqual({ value: false, errors: [] });
    expect(resolveAutoOpenNextPhase('yes', false)).toEqual({ value: false, errors: ['Choose whether the next Day or Night opens automatically.'] });
  });
});

describe('automation settings', () => {
  it('accepts a mode and a whole-minute window from 0 to 1440', () => {
    expect(resolveAutomationSettings({ publicationMode: 'AUTOMATIC', reviewWindowMinutes: '30' }, { publicationMode: 'REVIEW', reviewWindowMinutes: 60 }))
      .toEqual({ settings: { publicationMode: 'AUTOMATIC', reviewWindowMinutes: 30 }, errors: [] });
    expect(resolveAutomationSettings({}, { publicationMode: 'REVIEW', reviewWindowMinutes: 60 }).settings).toEqual({ publicationMode: 'REVIEW', reviewWindowMinutes: 60 });
  });

  it.each([
    [{ publicationMode: 'SOMETIMES' }, 'Choose automatic publication or moderator review.'],
    [{ reviewWindowMinutes: -1 }, 'The review window must be a whole number of minutes from 0 to 1440.'],
    [{ reviewWindowMinutes: 1441 }, 'The review window must be a whole number of minutes from 0 to 1440.'],
    [{ reviewWindowMinutes: 2.5 }, 'The review window must be a whole number of minutes from 0 to 1440.'],
  ])('rejects %j', (input, message) => {
    expect(resolveAutomationSettings(input, { publicationMode: 'REVIEW', reviewWindowMinutes: 60 }).errors).toEqual([message]);
  });
});
