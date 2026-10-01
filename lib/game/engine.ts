import { ROLE_CATALOG } from './catalog';
import type {
  ActionKind,
  AfterlifeTiebreak,
  ActionSubmission,
  Elimination,
  HunterResolutionInput,
  PhaseResolution,
  PhaseResolutionInput,
  PlayerState,
  RandomDraw,
  ResolutionWarning,
  TallyEntry,
  LoverPair,
  WinResult,
} from './types';

interface TallyResult {
  tally: TallyEntry[];
  warnings: ResolutionWarning[];
}

interface SelectionResult {
  selected: string[];
  randomDraws: RandomDraw[];
  afterlifeTiebreak: AfterlifeTiebreak | null;
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
  voteWeight: (actor: PlayerState) => number = () => 1,
): TallyResult {
  const counts = new Map<string, number>();
  const warnings: ResolutionWarning[] = [];

  for (const action of actions) {
    if (action.kind !== kind) continue;
    const actor = players.get(action.actorId);
    if (!actor || !actorIsEligible(actor)) {
      warnings.push({ actionId: action.id, reason: 'Actor was not eligible for this action.' });
      continue;
    }

    const uniqueTargets = new Set(action.targetIds);
    if (uniqueTargets.size > slots) {
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
      counts.set(targetId, (counts.get(targetId) ?? 0) + voteWeight(actor));
      accepted += 1;
    }
  }

  const tally = [...counts.entries()]
    .map(([playerId, votes]) => ({ playerId, votes }))
    .sort((a, b) => b.votes - a.votes || a.playerId.localeCompare(b.playerId));
  return { tally, warnings };
}

/**
 * Picks the eliminated players from a tally, most votes first. When players
 * tie at the boundary (more tied than slots left), the Afterlife's votes for
 * those tied players decide, most votes first. Only what the Afterlife
 * cannot settle (no votes, or its own tie) goes to a recorded random draw.
 */
export function selectFromTally(
  tally: TallyEntry[],
  slots: number,
  randomRolls: number[] = [],
  afterlifeTally?: TallyEntry[],
): SelectionResult {
  const selected: string[] = [];
  const randomDraws: RandomDraw[] = [];
  let afterlifeTiebreak: AfterlifeTiebreak | null = null;
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

    tied.sort();
    let pool = [...tied];
    const picked: string[] = [];

    const afterlifeCounts = new Map((afterlifeTally ?? []).map((entry) => [entry.playerId, entry.votes]));
    const ranked = tied
      .map((playerId) => ({ playerId, votes: afterlifeCounts.get(playerId) ?? 0 }))
      .sort((a, b) => b.votes - a.votes || a.playerId.localeCompare(b.playerId));
    if (ranked.some((entry) => entry.votes > 0)) {
      let rankIndex = 0;
      while (picked.length < remaining && rankIndex < ranked.length) {
        const count = ranked[rankIndex].votes;
        const group: string[] = [];
        while (rankIndex < ranked.length && ranked[rankIndex].votes === count) {
          group.push(ranked[rankIndex].playerId);
          rankIndex += 1;
        }
        if (group.length <= remaining - picked.length) {
          picked.push(...group);
        } else {
          pool = group;
          break;
        }
      }
      afterlifeTiebreak = {
        candidates: tied,
        afterlifeVotes: ranked.filter((entry) => entry.votes > 0),
        selected: [...picked],
        decided: picked.length === remaining,
      };
    }

    if (picked.length < remaining) {
      pool = pool.filter((playerId) => !picked.includes(playerId));
      const candidates = [...pool];
      const drawn: string[] = [];
      const usedRolls: number[] = [];
      while (picked.length + drawn.length < remaining) {
        const roll = randomRolls[rollCursor];
        if (roll === undefined || roll < 0 || roll >= 1) {
          throw new Error('A recorded random roll in the range [0, 1) is required for each tied slot.');
        }
        rollCursor += 1;
        usedRolls.push(roll);
        const selectedIndex = Math.floor(roll * pool.length);
        drawn.push(pool.splice(selectedIndex, 1)[0]);
      }
      picked.push(...drawn);
      randomDraws.push({
        kind: 'BOUNDARY_TIE',
        candidates,
        selected: drawn,
        rolls: usedRolls,
      });
    }
    selected.push(...picked);
  }

  return { selected, randomDraws, afterlifeTiebreak };
}

