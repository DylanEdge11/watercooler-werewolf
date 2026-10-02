import { phaseName } from './timeline-view';

/**
 * The numbers behind the Village stats view, built from what every player
 * already sees: published Day and Final ballots (who voted for whom), the
 * revealed roles of eliminated players, and chat message counts. Nothing here
 * reads an open ballot, a Night action, or a living player's role.
 *
 * This file only counts. `lib/player/game-stats-data.ts` reads the rows.
 */

export type StatsPhaseKind = 'DAY' | 'NIGHT' | 'FINAL_BALLOT';

export interface StatsPublishedPhase {
  phaseId: string;
  sequence: number;
  kind: StatsPhaseKind;
  publishedAt: string;
  eliminations: Array<{ playerId: string; displayName: string; role: string | null; cause: string }>;
  /** The Afterlife's votes settled every tied slot. */
  afterlifeBrokeTie: boolean;
}

export interface StatsInput {
  timeZone: string;
  gameStatus: string;
  /** Every claimed seat: the players of the current run. */
  seats: Array<{ id: string; displayName: string }>;
  living: number;
  werewolvesLiving: number;
  published: StatsPublishedPhase[];
  /** One row per player and target of a published ballot's latest saved vote. */
  votes: Array<{ phaseId: string; voterId: string; targetId: string }>;
  chat: {
    /** Every message in every room, by any author. */
    totalMessages: number;
    /** Town Hall messages by UTC quarter hour, `YYYY-MM-DDTHH:MM`. */
    townHallQuarterHours: Array<{ bucket: string; count: number }>;
    /** Town Hall messages written by players. */
    townHallByAuthor: Array<{ seatId: string; count: number }>;
  };
}

export interface PlayerCount {
  playerId: string;
  displayName: string;
  count: number;
}

export interface BallotStats {
  phaseId: string;
  sequence: number;
  kind: 'DAY' | 'FINAL_BALLOT';
  /** "Day 2", "Final ballot", or "Final ballot 2" when the showdown took several. */
  label: string;
  publishedAt: string;
  /** Players alive when this ballot opened. */
  living: number;
  /** Players who voted. */
  voters: number;
  votesReceived: PlayerCount[];
  /** Whoever received the most votes (several on a tie), and their count. */
  leaders: string[];
  topVotes: number;
  /** Top count minus the next player's; 0 on a tie at the top. */
  margin: number;
  tiedAtTop: boolean;
  afterlifeBrokeTie: boolean;
  /** Who the village vote eliminated (not Hunter shots or lover bonds). */
  votedOut: string[];
}

export interface StorySeries {
  living: number;
  werewolves: number;
}

export interface StoryStep extends StorySeries {
  phaseId: string;
  sequence: number;
  kind: StatsPhaseKind;
  label: string;
  publishedAt: string;
  eliminations: Array<{ displayName: string; role: string | null; cause: string }>;
}

export interface GameStats {
  timezone: string;
  gameStatus: string;
  summary: {
    players: number;
    living: number;
    eliminated: number;
    werewolvesLiving: number;
    ballots: number;
    votesCast: number;
    chatMessages: number;
  };
  ballots: BallotStats[];
  /** Votes received across every published ballot, most first. */
  votesReceived: PlayerCount[];
  mostVoted: { players: Array<{ playerId: string; displayName: string }>; votes: number } | null;
  story: { start: StorySeries; steps: StoryStep[] };
  /** Town Hall activity only; the all-rooms total is `summary.chatMessages`. */
  chat: {
    perDay: Array<{ date: string; count: number }>;
    perHour: number[];
    topChatters: PlayerCount[];
  };
  voteMatrix: {
    voters: Array<{ playerId: string; displayName: string }>;
    targets: Array<{ playerId: string; displayName: string }>;
    cells: Array<{ voter: number; target: number; votes: number }>;
    maxVotes: number;
  };
}

/** The chattiest players listed. */
export const TOP_CHATTERS = 8;
/** The most calendar days of chat returned, newest kept, so a very long game stays small. */
export const MAX_CHAT_DAYS = 60;

const byCountThenName = (a: { count: number; displayName: string }, b: { count: number; displayName: string }) =>
  b.count - a.count || a.displayName.localeCompare(b.displayName);

