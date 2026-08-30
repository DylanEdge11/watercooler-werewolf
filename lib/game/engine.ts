import { ROLE_CATALOG } from './catalog';
import type {
  ActionKind,
  ActionSubmission,
  Elimination,
  HunterResolutionInput,
  PhaseResolution,
  PhaseResolutionInput,
  PlayerState,
  RandomDraw,
  ResolutionWarning,
  TallyEntry,
  WinResult,
} from './types';

interface TallyResult {
  tally: TallyEntry[];
  warnings: ResolutionWarning[];
}

interface SelectionResult {
  selected: string[];
  randomDraws: RandomDraw[];
}

function playerMap(players: PlayerState[]): Map<string, PlayerState> {
  return new Map(players.map((player) => [player.id, player]));
}

function latestActions(actions: ActionSubmission[]): ActionSubmission[] {
  const current = new Map<string, ActionSubmission>();
  for (const action of actions) {
    const key = `${action.actorId}:${action.kind}`;
    const previous = current.get(key);
    if (!previous || action.version > previous.version) current.set(key, action);
  }
  return [...current.values()];
}

function tallyActions(
  actions: ActionSubmission[],
  kind: ActionKind,
  slots: number,
  players: Map<string, PlayerState>,
  actorIsEligible: (actor: PlayerState) => boolean,
  targetIsEligible: (actor: PlayerState, target: PlayerState) => boolean,
): TallyResult {
  const counts = new Map<string, number>();
  const warnings: ResolutionWarning[] = [];

  for (const action of actions.filter((candidate) => candidate.kind === kind)) {
    const actor = players.get(action.actorId);
    if (!actor || !actorIsEligible(actor)) {
      warnings.push({ actionId: action.id, reason: 'Actor was not eligible for this action.' });
      continue;
    }

    const uniqueTargets = [...new Set(action.targetIds)];
    if (uniqueTargets.length > slots) {
      warnings.push({ actionId: action.id, reason: `Only the first ${slots} valid targets counted.` });
    }

    let accepted = 0;
    for (const targetId of uniqueTargets) {
      if (accepted >= slots) break;
      const target = players.get(targetId);
      if (!target || !targetIsEligible(actor, target)) {
        warnings.push({ actionId: action.id, reason: `Target ${targetId} was not eligible.` });
        continue;
      }
      counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
      accepted += 1;
    }
  }

  const tally = [...counts.entries()]
    .map(([playerId, votes]) => ({ playerId, votes }))
    .sort((a, b) => b.votes - a.votes || a.playerId.localeCompare(b.playerId));
  return { tally, warnings };
}

export function selectFromTally(
  tally: TallyEntry[],
  slots: number,
  randomRolls: number[] = [],
): SelectionResult {
  const selected: string[] = [];
  const randomDraws: RandomDraw[] = [];
  let rollCursor = 0;
  let index = 0;

  while (selected.length < slots && index < tally.length) {
    const voteCount = tally[index].votes;
    const tied: string[] = [];
    while (index < tally.length && tally[index].votes === voteCount) {
      tied.push(tally[index].playerId);
      index += 1;
    }

    const remaining = slots - selected.length;
    if (tied.length <= remaining) {
      selected.push(...tied);
      continue;
    }

    const pool = [...tied].sort();
    const picked: string[] = [];
    const usedRolls: number[] = [];
    while (picked.length < remaining) {
      const roll = randomRolls[rollCursor];
      if (roll === undefined || roll < 0 || roll >= 1) {
        throw new Error('A recorded random roll in the range [0, 1) is required for each tied slot.');
      }
      rollCursor += 1;
      usedRolls.push(roll);
      const selectedIndex = Math.floor(roll * pool.length);
      picked.push(pool.splice(selectedIndex, 1)[0]);
    }
    selected.push(...picked);
    randomDraws.push({
      kind: 'BOUNDARY_TIE',
      candidates: [...tied].sort(),
      selected: picked,
      rolls: usedRolls,
    });
  }

  return { selected, randomDraws };
}

function firstValidSingleTargetAction(
  actions: ActionSubmission[],
  kind: ActionKind,
  players: Map<string, PlayerState>,
  actorRole: PlayerState['role'],
): { actor: PlayerState; target: PlayerState; action: ActionSubmission } | null {
  const action = actions.find((candidate) => candidate.kind === kind);
  if (!action) return null;
  const actor = players.get(action.actorId);
  const target = players.get(action.targetIds[0]);
  if (!actor || !target || !actor.alive || actor.role !== actorRole) return null;
  if (!target.alive || actor.id === target.id) return null;
  return { actor, target, action };
}

