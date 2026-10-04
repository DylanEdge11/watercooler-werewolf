import { describe, expect, it } from 'vitest';
import { attentionEventCount, CONSOLE_TABS, defaultConsoleTab, isConsoleTabId, launchChecklist, runHint, runNeedsAttention, setupHint } from './console-guidance';

describe('console tabs', () => {
  it('names five tabs with unique ids and a one-line purpose each', () => {
    expect(CONSOLE_TABS.map((tab) => tab.id)).toEqual(['setup', 'run', 'people', 'messages', 'safety']);
    expect(new Set(CONSOLE_TABS.map((tab) => tab.label)).size).toBe(CONSOLE_TABS.length);
    for (const tab of CONSOLE_TABS) expect(tab.blurb.length).toBeGreaterThan(20);
  });

  it('recognises tab ids and nothing else', () => {
    expect(isConsoleTabId('run')).toBe(true);
    expect(isConsoleTabId('safety')).toBe(true);
    expect(isConsoleTabId('Run')).toBe(false);
    expect(isConsoleTabId('')).toBe(false);
  });

  it('opens on Setup until roles are released, then on Run game', () => {
    for (const status of ['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW', 'CANCELLED', 'ROSTER_IMPORTING', 'RESETTING']) {
      expect(defaultConsoleTab(status)).toBe('setup');
    }
    for (const status of ['ACTIVE', 'FINAL_SHOWDOWN', 'COMPLETED', 'STOPPED']) {
      expect(defaultConsoleTab(status)).toBe('run');
    }
    expect(defaultConsoleTab(undefined)).toBe('setup');
  });
});

describe('launch checklist', () => {
  const base = { gameCount: 0, seatCount: 0, claimedCount: 0, hasBatch: false, released: false };

  it('starts with the schedule as the one thing to do', () => {
    expect(launchChecklist(base)).toEqual({ schedule: 'active', roster: 'todo', roles: 'todo', release: 'todo' });
  });

  it('moves one step at a time as the setup advances', () => {
    expect(launchChecklist({ ...base, gameCount: 1 })).toEqual({ schedule: 'done', roster: 'active', roles: 'todo', release: 'todo' });
    expect(launchChecklist({ ...base, gameCount: 1, seatCount: 8 })).toEqual({ schedule: 'done', roster: 'done', roles: 'active', release: 'todo' });
    expect(launchChecklist({ ...base, gameCount: 1, seatCount: 8, claimedCount: 8, hasBatch: true })).toEqual({ schedule: 'done', roster: 'done', roles: 'done', release: 'active' });
    expect(launchChecklist({ ...base, gameCount: 1, seatCount: 8, claimedCount: 8, hasBatch: true, released: true })).toEqual({ schedule: 'done', roster: 'done', roles: 'done', release: 'done' });
  });
});

describe('setup hint', () => {
  const setup = { status: 'REGISTRATION', seatCount: 0, claimedCount: 0, hasBatch: false, released: false };

  it('asks for the roster first, with the player limits', () => {
    const hint = setupHint(setup);
    expect(hint?.title).toBe('Next: add your players');
    expect(hint?.detail).toContain('6 to 80 players');
    expect(hint?.step).toBe('roster');
  });

  it('counts the players still to claim, in the singular too', () => {
    expect(setupHint({ ...setup, seatCount: 8, claimedCount: 5 })?.title).toBe('Waiting for 3 players to claim a seat');
    expect(setupHint({ ...setup, seatCount: 8, claimedCount: 7 })?.title).toBe('Waiting for 1 player to claim a seat');
    expect(setupHint({ ...setup, seatCount: 8, claimedCount: 5 })?.step).toBe('roster');
  });

  it('moves on to the roles once everyone has claimed, then to release', () => {
    expect(setupHint({ ...setup, seatCount: 8, claimedCount: 8 })?.title).toBe('Next: balance the roles');
    expect(setupHint({ ...setup, seatCount: 8, claimedCount: 8 })?.step).toBe('roles');
    const preview = setupHint({ ...setup, status: 'ASSIGNMENT_PREVIEW', seatCount: 8, claimedCount: 8, hasBatch: true });
    expect(preview?.title).toBe('Next: review and release the roles');
    expect(preview?.detail).toContain('permanent');
    expect(preview?.step).toBe('release');
  });

  it('says nothing while a game runs or after it was cancelled, but marks the end of a game', () => {
    expect(setupHint({ ...setup, status: 'ACTIVE', seatCount: 8, claimedCount: 8, hasBatch: true, released: true })).toBeNull();
    expect(setupHint({ ...setup, status: 'FINAL_SHOWDOWN' })).toBeNull();
    expect(setupHint({ ...setup, status: 'CANCELLED' })).toBeNull();
    expect(setupHint({ ...setup, status: undefined })).toBeNull();
    expect(setupHint({ ...setup, status: 'COMPLETED' })?.title).toBe('The game is over');
    expect(setupHint({ ...setup, status: 'COMPLETED' })?.step).toBeUndefined();
    expect(setupHint({ ...setup, status: 'STOPPED' })?.title).toBe('This game was stopped');
  });
});

