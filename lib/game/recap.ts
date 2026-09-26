import { ROLE_CATALOG } from './catalog';
import type { Elimination, PhaseKind, PhaseResolution, RoleKey } from './types';

/**
 * The end-of-game recap. It is built only for COMPLETED games and only from
 * what the game already recorded: each PHASE_PUBLISHED payload, the
 * CUPID_PAIR_SET events, the public Day ballots, and the final roster. Field
 * names deliberately avoid the private engine keys (tally, investigations,
 * protectedPlayerIds, ...) that the player privacy checks forbid.
 */

export interface RecapInput {
  winner: 'VILLAGE' | 'WEREWOLF' | null;
  roster: Array<{ id: string; displayName: string; role: RoleKey; alive: boolean }>;
  phases: Array<{ phaseId: string; sequence: number; kind: PhaseKind; payload: unknown }>;
  pairings: Array<{ phaseId: string | null; cupidId: string; playerIds: string[] }>;
  /** Published Day and Final ballot votes, one entry per voter. */
  ballots: Array<{ phaseId: string; actorId: string; targetIds: string[] }>;
}

export interface RecapCastEntry {
  name: string;
  role: RoleKey;
  team: 'Village' | 'Werewolves';
  survived: boolean;
  fate: string;
}

export interface RecapCycle {
  cycle: number;
  kind: PhaseKind;
  label: string;
  eliminated: Array<{ name: string; role: RoleKey; cause: Elimination['cause'] }>;
  /** Day and Final ballots: the totals that decided the result. A Mayor's vote counts twice. */
  voteTotals?: Array<{ name: string; votes: number }>;
  mayorVoted?: boolean;
  packTargets?: string[];
  saves: Array<{ bodyguard: string; saved: string }>;
  visions: Array<{ seer: string; seerRole: RoleKey; target: string; targetRole: RoleKey }>;
  pairing?: { cupid: string; lovers: string[] };
  hunterShots: Array<{ hunter: string; target: string }>;
  loverDeaths: Array<{ name: string; lover: string }>;
  tieDraws: Array<{ candidates: string[]; chosen: string[] }>;
  override?: { reason: string; calculated: string[] };
}

export interface RecapMoment {
  id: 'sharpest' | 'suspected' | 'closest' | 'save' | 'survivors' | 'last-wolf';
  title: string;
  detail: string;
}

export interface GameRecap {
  winner: 'VILLAGE' | 'WEREWOLF' | null;
  cast: RecapCastEntry[];
  cycles: RecapCycle[];
  moments: RecapMoment[];
}

function phaseLabel(kind: PhaseKind, sequence: number): string {
  if (kind === 'NIGHT') return `Night ${sequence}`;
  if (kind === 'FINAL_BALLOT') return `Final ballot ${sequence}`;
  return `Day ${sequence}`;
}

export function roleName(role: RoleKey): string {
  return ROLE_CATALOG[role]?.name ?? role;
}