function firstValidSingleTargetAction(
  actions: ActionSubmission[],
  kind: ActionKind,
  players: Map<string, PlayerState>,
  actorIsEligible: (actor: PlayerState) => boolean,
): { actor: PlayerState; target: PlayerState } | null {
  const action = actions.find((candidate) => candidate.kind === kind);
  if (!action) return null;
  const actor = players.get(action.actorId);
  const target = players.get(action.targetIds[0]);
  if (!actor || !target || !actor.alive || !actorIsEligible(actor)) return null;
  if (!target.alive || actor.id === target.id) return null;
  return { actor, target };
}

function cupidPairFromActions(
  actions: ActionSubmission[],
  players: Map<string, PlayerState>,
): LoverPair | null {
  const action = actions.find((candidate) => candidate.kind === 'CUPID_PAIR');
  if (!action || action.targetIds.length !== 2 || new Set(action.targetIds).size !== 2) return null;
  const cupid = players.get(action.actorId);
  const first = players.get(action.targetIds[0]);
  const second = players.get(action.targetIds[1]);
  if (!cupid?.alive || cupid.role !== 'CUPID' || !first?.alive || !second?.alive) return null;
  return { cupidId: cupid.id, playerIds: [first.id, second.id] };
}

function applyLoverBond(eliminations: Elimination[], loverPair: LoverPair | null | undefined): Elimination[] {
  if (!loverPair) return eliminations;
  const eliminatedIds = new Set(eliminations.map((item) => item.playerId));
  const [first, second] = loverPair.playerIds;
  if (eliminatedIds.has(first) && !eliminatedIds.has(second)) {
    eliminations.push({ playerId: second, cause: 'LOVER_BOND' });
  } else if (eliminatedIds.has(second) && !eliminatedIds.has(first)) {
    eliminations.push({ playerId: first, cause: 'LOVER_BOND' });
  }
  return eliminations;
}

export function resolvePhase(input: PhaseResolutionInput): PhaseResolution {
  if (!Number.isInteger(input.slots) || input.slots < 1) {
    throw new Error('A phase must have at least one elimination slot.');
  }
  const players = new Map(input.players.map((player) => [player.id, player]));
  const actions = latestActions(input.actions);
  const isDay = input.kind === 'DAY' || input.kind === 'FINAL_BALLOT';
  const loverPair = input.loverPair ?? (!isDay ? cupidPairFromActions(actions, players) : null);
  const voteKind: ActionKind = isDay ? 'DAY_VOTE' : 'WOLF_VOTE';
  const tallied = tallyActions(
    actions,
    voteKind,
    input.slots,
    players,
    (actor) => actor.alive && (isDay || actor.role === 'WEREWOLF'),
    (actor, target) =>
      target.alive && actor.id !== target.id && (isDay || target.role !== 'WEREWOLF'),
    (actor) => isDay && actor.role === 'MAYOR' ? 2 : 1,
  );
  // The Afterlife (eliminated players) may vote for living players on a Day or
  // Final ballot. One vote each, used only to break a tie in the living vote.
  const afterlife = isDay
    ? tallyActions(
        actions,
        'AFTERLIFE_VOTE',
        input.slots,
        players,
        (actor) => !actor.alive,
        (_actor, target) => target.alive,
      )
    : null;
  const selection = selectFromTally(tallied.tally, input.slots, input.randomRolls, afterlife?.tally);
  const protectedPlayerIds: string[] = [];
  const investigations: PhaseResolution['investigations'] = [];

  if (!isDay) {
    const protection = firstValidSingleTargetAction(actions, 'PROTECT', players, (actor) => actor.role === 'BODYGUARD');
    if (protection) protectedPlayerIds.push(protection.target.id);

    const seerIsAlive = input.players.some((player) => player.alive && player.role === 'SEER');
    const investigation = firstValidSingleTargetAction(
      actions,
      'INVESTIGATE',
      players,
      (actor) => actor.role === 'SEER' || (actor.role === 'APPRENTICE_SEER' && !seerIsAlive),
    );
    if (investigation) {
      investigations.push({
        seerId: investigation.actor.id,
        targetId: investigation.target.id,
        role: investigation.target.role,
      });
    }
  }

  const eliminations = applyLoverBond(selection.selected
    .filter((playerId) => isDay || !protectedPlayerIds.includes(playerId))
    .map((playerId) => ({
      playerId,
      cause: isDay ? 'DAY_VOTE' : 'WEREWOLF_ATTACK',
    })), loverPair);
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
    loverPair,
    eliminations,
    investigations,
    hunterRequiredIds,
    randomDraws: selection.randomDraws,
    ...(afterlife ? { afterlifeTally: afterlife.tally, afterlifeTiebreak: selection.afterlifeTiebreak } : {}),
    warnings: [...tallied.warnings, ...(afterlife?.warnings ?? [])],
  };
}

