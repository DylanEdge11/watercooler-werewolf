import type { RoleDefinition, RoleKey } from './types';

export const ROLE_CATALOG: Record<RoleKey, RoleDefinition> = {
  VILLAGER: {
    key: 'VILLAGER',
    name: 'Villager',
    faction: 'VILLAGE',
    power: 1,
    summary: 'Find and eliminate every Werewolf.',
  },
  WEREWOLF: {
    key: 'WEREWOLF',
    name: 'Werewolf',
    faction: 'WEREWOLF',
    power: -5,
    summary: 'Coordinate with the pack and reach parity.',
    actionKind: 'WOLF_VOTE',
  },
  SEER: {
    key: 'SEER',
    name: 'Seer',
    faction: 'VILLAGE',
    power: 3,
    summary: 'Inspect one living player each night and learn their exact role.',
    actionKind: 'INVESTIGATE',
    unique: true,
  },
  DOCTOR: {
    key: 'DOCTOR',
    name: 'Doctor',
    faction: 'VILLAGE',
    power: 2,
    summary: 'Protect one other living player from the pack each night.',
    actionKind: 'PROTECT',
    unique: true,
  },
  HUNTER: {
    key: 'HUNTER',
    name: 'Hunter',
    faction: 'VILLAGE',
    power: 1,
    summary: 'Take one living player with you when eliminated.',
    actionKind: 'HUNTER_SHOT',
    unique: true,
  },
  MASON: {
    key: 'MASON',
    name: 'Mason',
    faction: 'VILLAGE',
    power: 1,
    summary: 'Know the other Masons and coordinate in a private room.',
    minimumCount: 2,
  },
};

