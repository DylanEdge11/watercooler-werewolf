import { describe, expect, it } from 'vitest';
import { automaticStepDueAt, nextAutomaticStep, resolveAutomationSettings, type AutomationGame, type AutomationPhase } from './automation';

const now = new Date('2026-10-05T15:00:00.000Z');
const game: AutomationGame = { status: 'ACTIVE', publicationMode: 'AUTOMATIC', reviewWindowMinutes: 60, pausedAt: null };
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