function isWolf(role: RoleKey): boolean {
  return ROLE_CATALOG[role]?.faction === 'WEREWOLF';
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function readOutcome(value: unknown): PhaseResolution | null {
  if (!value || typeof value !== 'object') return null;
  const outcome = value as Partial<PhaseResolution>;
  return {
    phaseId: String(outcome.phaseId ?? ''),
    kind: (outcome.kind ?? 'DAY') as PhaseKind,
    slots: Number(outcome.slots ?? 1),
    tally: Array.isArray(outcome.tally) ? outcome.tally : [],
    selectedTargets: Array.isArray(outcome.selectedTargets) ? outcome.selectedTargets : [],
    protectedPlayerIds: Array.isArray(outcome.protectedPlayerIds) ? outcome.protectedPlayerIds : [],
    loverPair: outcome.loverPair ?? null,
    eliminations: Array.isArray(outcome.eliminations) ? outcome.eliminations : [],
    investigations: Array.isArray(outcome.investigations) ? outcome.investigations : [],
    hunterRequiredIds: Array.isArray(outcome.hunterRequiredIds) ? outcome.hunterRequiredIds : [],
    randomDraws: Array.isArray(outcome.randomDraws) ? outcome.randomDraws : [],
    warnings: [],
  };
}

const FATE_BY_CAUSE: Record<Elimination['cause'], string> = {
  DAY_VOTE: 'Voted out',
  WEREWOLF_ATTACK: 'Taken by the pack',
  HUNTER_SHOT: 'Shot by the Hunter',
  LOVER_BOND: 'Followed their lover',
};

export function buildRecap(input: RecapInput): GameRecap {
  const seats = new Map(input.roster.map((seat) => [seat.id, seat]));
  const name = (id: string) => seats.get(id)?.displayName ?? 'A player';
  const phases = [...input.phases].sort((a, b) => a.sequence - b.sequence);
  const bodyguard = input.roster.find((seat) => seat.role === 'BODYGUARD');
  const eliminatedAt = new Map<string, { sequence: number; label: string; cause: Elimination['cause'] }>();

  const cycles: RecapCycle[] = phases.map((phase) => {
    const payload = (phase.payload && typeof phase.payload === 'object' ? phase.payload : {}) as { publishedOutcome?: unknown; proposedOutcome?: unknown; overrideReason?: unknown };
    const published = readOutcome(payload.publishedOutcome) ?? readOutcome({});
    const proposed = readOutcome(payload.proposedOutcome);
    const outcome = published!;
    const label = phaseLabel(phase.kind, phase.sequence);
    const isBallot = phase.kind !== 'NIGHT';

    for (const elimination of outcome.eliminations) {
      if (!eliminatedAt.has(elimination.playerId)) eliminatedAt.set(elimination.playerId, { sequence: phase.sequence, label, cause: elimination.cause });
    }

    const packEliminated = new Set(outcome.eliminations.filter((item) => item.cause === 'WEREWOLF_ATTACK').map((item) => item.playerId));
    const hunters = outcome.eliminations.filter((item) => item.cause !== 'HUNTER_SHOT' && seats.get(item.playerId)?.role === 'HUNTER');
    const pair = input.pairings.find((pairing) => pairing.phaseId === phase.phaseId);
    // Cupid pairs once; a later Day's result may not carry the pair, so fall back to the recorded one.
    const recordedPair = pair ?? input.pairings[0];
    const loverPair = outcome.loverPair ?? (recordedPair ? { cupidId: recordedPair.cupidId, playerIds: recordedPair.playerIds } : null);
    const overrideReason = typeof payload.overrideReason === 'string' && payload.overrideReason.trim() ? payload.overrideReason.trim() : null;

    const cycle: RecapCycle = {
      cycle: phase.sequence,
      kind: phase.kind,
      label,
      eliminated: outcome.eliminations.map((item) => ({ name: name(item.playerId), role: seats.get(item.playerId)?.role ?? 'VILLAGER', cause: item.cause })),
      saves: isBallot || !bodyguard ? [] : outcome.selectedTargets
        .filter((id) => outcome.protectedPlayerIds.includes(id) && !packEliminated.has(id))
        .map((id) => ({ bodyguard: bodyguard.displayName, saved: name(id) })),
      visions: outcome.investigations.map((vision) => ({
        seer: name(vision.seerId),
        seerRole: seats.get(vision.seerId)?.role ?? 'SEER',
        target: name(vision.targetId),
        targetRole: vision.role,
      })),
      hunterShots: outcome.eliminations
        .filter((item) => item.cause === 'HUNTER_SHOT')
        .map((item, index) => ({ hunter: hunters[Math.min(index, hunters.length - 1)] ? name(hunters[Math.min(index, hunters.length - 1)].playerId) : 'The Hunter', target: name(item.playerId) })),
      loverDeaths: outcome.eliminations
        .filter((item) => item.cause === 'LOVER_BOND')
        .map((item) => {
          const partnerId = loverPair?.playerIds.find((id) => id !== item.playerId);
          return { name: name(item.playerId), lover: partnerId ? name(partnerId) : 'their lover' };
        }),
      tieDraws: outcome.randomDraws.map((draw) => ({
        candidates: draw.candidates.map(name).sort(byName),
        chosen: draw.selected.map(name).sort(byName),
      })),
    };
    if (isBallot) {
      cycle.voteTotals = outcome.tally
        .filter((entry) => entry.votes > 0 && seats.has(entry.playerId))
        .map((entry) => ({ name: name(entry.playerId), votes: entry.votes }))
        .sort((a, b) => b.votes - a.votes || byName(a.name, b.name));
      cycle.mayorVoted = input.ballots.some((ballot) => ballot.phaseId === phase.phaseId && seats.get(ballot.actorId)?.role === 'MAYOR');
    } else {
      cycle.packTargets = outcome.selectedTargets.map(name);
    }
    if (pair) cycle.pairing = { cupid: name(pair.cupidId), lovers: pair.playerIds.map(name) };
    if (overrideReason) {
      cycle.override = { reason: overrideReason, calculated: (proposed?.eliminations ?? []).map((item) => name(item.playerId)) };
    }
    return cycle;
  });

  const cast: RecapCastEntry[] = input.roster.map((seat): RecapCastEntry => {
    const death = eliminatedAt.get(seat.id);
    return {
      name: seat.displayName,
      role: seat.role,
      team: isWolf(seat.role) ? 'Werewolves' : 'Village',
      survived: seat.alive,
      fate: seat.alive ? 'Survived' : death ? `${FATE_BY_CAUSE[death.cause]} on ${death.label}` : 'Eliminated',
    };
  }).sort((a, b) => Number(b.survived) - Number(a.survived) || byName(a.name, b.name));

  return {
    winner: input.winner,
    cast,
    cycles,
    moments: buildMoments(input, cycles, cast, eliminatedAt),
  };
}

function leaders(counts: Map<string, number>): { names: string[]; count: number } | null {
  const best = Math.max(0, ...counts.values());
  if (best === 0) return null;
  return { names: [...counts].filter(([, count]) => count === best).map(([id]) => id), count: best };
}

function buildMoments(
  input: RecapInput,
  cycles: RecapCycle[],
  cast: RecapCastEntry[],
  eliminatedAt: Map<string, { sequence: number; label: string }>,
): RecapMoment[] {
  const seats = new Map(input.roster.map((seat) => [seat.id, seat]));
  const name = (id: string) => seats.get(id)?.displayName ?? 'A player';
  const names = (ids: string[]) => joinNames(ids.map(name).sort(byName));
  const moments: RecapMoment[] = [];

  const sharp = new Map<string, number>();
  const suspected = new Map<string, number>();
  for (const ballot of input.ballots) {
    for (const targetId of new Set(ballot.targetIds)) {
      const target = seats.get(targetId);
      if (!target) continue;
      if (isWolf(target.role)) sharp.set(ballot.actorId, (sharp.get(ballot.actorId) ?? 0) + 1);
      else suspected.set(targetId, (suspected.get(targetId) ?? 0) + 1);
    }
  }
  const sharpest = leaders(sharp);
  if (sharpest) {
    moments.push({ id: 'sharpest', title: 'Keenest eye in the house', detail: `${names(sharpest.names)} cast ${sharpest.count} Day ${sharpest.count === 1 ? 'vote' : 'votes'} at players who turned out to be Werewolves.` });
  }
  const mostSuspected = leaders(suspected);
  if (mostSuspected) {
    moments.push({ id: 'suspected', title: 'Best supporting suspicion', detail: `${names(mostSuspected.names)} drew ${mostSuspected.count} Day ${mostSuspected.count === 1 ? 'vote' : 'votes'} without ever being a Werewolf.` });
  }

  let closest: { cycle: RecapCycle; margin: number; detail: string } | null = null;
  for (const cycle of cycles) {
    if (cycle.kind === 'NIGHT' || cycle.override || !cycle.voteTotals?.length) continue;
    const outByVote = new Set(cycle.eliminated.filter((item) => item.cause === 'DAY_VOTE').map((item) => item.name));
    const draw = cycle.tieDraws[0];
    if (draw) {
      const level = cycle.voteTotals.find((total) => draw.candidates.includes(total.name))?.votes ?? 0;
      const detail = `${cycle.label} ended level at ${level} ${level === 1 ? 'vote' : 'votes'} each and the draw chose ${joinNames(draw.chosen)}.`;
      if (!closest || closest.margin > 0) closest = { cycle, margin: 0, detail };
      continue;
    }
    const lowestOut = Math.min(...cycle.voteTotals.filter((total) => outByVote.has(total.name)).map((total) => total.votes));
    const highestSafe = Math.max(...cycle.voteTotals.filter((total) => !outByVote.has(total.name)).map((total) => total.votes));
    if (!Number.isFinite(lowestOut) || !Number.isFinite(highestSafe)) continue;
    const margin = lowestOut - highestSafe;
    if (!closest || margin < closest.margin) {
      const shown = cycle.voteTotals.slice(0, 3).map((total) => `${total.name} ${total.votes}`).join(', ');
      closest = { cycle, margin, detail: `${cycle.label} was decided by ${margin} ${margin === 1 ? 'vote' : 'votes'}: ${shown}.` };
    }
  }
  if (closest) moments.push({ id: 'closest', title: 'Closest call', detail: closest.detail });

  const saves = cycles.flatMap((cycle) => cycle.saves.map((save) => ({ ...save, label: cycle.label })));
  if (saves.length) {
    const detail = saves.length === 1
      ? `${saves[0].bodyguard} the Bodyguard turned the pack away from ${saves[0].saved} on ${saves[0].label}.`
      : `${saves[0].bodyguard} the Bodyguard turned the pack away ${saves.length} times: ${joinNames(saves.map((save) => `${save.saved} on ${save.label}`))}.`;
    moments.push({ id: 'save', title: 'Saved in the wings', detail });
  }

  const survivors = cast.filter((entry) => entry.survived).map((entry) => entry.name);
  if (survivors.length) moments.push({ id: 'survivors', title: 'Still standing at the curtain', detail: `${joinNames(survivors)}.` });

  const wolves = input.roster.filter((seat) => isWolf(seat.role));
  if (wolves.length) {
    const reach = (seat: (typeof wolves)[number]) => seat.alive ? Number.POSITIVE_INFINITY : eliminatedAt.get(seat.id)?.sequence ?? -1;
    const longest = Math.max(...wolves.map(reach));
    const lasting = wolves.filter((seat) => reach(seat) === longest).map((seat) => seat.id);
    const label = [...eliminatedAt.entries()].find(([id]) => lasting.includes(id))?.[1].label;
    const detail = longest === Number.POSITIVE_INFINITY
      ? `${names(lasting)} ${lasting.length === 1 ? 'was' : 'were'} still prowling at the final curtain.`
      : label
        ? `${names(lasting)} lasted until ${label}.`
        : `${names(lasting)} lasted the longest.`;
    moments.push({ id: 'last-wolf', title: 'Last of the pack', detail });
  }
  return moments;
}

function eliminationWords(cycle: RecapCycle): string {
  if (!cycle.eliminated.length) return 'No one was eliminated.';
  return `Out: ${cycle.eliminated.map((item) => {
    const how = item.cause === 'HUNTER_SHOT' ? ', shot by the Hunter' : item.cause === 'LOVER_BOND' ? ', lover bond' : '';
    return `${item.name} (${roleName(item.role)}${how})`;
  }).join(', ')}.`;
}

/** Plain text for the moderator's "Copy recap". Roles are included because the game is over. */
export function recapText(recap: GameRecap, gameName: string): string {
  const lines: string[] = [
    `${gameName}: the final curtain`,
    recap.winner === 'VILLAGE' ? 'The Village wins.' : recap.winner === 'WEREWOLF' ? 'The Werewolves win.' : 'The game is complete.',
    '',
    'The cast',
    ...recap.cast.map((entry) => `${entry.name} (${roleName(entry.role)}): ${entry.fate}`),
    '',
    'What happened',
  ];
  for (const cycle of recap.cycles) lines.push(`${cycle.label}: ${cycleSentences(cycle).join(' ')}`);
  if (recap.moments.length) {
    lines.push('', 'Moments');
    for (const moment of recap.moments) lines.push(`${moment.title}: ${moment.detail}`);
  }
  return lines.join('\n');
}

/**
 * One cycle told in short sentences, shared by the copied text and the
 * player's Final curtain. A sentence may start in lower case so it can follow
 * "Night 2:"; the Final curtain capitalises it for display.
 */
export function cycleSentences(cycle: RecapCycle): string[] {
  const parts: string[] = [];
  if (cycle.voteTotals?.length) parts.push(`${cycle.voteTotals.map((total) => `${total.name} ${total.votes}`).join(', ')}${cycle.mayorVoted ? ' (the Mayor’s vote counted twice)' : ''}.`);
  if (cycle.packTargets?.length) parts.push(`the pack went for ${joinNames(cycle.packTargets)}.`);
  for (const save of cycle.saves) parts.push(`${save.bodyguard} the Bodyguard saved ${save.saved}.`);
  for (const vision of cycle.visions) parts.push(`${vision.seer} the ${roleName(vision.seerRole)} saw ${vision.target}: ${roleName(vision.targetRole)}.`);
  if (cycle.pairing) parts.push(`Cupid (${cycle.pairing.cupid}) linked ${joinNames(cycle.pairing.lovers)}.`);
  for (const draw of cycle.tieDraws) parts.push(`A tie between ${joinNames(draw.candidates)} was settled by a draw: ${joinNames(draw.chosen)}.`);
  if (cycle.override) parts.push(`The moderator changed the result (${cycle.override.reason}); the count had eliminated ${cycle.override.calculated.length ? joinNames(cycle.override.calculated) : 'no one'}.`);
  parts.push(eliminationWords(cycle));
  return parts;
}
