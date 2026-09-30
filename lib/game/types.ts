export const ROLE_KEYS = [
  'VILLAGER',
  'WEREWOLF',
  'SEER',
  'BODYGUARD',
  'HUNTER',
  'MASON',
  'APPRENTICE_SEER',
  'MAYOR',
  'CUPID',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];
export type LegacyRoleKey = 'DOCTOR';

/**
 * Existing SQLite rows from the first MVP may still contain DOCTOR. The migration
 * rewrites those rows, while this mapper keeps older exported records safe to
 * read if they are encountered during recovery.
 */
export function canonicalRoleKey(value: string): RoleKey {
  return (value === 'DOCTOR' ? 'BODYGUARD' : value) as RoleKey;
}
export type Faction = 'VILLAGE' | 'WEREWOLF';

export type GameStatus =
  | 'DRAFT'
  | 'REGISTRATION'
  | 'ASSIGNMENT_PREVIEW'
  | 'ACTIVE'
  | 'FINAL_SHOWDOWN'
  | 'COMPLETED'
  | 'STOPPED'
  | 'CANCELLED'
  // These values are short-lived database claims. They are never a player-
  // facing lifecycle state, but make setup transitions race-safe.
  | 'COMPOSITION_SAVING'
  | 'ASSIGNMENT_PREVIEWING'
  | 'ROSTER_IMPORTING'
  | 'RESETTING'
  | 'RESTORING';
export type PhaseKind = 'DAY' | 'NIGHT' | 'FINAL_BALLOT';
export type ActionKind =
  | 'DAY_VOTE'
  | 'WOLF_VOTE'
  | 'INVESTIGATE'
  | 'PROTECT'
  | 'HUNTER_SHOT'
  | 'CUPID_PAIR'
  // Optional ballot of eliminated players during a Day or Final ballot. It
  // never eliminates anyone by itself; it only breaks a tie among the living vote.
  | 'AFTERLIFE_VOTE';

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

/**
 * How the Afterlife broke a tie at the elimination boundary. `afterlifeVotes`
 * counts only votes for the tied candidates. `selected` are those the
 * Afterlife decided; any slot it could not decide went to a random draw.
 */
export interface AfterlifeTiebreak {
  candidates: string[];
  afterlifeVotes: TallyEntry[];
  selected: string[];
  /** true when the Afterlife settled every tied slot, with no random draw. */
  decided: boolean;
}

export interface TallyEntry {
  playerId: string;
  votes: number;
}

export interface Elimination {
  playerId: string;
  cause: 'DAY_VOTE' | 'WEREWOLF_ATTACK' | 'HUNTER_SHOT' | 'LOVER_BOND';
}

export interface LoverPair {
  cupidId: string;
  playerIds: [string, string];
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
  loverPair?: LoverPair | null;
}

export interface PhaseResolution {
  phaseId: string;
  kind: PhaseKind;
  slots: number;
  tally: TallyEntry[];
  selectedTargets: string[];
  protectedPlayerIds: string[];
  loverPair?: LoverPair | null;
  eliminations: Elimination[];
  investigations: InvestigationResult[];
  hunterRequiredIds: string[];
  randomDraws: RandomDraw[];
  /** Day and Final ballots only: the Afterlife's votes for living players. Absent on older results. */
  afterlifeTally?: TallyEntry[];
  /** Present when a boundary tie went to the Afterlife. */
  afterlifeTiebreak?: AfterlifeTiebreak | null;
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