/**
 * A moderator's corrected list of eliminations, applied to the engine's
 * original result. Lover bonds still follow, and any eliminated Hunter is
 * owed a shot again.
 */
export function applyEliminationOverride(
  proposedOutcome: PhaseResolution,
  ids: string[],
  players: PlayerState[],
): PhaseResolution {
  const cause: Elimination['cause'] = proposedOutcome.kind === 'NIGHT' ? 'WEREWOLF_ATTACK' : 'DAY_VOTE';
  const eliminations = applyLoverBond(ids.map((playerId) => ({ playerId, cause })), proposedOutcome.loverPair);
  const roles = new Map(players.map((player) => [player.id, player.role]));
  return {
    ...proposedOutcome,
    // The moderator chose these eliminations, so no tiebreak decided them.
    ...(proposedOutcome.afterlifeTiebreak ? { afterlifeTiebreak: null } : {}),
    selectedTargets: ids,
    eliminations,
    hunterRequiredIds: eliminations.filter((item) => roles.get(item.playerId) === 'HUNTER').map((item) => item.playerId),
  };
}

export function resolveHunterShot(input: HunterResolutionInput): PhaseResolution {
  const { resolution, players, hunterAction } = input;
  if (resolution.hunterRequiredIds.length === 0 || !hunterAction) return resolution;
  const hunterId = resolution.hunterRequiredIds[0];
  const hunter = players.find((player) => player.id === hunterId);
  const target = players.find((player) => player.id === hunterAction.targetIds[0]);

  if (
    hunterAction.kind !== 'HUNTER_SHOT' ||
    hunterAction.actorId !== hunterId ||
    hunter?.role !== 'HUNTER' ||
    !target?.alive ||
    target.id === hunterId ||
    resolution.eliminations.some((item) => item.playerId === target.id)
  ) {
    // An invalid shot counts as no shot. Keeping the Hunter pending would send
    // the phase back to the Hunter on every publish with no way out.
    return {
      ...resolution,
      hunterRequiredIds: [],
      warnings: [
        ...resolution.warnings,
        { actionId: hunterAction.id, reason: 'Hunter shot was not valid; no shot was applied.' },
      ],
    };
  }

  const eliminations = applyLoverBond([
    ...resolution.eliminations,
    { playerId: target.id, cause: 'HUNTER_SHOT' },
  ], resolution.loverPair);

  return {
    ...resolution,
    eliminations,
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
