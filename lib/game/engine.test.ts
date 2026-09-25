import { describe, expect, it } from 'vitest';
import { evaluateWinner, resolveHunterShot, resolvePhase, selectFromTally } from './engine';
import type { ActionSubmission, PlayerState } from './types';

const players: PlayerState[] = [
  { id: 'wolf-1', displayName: 'Wolf One', role: 'WEREWOLF', alive: true },
  { id: 'wolf-2', displayName: 'Wolf Two', role: 'WEREWOLF', alive: true },
  { id: 'seer', displayName: 'Seer', role: 'SEER', alive: true },
  { id: 'bodyguard', displayName: 'Bodyguard', role: 'BODYGUARD', alive: true },
  { id: 'hunter', displayName: 'Hunter', role: 'HUNTER', alive: true },
  { id: 'villager-1', displayName: 'Villager One', role: 'VILLAGER', alive: true },
  { id: 'villager-2', displayName: 'Villager Two', role: 'VILLAGER', alive: true },
  { id: 'mason-1', displayName: 'Mason One', role: 'MASON', alive: true },
  { id: 'mason-2', displayName: 'Mason Two', role: 'MASON', alive: true },
];

function action(
  id: string,
  actorId: string,
  kind: ActionSubmission['kind'],
  targetIds: string[],
  version = 1,
): ActionSubmission {
  return { id, actorId, kind, targetIds, version, submittedAt: '2026-10-01T15:00:00Z' };
}

describe('tally selection', () => {
  it('uses recorded randomness only at a tied elimination boundary', () => {
    const result = selectFromTally(
      [
        { playerId: 'a', votes: 5 },
        { playerId: 'b', votes: 3 },
        { playerId: 'c', votes: 3 },
      ],
      2,
      [0.8],
    );
    expect(result.selected).toEqual(['a', 'c']);
    expect(result.randomDraws).toEqual([
      {
        kind: 'BOUNDARY_TIE',
        candidates: ['b', 'c'],
        selected: ['c'],
        rolls: [0.8],
      },
    ]);
  });
});

describe('day resolution', () => {
  it('counts up to the slot count, ignores self-targets, and uses latest revisions', () => {
    const result = resolvePhase({
      phaseId: 'day-1',
      kind: 'DAY',
      slots: 2,
      players,
      actions: [
        action('old', 'seer', 'DAY_VOTE', ['wolf-1'], 1),
        action('new', 'seer', 'DAY_VOTE', ['wolf-2', 'hunter'], 2),
        action('v2', 'bodyguard', 'DAY_VOTE', ['wolf-2', 'bodyguard']),
        action('v3', 'villager-1', 'DAY_VOTE', ['hunter', 'wolf-2']),
      ],
    });

    expect(result.tally).toEqual([
      { playerId: 'wolf-2', votes: 3 },
      { playerId: 'hunter', votes: 2 },
    ]);
    expect(result.eliminations.map((item) => item.playerId)).toEqual(['wolf-2', 'hunter']);
    expect(result.hunterRequiredIds).toEqual(['hunter']);
    expect(result.warnings.some((warning) => warning.reason.includes('not eligible'))).toBe(true);
  });
});

