export const ROLE_KEYS = [
  'VILLAGER',
  'WEREWOLF',
  'SEER',
  'BODYGUARD',
  'HUNTER',
  'MASON',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];
export type LegacyRoleKey = 'DOCTOR';

/**
 * Existing D1 rows from the first MVP may still contain DOCTOR. The migration
 * rewrites those rows, while this mapper keeps older exported records safe to
 * read if they are encountered during recovery.
 */
export function canonicalRoleKey(value: string): RoleKey {
  return (value === 'DOCTOR' ? 'BODYGUARD' : value) as RoleKey;
}
export type Faction = 'VILLAGE' | 'WEREWOLF';
export type PhaseKind = 'DAY' | 'NIGHT' | 'FINAL_BALLOT';
export type ActionKind =
  | 'DAY_VOTE'
  | 'WOLF_VOTE'
  | 'INVESTIGATE'
  | 'PROTECT'
  | 'HUNTER_SHOT';

export interface PlayerState {
  id: string;
  displayName: string;
  role: RoleKey;
  alive: boolean;
}

export interface ActionSubmission {
  id: string;
  actorId: string;
  kind: ActionKind;
  targetIds: string[];
  submittedAt: string;
  version: number;
}

export interface RandomDraw {
  kind: 'BOUNDARY_TIE';
  candidates: string[];
  selected: string[];
  rolls: number[];
}

export interface TallyEntry {
  playerId: string;
  votes: number;
}

export interface Elimination {
  playerId: string;
  cause: 'DAY_VOTE' | 'WEREWOLF_ATTACK' | 'HUNTER_SHOT';
}

export interface InvestigationResult {
  seerId: string;
  targetId: string;
  role: RoleKey;
}

export interface ResolutionWarning {
  actionId: string;
  reason: string;
}

export interface PhaseResolutionInput {
  phaseId: string;
  kind: Exclude<PhaseKind, 'FINAL_BALLOT'> | 'FINAL_BALLOT';
  slots: number;
  players: PlayerState[];
  actions: ActionSubmission[];
  randomRolls?: number[];
}

export interface PhaseResolution {
  phaseId: string;
  kind: PhaseKind;
  slots: number;
  tally: TallyEntry[];
  selectedTargets: string[];
  protectedPlayerIds: string[];
  eliminations: Elimination[];
  investigations: InvestigationResult[];
  hunterRequiredIds: string[];
  randomDraws: RandomDraw[];
  warnings: ResolutionWarning[];
}

export interface HunterResolutionInput {
  players: PlayerState[];
  resolution: PhaseResolution;
  hunterAction?: ActionSubmission;
}

export interface WinResult {
  winner: Faction | null;
  livingWerewolves: number;
  livingVillage: number;
}

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  faction: Faction;
  power: number;
  summary: string;
  actionKind?: ActionKind;
  unique?: boolean;
  minimumCount?: number;
}

export type RoleComposition = Record<RoleKey, number>;
