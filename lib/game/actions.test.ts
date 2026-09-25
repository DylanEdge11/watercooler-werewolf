import { describe, expect, it } from 'vitest';
import { permissionForRole, validateActionTargets } from './actions';
import type { PlayerState } from './types';

const players: PlayerState[] = [
  { id: 'wolf', displayName: 'Wolf', role: 'WEREWOLF', alive: true },
  { id: 'wolf-2', displayName: 'Wolf Two', role: 'WEREWOLF', alive: true },
  { id: 'seer', displayName: 'Seer', role: 'SEER', alive: true },
  { id: 'bodyguard', displayName: 'Bodyguard', role: 'BODYGUARD', alive: true },
  { id: 'villager', displayName: 'Villager', role: 'VILLAGER', alive: true },
  { id: 'gone', displayName: 'Gone', role: 'VILLAGER', alive: false },
];

describe('action permissions', () => {
  it('gives every living role a day ballot and only powered roles a night action', () => {
    expect(permissionForRole('VILLAGER', 'DAY', 2)).toMatchObject({ actionKind: 'DAY_VOTE', maxTargets: 2 });
    expect(permissionForRole('WEREWOLF', 'NIGHT', 2)).toMatchObject({ actionKind: 'WOLF_VOTE', maxTargets: 2 });
    expect(permissionForRole('SEER', 'NIGHT', 2)).toMatchObject({ actionKind: 'INVESTIGATE', maxTargets: 1 });
    expect(permissionForRole('BODYGUARD', 'NIGHT', 2)).toMatchObject({ actionKind: 'PROTECT', maxTargets: 1 });
    expect(permissionForRole('VILLAGER', 'NIGHT', 2).actionKind).toBeNull();
  });

  it('gates the Hunter follow-up to the Hunter role', () => {
    expect(permissionForRole('HUNTER', 'DAY', 2, true).actionKind).toBe('HUNTER_SHOT');
    expect(permissionForRole('SEER', 'DAY', 2, true).actionKind).toBeNull();
  });
});

describe('action target validation', () => {
  it('rejects self, dead, duplicate, and pack-member targets', () => {
    const errors = validateActionTargets({
      actor: players[0],
      players,
      actionKind: 'WOLF_VOTE',
      targetIds: ['wolf', 'wolf-2', 'gone', 'gone'],
      maxTargets: 4,
    });
    expect(errors).toContain('Targets must be unique.');
    expect(errors).toContain('You cannot target yourself.');
    expect(errors).toContain('Werewolves cannot target pack members.');
    expect(errors).toContain('Every target must be a living player.');
  });

  it('limits Bodyguard protection to one other living player', () => {
    expect(validateActionTargets({
      actor: players[3],
      players,
      actionKind: 'PROTECT',
      targetIds: ['villager'],
      maxTargets: 1,
    })).toEqual([]);
    expect(validateActionTargets({
      actor: players[3],
      players,
      actionKind: 'PROTECT',
      targetIds: ['bodyguard'],
      maxTargets: 1,
    })).toContain('You cannot target yourself.');
    expect(validateActionTargets({
      actor: players[3],
      players,
      actionKind: 'PROTECT',
      targetIds: ['gone'],
      maxTargets: 1,
    })).toContain('Every target must be a living player.');
    expect(validateActionTargets({
      actor: players[3],
      players,
      actionKind: 'PROTECT',
      targetIds: ['villager', 'seer'],
      maxTargets: 1,
    })).toContain('Choose between 1 and 1 target.');
  });
});

describe('Cupid and Apprentice Seer permissions', () => {
  it('gives Cupid one pairing and the Apprentice Seer a night action only after the Seer dies', () => {
    expect(permissionForRole('CUPID', 'NIGHT', 1)).toMatchObject({ actionKind: 'CUPID_PAIR', maxTargets: 2 });
    expect(permissionForRole('CUPID', 'NIGHT', 1, false, { cupidPairExists: true }).actionKind).toBeNull();
    expect(permissionForRole('APPRENTICE_SEER', 'NIGHT', 1, false, { seerAlive: true }).actionKind).toBeNull();
    expect(permissionForRole('APPRENTICE_SEER', 'NIGHT', 1, false, { seerAlive: false }))
      .toMatchObject({ actionKind: 'INVESTIGATE', maxTargets: 1 });
    expect(permissionForRole('MAYOR', 'NIGHT', 1).actionKind).toBeNull();
    expect(permissionForRole('MAYOR', 'DAY', 1).actionKind).toBe('DAY_VOTE');
  });

  it('requires exactly two living lovers and allows Cupid to choose themself', () => {
    const cupid: PlayerState = { id: 'cupid', displayName: 'Cupid', role: 'CUPID', alive: true };
    const withCupid = [...players, cupid];
    const pair = (targetIds: string[]) => validateActionTargets({
      actor: cupid,
      players: withCupid,
      actionKind: 'CUPID_PAIR',
      targetIds,
      maxTargets: 2,
    });
    expect(pair(['cupid', 'villager'])).toEqual([]);
    expect(pair(['villager'])).toContain('Choose exactly two players to link as lovers.');
    expect(pair(['villager', 'gone'])).toContain('Every target must be a living player.');
  });
});
