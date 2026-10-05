import { describe, expect, it } from 'vitest';
import { attentionEventCount, CONSOLE_TABS, defaultConsoleTab, isConsoleTabId, latestAttentionEventAt, launchChecklist, resolveConsoleTab, rosterCountsNote, runHint, runNeedsAttention, setupHint, waitingBadges } from './console-guidance';

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

  it('opens a game stopped before roles went out on Safety & records, not on an empty Run game tab', () => {
    expect(defaultConsoleTab('STOPPED', false)).toBe('safety');
    expect(defaultConsoleTab('STOPPED', true)).toBe('run');
    // Everything else is unchanged by whether roles went out.
    expect(defaultConsoleTab('REGISTRATION', false)).toBe('setup');
    expect(defaultConsoleTab('ACTIVE', true)).toBe('run');
    expect(defaultConsoleTab('COMPLETED', true)).toBe('run');
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

describe('launch checklist with a roster still being built from sign-ups', () => {
  const base = { gameCount: 1, seatCount: 0, claimedCount: 0, hasBatch: false, released: false };

  it('is not done with the roster until it reaches the minimum', () => {
    for (const seatCount of [1, 3, 5]) {
      expect(launchChecklist({ ...base, seatCount })).toEqual({ schedule: 'done', roster: 'active', roles: 'todo', release: 'todo' });
    }
    expect(launchChecklist({ ...base, seatCount: 6 })).toEqual({ schedule: 'done', roster: 'done', roles: 'active', release: 'todo' });
  });
});

describe('setup hint with sign-ups', () => {
  const setup = { status: 'REGISTRATION', seatCount: 0, claimedCount: 0, hasBatch: false, released: false };

  it('offers sign-ups as a way to add players when the roster is empty', () => {
    const hint = setupHint(setup);
    expect(hint?.title).toBe('Next: add your players');
    expect(hint?.detail).toContain('open sign-ups');
    expect(hint?.step).toBe('roster');
  });

  it('says sign-ups are open, and what to do with them', () => {
    const hint = setupHint({ ...setup, signupsOpen: true });
    expect(hint?.title).toBe('Sign-ups are open');
    expect(hint?.detail).toContain('6 to 80 players');
    expect(hint?.step).toBe('signups');
    expect(setupHint({ ...setup, seatCount: 4, signupsOpen: true })?.detail).toContain('the roster has 4');
  });

  it('tells a moderator with sign-ups open that a list can be imported before or after', () => {
    expect(setupHint({ ...setup, signupsOpen: true })?.detail).toContain('import it too, before or after');
  });

  it('describes the role counts after people are added in bulk', () => {
    expect(rosterCountsNote({ playerCount: 3, resetToPreset: false, villagers: 0 })).toBe('The roster has 3 so far, and a game needs at least 6.');
    expect(rosterCountsNote({ playerCount: 8, resetToPreset: true, villagers: 4 })).toBe('Role counts were set to the standard preset for 8 players.');
    expect(rosterCountsNote({ playerCount: 9, resetToPreset: false, villagers: 5 })).toBe('Role counts now have 5 Villagers; other roles are unchanged.');
    expect(rosterCountsNote({ playerCount: 7, resetToPreset: false, villagers: 1 })).toBe('Role counts now have 1 Villager; other roles are unchanged.');
  });

  it('puts people waiting first, in the singular and the plural', () => {
    expect(setupHint({ ...setup, pendingSignups: 1, signupsOpen: true })).toMatchObject({ title: '1 person has signed up', step: 'signups' });
    expect(setupHint({ ...setup, pendingSignups: 3 })).toMatchObject({ title: '3 people have signed up', step: 'signups' });
    expect(setupHint({ ...setup, pendingSignups: 3, seatCount: 8, claimedCount: 8 })?.title).toBe('3 people have signed up');
  });

  it('counts how many more players a short roster needs', () => {
    expect(setupHint({ ...setup, pendingSignups: 2, seatCount: 4 })?.detail).toContain('the roster has 4, so 2 more are needed');
    expect(setupHint({ ...setup, pendingSignups: 2, seatCount: 5 })?.detail).toContain('so 1 more is needed');
    expect(setupHint({ ...setup, pendingSignups: 2, seatCount: 7, claimedCount: 7 })?.detail).not.toContain('more');
  });

  it('asks for more players when a closed roster is still too small', () => {
    expect(setupHint({ ...setup, seatCount: 4 })).toMatchObject({ title: 'Add 2 more players', step: 'roster' });
    expect(setupHint({ ...setup, seatCount: 5 })?.title).toBe('Add 1 more player');
  });

  it('does not offer to balance the roles for a roster that is too small, even when everyone has claimed', () => {
    expect(setupHint({ ...setup, seatCount: 5, claimedCount: 5 })?.title).toBe('Add 1 more player');
  });

  it('stays quiet about waiting people once roles are randomized or the game is running', () => {
    expect(setupHint({ ...setup, status: 'ASSIGNMENT_PREVIEW', pendingSignups: 2, seatCount: 8, claimedCount: 8, hasBatch: true })?.title).toBe('Next: review and release the roles');
    expect(setupHint({ ...setup, status: 'ACTIVE', pendingSignups: 2, seatCount: 8, claimedCount: 8, hasBatch: true, released: true })).toBeNull();
  });
});

describe('waiting badges', () => {
  it('count sign-ups on Setup and applications on People, where the moderator can act on them', () => {
    const badges = waitingBadges({ pendingSignups: 2, pendingApplications: 1, setupEditable: true, isOwner: true });
    expect(badges.setup).toEqual({ count: 2, description: '2 people are waiting to be accepted into the game' });
    expect(badges.people).toEqual({ count: 1, description: '1 moderator application is waiting for your decision' });
  });

  it('read in the singular', () => {
    expect(waitingBadges({ pendingSignups: 1, pendingApplications: 2, setupEditable: true, isOwner: true })).toMatchObject({
      setup: { description: '1 person is waiting to be accepted into the game' },
      people: { description: '2 moderator applications are waiting for your decision' },
    });
  });

  it('show nothing when nobody is waiting, setup is locked, or the moderator is not the owner', () => {
    expect(waitingBadges({ pendingSignups: 0, pendingApplications: 0, setupEditable: true, isOwner: true })).toEqual({});
    expect(waitingBadges({ pendingSignups: 4, pendingApplications: 0, setupEditable: false, isOwner: true })).toEqual({});
    expect(waitingBadges({ pendingSignups: 0, pendingApplications: 3, setupEditable: true, isOwner: false })).toEqual({});
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

describe('unseen problems', () => {
  const at = (createdAt: string, source = 'EMAIL', severity = 'WARNING') => ({ severity, source, createdAt });

  it('counts only the problems logged after the moderator last looked', () => {
    const events = [at('2026-10-04T10:00:00.000Z'), at('2026-10-04T12:00:00.000Z', 'AUTOMATION'), at('2026-10-04T14:00:00.000Z')];
    expect(attentionEventCount(events, null)).toBe(3);
    expect(attentionEventCount(events, '2026-10-04T10:00:00.000Z')).toBe(2);
    expect(attentionEventCount(events, '2026-10-04T14:00:00.000Z')).toBe(0);
  });

  it('finds the newest problem, ignoring entries that are not problems', () => {
    const events = [at('2026-10-04T10:00:00.000Z'), at('2026-10-04T15:00:00.000Z', 'GAME_CONTROL'), at('2026-10-04T16:00:00.000Z', 'EMAIL', 'INFO'), at('2026-10-04T12:00:00.000Z', 'AUTOMATION')];
    expect(latestAttentionEventAt(events)).toBe('2026-10-04T12:00:00.000Z');
    expect(latestAttentionEventAt([])).toBeNull();
    expect(latestAttentionEventAt([at('2026-10-04T15:00:00.000Z', 'GAME_CONTROL')])).toBeNull();
  });

  it('brings the badge back for a problem logged after the moderator looked', () => {
    const before = [at('2026-10-04T10:00:00.000Z')];
    const seenThrough = latestAttentionEventAt(before);
    expect(attentionEventCount(before, seenThrough)).toBe(0);
    expect(attentionEventCount([...before, at('2026-10-04T11:00:00.000Z', 'AUTOMATION')], seenThrough)).toBe(1);
  });
});

describe('resolve console tab', () => {
  it('uses the default until the moderator picks a tab', () => {
    expect(resolveConsoleTab(null, 'setup')).toBe('setup');
    expect(resolveConsoleTab(null, 'run')).toBe('run');
  });

  it('keeps a picked tab while the game stays on the same side of release', () => {
    expect(resolveConsoleTab({ id: 'messages', forDefault: 'run' }, 'run')).toBe('messages');
    expect(resolveConsoleTab({ id: 'people', forDefault: 'setup' }, 'setup')).toBe('people');
  });

  it('goes back to the tab that suits the game when it flips between setup and running', () => {
    expect(resolveConsoleTab({ id: 'run', forDefault: 'run' }, 'setup')).toBe('setup');
    expect(resolveConsoleTab({ id: 'people', forDefault: 'setup' }, 'run')).toBe('run');
  });

  it('keeps a tab chosen by a link whatever the game does', () => {
    expect(resolveConsoleTab({ id: 'safety', forDefault: null }, 'setup')).toBe('safety');
    expect(resolveConsoleTab({ id: 'safety', forDefault: null }, 'run')).toBe('safety');
  });
});
