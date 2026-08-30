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
});