describe('night resolution', () => {
  it('loses a protected pack slot and returns the Seer exact role result', () => {
    const result = resolvePhase({
      phaseId: 'night-1',
      kind: 'NIGHT',
      slots: 2,
      players,
      actions: [
        action('w1', 'wolf-1', 'WOLF_VOTE', ['seer', 'villager-1']),
        action('w2', 'wolf-2', 'WOLF_VOTE', ['seer', 'villager-1']),
        action('protect', 'bodyguard', 'PROTECT', ['seer']),
        action('inspect', 'seer', 'INVESTIGATE', ['wolf-1']),
      ],
    });

    expect(result.selectedTargets).toEqual(['seer', 'villager-1']);
    expect(result.protectedPlayerIds).toEqual(['seer']);
    expect(result.eliminations).toEqual([
      { playerId: 'villager-1', cause: 'WEREWOLF_ATTACK' },
    ]);
    expect(result.investigations).toEqual([
      { seerId: 'seer', targetId: 'wolf-1', role: 'WEREWOLF' },
    ]);
  });

  it('rejects wolves targeting teammates', () => {
    const result = resolvePhase({
      phaseId: 'night-2',
      kind: 'NIGHT',
      slots: 1,
      players,
      actions: [action('bad', 'wolf-1', 'WOLF_VOTE', ['wolf-2'])],
    });
    expect(result.eliminations).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});

describe('Hunter and victory', () => {
  it('adds a valid final shot and clears the pending Hunter state', () => {
    const initial = resolvePhase({
      phaseId: 'day-hunter',
      kind: 'DAY',
      slots: 1,
      players,
      actions: [action('vote', 'seer', 'DAY_VOTE', ['hunter'])],
    });
    const final = resolveHunterShot({
      players,
      resolution: initial,
      hunterAction: action('shot', 'hunter', 'HUNTER_SHOT', ['wolf-1']),
    });
    expect(final.eliminations).toContainEqual({ playerId: 'wolf-1', cause: 'HUNTER_SHOT' });
    expect(final.hunterRequiredIds).toEqual([]);
  });

  it('awards Village when the last wolf dies and Werewolves at parity', () => {
    expect(
      evaluateWinner(players, [{ playerId: 'wolf-1' }, { playerId: 'wolf-2' }]).winner,
    ).toBe('VILLAGE');

    const parityPlayers = players.map((player) => ({
      ...player,
      alive: ['wolf-1', 'wolf-2', 'seer', 'bodyguard'].includes(player.id),
    }));
    expect(evaluateWinner(parityPlayers).winner).toBe('WEREWOLF');
  });

  it('keeps the same victory rules for a six-player game', () => {
    const smallPlayers: PlayerState[] = [
      { id: 'small-wolf', displayName: 'Small Wolf', role: 'WEREWOLF', alive: true },
      { id: 'small-v1', displayName: 'Small Villager 1', role: 'VILLAGER', alive: true },
      { id: 'small-v2', displayName: 'Small Villager 2', role: 'VILLAGER', alive: true },
      { id: 'small-v3', displayName: 'Small Villager 3', role: 'VILLAGER', alive: true },
      { id: 'small-v4', displayName: 'Small Villager 4', role: 'VILLAGER', alive: true },
      { id: 'small-v5', displayName: 'Small Villager 5', role: 'VILLAGER', alive: true },
    ];
    expect(evaluateWinner(smallPlayers, [{ playerId: 'small-wolf' }]).winner).toBe('VILLAGE');
    expect(evaluateWinner(smallPlayers.map((player) => ({ ...player, alive: ['small-wolf', 'small-v1'].includes(player.id) }))).winner).toBe('WEREWOLF');
  });
});

describe('Mayor, Cupid, and Apprentice Seer', () => {
  const extendedPlayers: PlayerState[] = [
    ...players.filter((player) => !['villager-2', 'mason-2'].includes(player.id)),
    { id: 'mayor', displayName: 'Mayor', role: 'MAYOR', alive: true },
    { id: 'cupid', displayName: 'Cupid', role: 'CUPID', alive: true },
    { id: 'apprentice', displayName: 'Apprentice', role: 'APPRENTICE_SEER', alive: true },
  ];
  const lovers = { cupidId: 'cupid', playerIds: ['villager-1', 'hunter'] as [string, string] };

  it('counts the Mayor twice in Day ballots only', () => {
    const day = resolvePhase({
      phaseId: 'day-mayor',
      kind: 'DAY',
      slots: 1,
      players: extendedPlayers,
      actions: [
        action('m', 'mayor', 'DAY_VOTE', ['wolf-1']),
        action('a', 'seer', 'DAY_VOTE', ['wolf-2']),
        action('b', 'bodyguard', 'DAY_VOTE', ['wolf-2']),
        action('c', 'villager-1', 'DAY_VOTE', ['wolf-1']),
      ],
    });
    expect(day.tally).toEqual([
      { playerId: 'wolf-1', votes: 3 },
      { playerId: 'wolf-2', votes: 2 },
    ]);
    expect(day.eliminations).toEqual([{ playerId: 'wolf-1', cause: 'DAY_VOTE' }]);
  });

  it('links lovers from the Cupid action and eliminates the partner on the same night', () => {
    const night = resolvePhase({
      phaseId: 'night-cupid',
      kind: 'NIGHT',
      slots: 1,
      players: extendedPlayers,
      actions: [
        action('pair', 'cupid', 'CUPID_PAIR', ['villager-1', 'mayor']),
        action('w1', 'wolf-1', 'WOLF_VOTE', ['villager-1']),
        action('protect', 'bodyguard', 'PROTECT', ['mayor']),
      ],
    });
    expect(night.loverPair).toEqual({ cupidId: 'cupid', playerIds: ['villager-1', 'mayor'] });
    // Protection stops the pack attack, not the lover bond.
    expect(night.eliminations).toEqual([
      { playerId: 'villager-1', cause: 'WEREWOLF_ATTACK' },
      { playerId: 'mayor', cause: 'LOVER_BOND' },
    ]);
  });

  it('gives a Hunter who dies of a broken heart the final shot', () => {
    const day = resolvePhase({
      phaseId: 'day-lovers',
      kind: 'DAY',
      slots: 1,
      players: extendedPlayers,
      loverPair: lovers,
      actions: [action('v', 'seer', 'DAY_VOTE', ['villager-1'])],
    });
    expect(day.eliminations).toEqual([
      { playerId: 'villager-1', cause: 'DAY_VOTE' },
      { playerId: 'hunter', cause: 'LOVER_BOND' },
    ]);
    expect(day.hunterRequiredIds).toEqual(['hunter']);
  });

  it('eliminates the partner when the Hunter shoots a lover', () => {
    const pair = { cupidId: 'cupid', playerIds: ['villager-1', 'mayor'] as [string, string] };
    const initial = resolvePhase({
      phaseId: 'day-hunter-lover',
      kind: 'DAY',
      slots: 1,
      players: extendedPlayers,
      loverPair: pair,
      actions: [action('v', 'seer', 'DAY_VOTE', ['hunter'])],
    });
    const final = resolveHunterShot({
      players: extendedPlayers,
      resolution: initial,
      hunterAction: action('shot', 'hunter', 'HUNTER_SHOT', ['mayor']),
    });
    expect(final.eliminations).toEqual([
      { playerId: 'hunter', cause: 'DAY_VOTE' },
      { playerId: 'mayor', cause: 'HUNTER_SHOT' },
      { playerId: 'villager-1', cause: 'LOVER_BOND' },
    ]);
  });

  it('ignores a Cupid action once lovers are already linked', () => {
    const night = resolvePhase({
      phaseId: 'night-second-pair',
      kind: 'NIGHT',
      slots: 1,
      players: extendedPlayers,
      loverPair: lovers,
      actions: [action('pair', 'cupid', 'CUPID_PAIR', ['seer', 'mayor'])],
    });
    expect(night.loverPair).toEqual(lovers);
  });

  it('lets the Apprentice Seer investigate only after the Seer is eliminated', () => {
    const apprenticeInspects = [action('inspect', 'apprentice', 'INVESTIGATE', ['wolf-1'])];
    const whileSeerLives = resolvePhase({
      phaseId: 'night-apprentice-1',
      kind: 'NIGHT',
      slots: 1,
      players: extendedPlayers,
      actions: apprenticeInspects,
    });
    expect(whileSeerLives.investigations).toEqual([]);

    const afterSeer = resolvePhase({
      phaseId: 'night-apprentice-2',
      kind: 'NIGHT',
      slots: 1,
      players: extendedPlayers.map((player) => (player.id === 'seer' ? { ...player, alive: false } : player)),
      actions: apprenticeInspects,
    });
    expect(afterSeer.investigations).toEqual([
      { seerId: 'apprentice', targetId: 'wolf-1', role: 'WEREWOLF' },
    ]);
  });
});