export function resolvePhase(input: PhaseResolutionInput): PhaseResolution {
  if (!Number.isInteger(input.slots) || input.slots < 1) {
    throw new Error('A phase must have at least one elimination slot.');
  }
  const players = playerMap(input.players);
  const actions = latestActions(input.actions);
  const isDay = input.kind === 'DAY' || input.kind === 'FINAL_BALLOT';
  const voteKind: ActionKind = isDay ? 'DAY_VOTE' : 'WOLF_VOTE';
  const tallied = tallyActions(
    actions,
    voteKind,
    input.slots,
    players,
    (actor) => actor.alive && (isDay || actor.role === 'WEREWOLF'),
    (actor, target) =>
      target.alive && actor.id !== target.id && (isDay || target.role !== 'WEREWOLF'),
  );
  const selection = selectFromTally(tallied.tally, input.slots, input.randomRolls);
  const protectedPlayerIds: string[] = [];
  const investigations: PhaseResolution['investigations'] = [];

  if (!isDay) {
    const protection = firstValidSingleTargetAction(actions, 'PROTECT', players, 'BODYGUARD');
    if (protection) protectedPlayerIds.push(protection.target.id);

    const investigation = firstValidSingleTargetAction(actions, 'INVESTIGATE', players, 'SEER');
    if (investigation) {
      investigations.push({
        seerId: investigation.actor.id,
        targetId: investigation.target.id,
        role: investigation.target.role,
      });
    }
  }

  const eliminations: Elimination[] = selection.selected
    .filter((playerId) => isDay || !protectedPlayerIds.includes(playerId))
    .map((playerId) => ({
      playerId,
      cause: isDay ? 'DAY_VOTE' : 'WEREWOLF_ATTACK',
    }));
  const hunterRequiredIds = eliminations
    .filter((elimination) => players.get(elimination.playerId)?.role === 'HUNTER')
    .map((elimination) => elimination.playerId);

  return {
    phaseId: input.phaseId,
    kind: input.kind,
    slots: input.slots,
    tally: tallied.tally,
    selectedTargets: selection.selected,
    protectedPlayerIds,
    eliminations,
    investigations,
    hunterRequiredIds,
    randomDraws: selection.randomDraws,
    warnings: tallied.warnings,
  };
}

export function resolveHunterShot(input: HunterResolutionInput): PhaseResolution {
  const { resolution, players, hunterAction } = input;
  if (resolution.hunterRequiredIds.length === 0 || !hunterAction) return resolution;
  const hunterId = resolution.hunterRequiredIds[0];
  const hunter = players.find((player) => player.id === hunterId);
  const target = players.find((player) => player.id === hunterAction.targetIds[0]);
  const alreadyEliminated = new Set(resolution.eliminations.map((item) => item.playerId));

  if (
    hunterAction.kind !== 'HUNTER_SHOT' ||
    hunterAction.actorId !== hunterId ||
    hunter?.role !== 'HUNTER' ||
    !target?.alive ||
    target.id === hunterId ||
    alreadyEliminated.has(target.id)
  ) {
    return {
      ...resolution,
      warnings: [
        ...resolution.warnings,
        { actionId: hunterAction.id, reason: 'Hunter shot was not valid.' },
      ],
    };
  }

  return {
    ...resolution,
    eliminations: [
      ...resolution.eliminations,
      { playerId: target.id, cause: 'HUNTER_SHOT' },
    ],
    hunterRequiredIds: [],
  };
}

export function evaluateWinner(
  players: PlayerState[],
  eliminations: Pick<Elimination, 'playerId'>[] = [],
): WinResult {
  const removed = new Set(eliminations.map((item) => item.playerId));
  const living = players.filter((player) => player.alive && !removed.has(player.id));
  const livingWerewolves = living.filter(
    (player) => ROLE_CATALOG[player.role].faction === 'WEREWOLF',
  ).length;
  const livingVillage = living.length - livingWerewolves;

  return {
    winner:
      livingWerewolves === 0
        ? 'VILLAGE'
        : livingWerewolves >= livingVillage
          ? 'WEREWOLF'
          : null,
    livingWerewolves,
    livingVillage,
  };
}