describe('run hint', () => {
  const phase = (status: string, kind = 'DAY', sequence = 1) => ({ kind, sequence, status });

  it('says which phase to open when none is open', () => {
    expect(runHint({ status: 'ACTIVE', current: null, lastPublishedKind: null })?.title).toBe('Open the first Day');
    expect(runHint({ status: 'ACTIVE', current: null, lastPublishedKind: 'DAY' })?.title).toBe('Open the next Night');
    expect(runHint({ status: 'ACTIVE', current: null, lastPublishedKind: 'NIGHT' })?.title).toBe('Open the next Day');
    expect(runHint({ status: 'FINAL_SHOWDOWN', current: null, lastPublishedKind: 'DAY' })?.title).toBe('Open the final ballot');
  });

  it('follows the current phase from collecting to published', () => {
    expect(runHint({ status: 'ACTIVE', current: phase('OPEN'), lastPublishedKind: null })?.title).toBe('Day 1 is collecting responses');
    expect(runHint({ status: 'ACTIVE', current: phase('LOCKED', 'NIGHT', 2), lastPublishedKind: 'DAY' })?.title).toBe('Night 1 is locked');
    expect(runHint({ status: 'ACTIVE', current: phase('PENDING_APPROVAL'), lastPublishedKind: null })?.title).toBe('Day 1 has a result to review');
    expect(runHint({ status: 'ACTIVE', current: phase('PENDING_HUNTER'), lastPublishedKind: null })?.title).toBe('Day 1 is waiting on the Hunter');
    expect(runHint({ status: 'ACTIVE', current: phase('HUNTER_FINALIZING'), lastPublishedKind: null })?.title).toBe('Day 1 is waiting on the Hunter');
  });

  it('is quiet when the game is over or the phase has no next step', () => {
    for (const status of ['COMPLETED', 'STOPPED', 'CANCELLED', undefined]) {
      expect(runHint({ status, current: null, lastPublishedKind: null })).toBeNull();
    }
    expect(runHint({ status: 'ACTIVE', current: phase('SOMETHING_ELSE'), lastPublishedKind: null })).toBeNull();
  });
});

describe('run needs attention', () => {
  it('flags only the phase states where the moderator has something to do', () => {
    for (const status of ['LOCKED', 'PENDING_APPROVAL', 'PENDING_HUNTER', 'HUNTER_FINALIZING']) expect(runNeedsAttention(status)).toBe(true);
    for (const status of ['OPEN', 'PUBLISHED', 'SUPERSEDED', undefined]) expect(runNeedsAttention(status)).toBe(false);
  });
});

describe('attention event count', () => {
  it('counts failed email batches and automatic steps that could not run', () => {
    expect(attentionEventCount([
      { severity: 'WARNING', source: 'EMAIL' },
      { severity: 'WARNING', source: 'AUTOMATION' },
      { severity: 'WARNING', source: 'AUTOMATION' },
    ])).toBe(3);
  });

  it('does not count the moderator’s own audited actions, even though the log marks them as warnings', () => {
    expect(attentionEventCount([
      { severity: 'WARNING', source: 'GAME_CONTROL' },
      { severity: 'WARNING', source: 'PLAYER_ACCESS' },
      { severity: 'WARNING', source: 'SPECTATOR_ACCESS' },
      { severity: 'WARNING', source: 'CHAT_MODERATION' },
      { severity: 'WARNING', source: 'SESSION_CONTROL' },
    ])).toBe(0);
  });

  it('does not count routine entries, such as an email batch that went out', () => {
    expect(attentionEventCount([{ severity: 'INFO', source: 'EMAIL' }, { severity: 'INFO', source: 'AUTOMATION' }])).toBe(0);
    expect(attentionEventCount([])).toBe(0);
  });
});