function localParts(timeZone: string): (instant: Date) => { date: string; hour: number } {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  }
  return (instant) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
  };
}

/** `YYYY-MM-DD` plus one calendar day. Plain date arithmetic, so a daylight-saving change cannot skip or repeat a day. */
function nextDate(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * Messages per local day and per local hour of the day. Quarter hours (rather than hours) keep the
 * split right in the zones whose offset is not a whole hour, such as India and Nepal.
 */
export function chatRhythm(
  quarterHours: StatsInput['chat']['townHallQuarterHours'],
  timeZone: string,
): { perDay: Array<{ date: string; count: number }>; perHour: number[] } {
  const local = localParts(timeZone);
  const days = new Map<string, number>();
  const perHour = Array.from({ length: 24 }, () => 0);
  for (const { bucket, count } of quarterHours) {
    const instant = new Date(`${bucket}:00.000Z`);
    if (Number.isNaN(instant.valueOf()) || count <= 0) continue;
    const { date, hour } = local(instant);
    days.set(date, (days.get(date) ?? 0) + count);
    perHour[hour] += count;
  }
  const dates = [...days.keys()].sort();
  const perDay: Array<{ date: string; count: number }> = [];
  if (dates.length) {
    // Quiet days between the first and last message are shown as zero rather than skipped.
    for (let date = dates[0]; date <= dates[dates.length - 1]; date = nextDate(date)) {
      perDay.push({ date, count: days.get(date) ?? 0 });
    }
  }
  return { perDay: perDay.slice(-MAX_CHAT_DAYS), perHour };
}

export function buildGameStats(input: StatsInput): GameStats {
  const names = new Map(input.seats.map((seat) => [seat.id, seat.displayName]));
  const phases = [...input.published].sort((a, b) => a.sequence - b.sequence);
  const ballotPhases = phases.filter((phase): phase is StatsPublishedPhase & { kind: 'DAY' | 'FINAL_BALLOT' } => phase.kind !== 'NIGHT');
  const ballotIds = new Set(ballotPhases.map((phase) => phase.phaseId));

  // Eliminations before each phase: players alive when a ballot opened.
  const players = input.seats.length;
  const eliminationsBefore = new Map<string, number>();
  const wolfEliminations = phases.reduce((sum, phase) => sum + phase.eliminations.filter((item) => item.role === 'WEREWOLF').length, 0);
  let removed = 0;
  for (const phase of phases) {
    eliminationsBefore.set(phase.phaseId, removed);
    removed += phase.eliminations.length;
  }

  const votesByBallot = new Map<string, Array<{ voterId: string; targetId: string }>>();
  for (const vote of input.votes) {
    if (!ballotIds.has(vote.phaseId) || !names.has(vote.voterId) || !names.has(vote.targetId)) continue;
    const list = votesByBallot.get(vote.phaseId) ?? [];
    list.push(vote);
    votesByBallot.set(vote.phaseId, list);
  }

  const finalBallots = ballotPhases.filter((phase) => phase.kind === 'FINAL_BALLOT').length;
  let finalSeen = 0;
  const totals = new Map<string, number>();
  const pairs = new Map<string, number>();
  const ballots: BallotStats[] = ballotPhases.map((phase) => {
    const votes = votesByBallot.get(phase.phaseId) ?? [];
    const received = new Map<string, number>();
    for (const vote of votes) {
      received.set(vote.targetId, (received.get(vote.targetId) ?? 0) + 1);
      totals.set(vote.targetId, (totals.get(vote.targetId) ?? 0) + 1);
      const pair = `${vote.voterId}\u0000${vote.targetId}`;
      pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
    }
    const votesReceived = [...received].map(([playerId, count]) => ({ playerId, displayName: names.get(playerId) ?? '', count })).sort(byCountThenName);
    const topVotes = votesReceived[0]?.count ?? 0;
    const leaders = votesReceived.filter((entry) => entry.count === topVotes && topVotes > 0).map((entry) => entry.displayName);
    const runnerUp = votesReceived.find((entry) => entry.count < topVotes)?.count ?? 0;
    if (phase.kind === 'FINAL_BALLOT') finalSeen += 1;
    return {
      phaseId: phase.phaseId,
      sequence: phase.sequence,
      kind: phase.kind,
      label: phase.kind === 'FINAL_BALLOT' && finalBallots > 1 ? `${phaseName(phase.kind)} ${finalSeen}` : phaseName(phase.kind, phase.sequence),
      publishedAt: phase.publishedAt,
      living: Math.max(0, players - (eliminationsBefore.get(phase.phaseId) ?? 0)),
      voters: new Set(votes.map((vote) => vote.voterId)).size,
      votesReceived,
      leaders,
      topVotes,
      margin: leaders.length > 1 ? 0 : topVotes - runnerUp,
      tiedAtTop: leaders.length > 1,
      afterlifeBrokeTie: phase.afterlifeBrokeTie,
      votedOut: phase.eliminations.filter((item) => item.cause === 'DAY_VOTE').map((item) => item.displayName),
    };
  });

  const votesReceived = [...totals].map(([playerId, count]) => ({ playerId, displayName: names.get(playerId) ?? '', count })).sort(byCountThenName);
  const mostVotes = votesReceived[0]?.count ?? 0;
  const mostVoted = mostVotes > 0
    ? {
        players: votesReceived.filter((entry) => entry.count === mostVotes).map(({ playerId, displayName }) => ({ playerId, displayName })),
        votes: mostVotes,
      }
    : null;

  // Players alive and werewolves left after each published phase. Roles are public only once a player is eliminated.
  const start: StorySeries = { living: players, werewolves: input.werewolvesLiving + wolfEliminations };
  let living = start.living;
  let werewolves = start.werewolves;
  const steps: StoryStep[] = phases.map((phase) => {
    living = Math.max(0, living - phase.eliminations.length);
    werewolves = Math.max(0, werewolves - phase.eliminations.filter((item) => item.role === 'WEREWOLF').length);
    return {
      phaseId: phase.phaseId,
      sequence: phase.sequence,
      kind: phase.kind,
      label: phaseName(phase.kind, phase.sequence),
      publishedAt: phase.publishedAt,
      living,
      werewolves,
      eliminations: phase.eliminations.map(({ displayName, role, cause }) => ({ displayName, role, cause })),
    };
  });

  const topChatters = input.chat.townHallByAuthor
    .filter((author) => names.has(author.seatId) && author.count > 0)
    .map((author) => ({ playerId: author.seatId, displayName: names.get(author.seatId) ?? '', count: author.count }))
    .sort(byCountThenName)
    .slice(0, TOP_CHATTERS);

  const matrixVoters = [...new Set([...pairs.keys()].map((pair) => pair.split('\u0000')[0]))]
    .map((playerId) => ({ playerId, displayName: names.get(playerId) ?? '' }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const matrixTargets = votesReceived.map(({ playerId, displayName }) => ({ playerId, displayName }));
  const voterIndex = new Map(matrixVoters.map((voter, index) => [voter.playerId, index]));
  const targetIndex = new Map(matrixTargets.map((target, index) => [target.playerId, index]));
  const cells = [...pairs].map(([pair, count]) => {
    const [voterId, targetId] = pair.split('\u0000');
    return { voter: voterIndex.get(voterId) ?? 0, target: targetIndex.get(targetId) ?? 0, votes: count };
  });

  return {
    timezone: input.timeZone,
    gameStatus: input.gameStatus,
    summary: {
      players,
      living: input.living,
      eliminated: Math.max(0, players - input.living),
      werewolvesLiving: input.werewolvesLiving,
      ballots: ballots.length,
      votesCast: input.votes.filter((vote) => ballotIds.has(vote.phaseId) && names.has(vote.voterId) && names.has(vote.targetId)).length,
      chatMessages: input.chat.totalMessages,
    },
    ballots,
    votesReceived,
    mostVoted,
    story: { start, steps },
    chat: { ...chatRhythm(input.chat.townHallQuarterHours, input.timeZone), topChatters },
    voteMatrix: { voters: matrixVoters, targets: matrixTargets, cells, maxVotes: Math.max(0, ...cells.map((cell) => cell.votes)) },
  };
}
