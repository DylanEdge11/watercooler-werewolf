import { describe, expect, test } from 'vitest';
import { buildGameStats, chatRhythm, MAX_CHAT_DAYS, TOP_CHATTERS, type StatsInput, type StatsPublishedPhase } from './game-stats';

const seats = ['Ada', 'Bo', 'Cy', 'Di', 'Eli', 'Fay'].map((displayName) => ({ id: displayName.toLowerCase(), displayName }));

function phase(overrides: Partial<StatsPublishedPhase> & Pick<StatsPublishedPhase, 'phaseId' | 'sequence' | 'kind'>): StatsPublishedPhase {
  return { publishedAt: '2026-03-02T17:00:00.000Z', eliminations: [], afterlifeBrokeTie: false, ...overrides };
}

function input(overrides: Partial<StatsInput> = {}): StatsInput {
  return {
    timeZone: 'UTC',
    gameStatus: 'ACTIVE',
    seats,
    living: seats.length,
    werewolvesLiving: 2,
    published: [],
    votes: [],
    chat: { totalMessages: 0, townHallQuarterHours: [], townHallByAuthor: [] },
    ...overrides,
  };
}

describe('buildGameStats', () => {
  test('an empty game has zero counts and no leaders', () => {
    const stats = buildGameStats(input());
    expect(stats.summary).toEqual({ players: 6, living: 6, eliminated: 0, werewolvesLiving: 2, ballots: 0, votesCast: 0, chatMessages: 0 });
    expect(stats.ballots).toEqual([]);
    expect(stats.mostVoted).toBeNull();
    expect(stats.story).toEqual({ start: { living: 6, werewolves: 2 }, steps: [] });
    expect(stats.chat.perDay).toEqual([]);
    expect(stats.chat.perHour).toHaveLength(24);
    expect(stats.voteMatrix).toEqual({ voters: [], targets: [], cells: [], maxVotes: 0 });
  });

  test('counts each ballot, names its leader and margin, and who the village voted out', () => {
    const stats = buildGameStats(input({
      living: 5,
      published: [
        phase({ phaseId: 'day1', sequence: 1, kind: 'DAY', eliminations: [{ playerId: 'cy', displayName: 'Cy', role: 'VILLAGER', cause: 'DAY_VOTE' }] }),
      ],
      votes: [
        { phaseId: 'day1', voterId: 'ada', targetId: 'cy' },
        { phaseId: 'day1', voterId: 'bo', targetId: 'cy' },
        { phaseId: 'day1', voterId: 'di', targetId: 'cy' },
        { phaseId: 'day1', voterId: 'cy', targetId: 'bo' },
        { phaseId: 'day1', voterId: 'eli', targetId: 'ada' },
      ],
    }));
    const [day] = stats.ballots;
    expect(day).toMatchObject({ label: 'Day 1', living: 6, voters: 5, leaders: ['Cy'], topVotes: 3, margin: 2, tiedAtTop: false, votedOut: ['Cy'] });
    expect(day.votesReceived).toEqual([
      { playerId: 'cy', displayName: 'Cy', count: 3 },
      { playerId: 'ada', displayName: 'Ada', count: 1 },
      { playerId: 'bo', displayName: 'Bo', count: 1 },
    ]);
    expect(stats.summary.votesCast).toBe(5);
    expect(stats.mostVoted).toEqual({ players: [{ playerId: 'cy', displayName: 'Cy' }], votes: 3 });
  });

  test('a tie at the top has no margin and lists every leader', () => {
    const stats = buildGameStats(input({
      published: [phase({ phaseId: 'day1', sequence: 1, kind: 'DAY', afterlifeBrokeTie: true })],
      votes: [
        { phaseId: 'day1', voterId: 'ada', targetId: 'bo' },
        { phaseId: 'day1', voterId: 'cy', targetId: 'bo' },
        { phaseId: 'day1', voterId: 'di', targetId: 'eli' },
        { phaseId: 'day1', voterId: 'fay', targetId: 'eli' },
        { phaseId: 'day1', voterId: 'bo', targetId: 'ada' },
      ],
    }));
    expect(stats.ballots[0]).toMatchObject({ leaders: ['Bo', 'Eli'], topVotes: 2, margin: 0, tiedAtTop: true, afterlifeBrokeTie: true });
    expect(stats.mostVoted?.players.map((player) => player.displayName)).toEqual(['Bo', 'Eli']);
  });

  test('a ballot with a single candidate has a margin equal to its votes', () => {
    const stats = buildGameStats(input({
      published: [phase({ phaseId: 'day1', sequence: 1, kind: 'DAY' })],
      votes: [{ phaseId: 'day1', voterId: 'ada', targetId: 'bo' }, { phaseId: 'day1', voterId: 'cy', targetId: 'bo' }],
    }));
    expect(stats.ballots[0]).toMatchObject({ leaders: ['Bo'], topVotes: 2, margin: 2 });
  });

  test('a published ballot nobody voted in has no leader', () => {
    const stats = buildGameStats(input({ published: [phase({ phaseId: 'day1', sequence: 1, kind: 'DAY' })] }));
    expect(stats.ballots[0]).toMatchObject({ voters: 0, leaders: [], topVotes: 0, margin: 0, tiedAtTop: false, votedOut: [] });
    expect(stats.mostVoted).toBeNull();
  });

  test('most voted adds up across days, and living counts follow Night eliminations', () => {
    const stats = buildGameStats(input({
      living: 3,
      published: [
        phase({ phaseId: 'day1', sequence: 1, kind: 'DAY', eliminations: [{ playerId: 'cy', displayName: 'Cy', role: 'VILLAGER', cause: 'DAY_VOTE' }] }),
        phase({ phaseId: 'night1', sequence: 2, kind: 'NIGHT', eliminations: [{ playerId: 'di', displayName: 'Di', role: 'SEER', cause: 'WEREWOLF_ATTACK' }] }),
        phase({ phaseId: 'day2', sequence: 3, kind: 'DAY', eliminations: [{ playerId: 'bo', displayName: 'Bo', role: 'WEREWOLF', cause: 'DAY_VOTE' }] }),
      ],
      werewolvesLiving: 1,
      votes: [
        { phaseId: 'day1', voterId: 'ada', targetId: 'bo' },
        { phaseId: 'day1', voterId: 'eli', targetId: 'cy' },
        { phaseId: 'day1', voterId: 'fay', targetId: 'cy' },
        { phaseId: 'day2', voterId: 'ada', targetId: 'bo' },
        { phaseId: 'day2', voterId: 'fay', targetId: 'bo' },
        { phaseId: 'day2', voterId: 'eli', targetId: 'ada' },
      ],
    }));
    expect(stats.ballots.map((ballot) => [ballot.label, ballot.living])).toEqual([['Day 1', 6], ['Day 2', 4]]);
    expect(stats.votesReceived.slice(0, 2)).toEqual([
      { playerId: 'bo', displayName: 'Bo', count: 3 },
      { playerId: 'cy', displayName: 'Cy', count: 2 },
    ]);
    expect(stats.mostVoted).toEqual({ players: [{ playerId: 'bo', displayName: 'Bo' }], votes: 3 });
  });

  test('ignores votes for unpublished phases, Night phases, and players outside the run', () => {
    const stats = buildGameStats(input({
      published: [phase({ phaseId: 'day1', sequence: 1, kind: 'DAY' }), phase({ phaseId: 'night1', sequence: 2, kind: 'NIGHT' })],
      votes: [
        { phaseId: 'day1', voterId: 'ada', targetId: 'bo' },
        { phaseId: 'day1', voterId: 'ghost', targetId: 'bo' },
        { phaseId: 'day1', voterId: 'ada', targetId: 'ghost' },
        { phaseId: 'night1', voterId: 'ada', targetId: 'bo' },
        { phaseId: 'open-day', voterId: 'ada', targetId: 'bo' },
      ],
    }));
    expect(stats.summary.votesCast).toBe(1);
    expect(stats.ballots).toHaveLength(1);
    expect(stats.ballots[0].votesReceived).toEqual([{ playerId: 'bo', displayName: 'Bo', count: 1 }]);
  });

  test('names several Final ballots apart', () => {
    const one = buildGameStats(input({ published: [phase({ phaseId: 'f1', sequence: 5, kind: 'FINAL_BALLOT' })] }));
    expect(one.ballots[0].label).toBe('Final ballot');
    const two = buildGameStats(input({ published: [phase({ phaseId: 'f2', sequence: 6, kind: 'FINAL_BALLOT' }), phase({ phaseId: 'f1', sequence: 5, kind: 'FINAL_BALLOT' })] }));
    expect(two.ballots.map((ballot) => ballot.label)).toEqual(['Final ballot 1', 'Final ballot 2']);
  });

  test('the story counts players and werewolves left after each phase from revealed roles', () => {
    const stats = buildGameStats(input({
      living: 3,
      werewolvesLiving: 1,
      published: [
        phase({ phaseId: 'night1', sequence: 2, kind: 'NIGHT', eliminations: [{ playerId: 'di', displayName: 'Di', role: 'SEER', cause: 'WEREWOLF_ATTACK' }] }),
        phase({ phaseId: 'day1', sequence: 1, kind: 'DAY', eliminations: [{ playerId: 'bo', displayName: 'Bo', role: 'WEREWOLF', cause: 'DAY_VOTE' }, { playerId: 'cy', displayName: 'Cy', role: 'VILLAGER', cause: 'HUNTER_SHOT' }] }),
      ],
    }));
    expect(stats.story.start).toEqual({ living: 6, werewolves: 2 });
    expect(stats.story.steps.map((step) => [step.label, step.living, step.werewolves])).toEqual([['Day 1', 4, 1], ['Night 1', 3, 1]]);
    expect(stats.story.steps[0].eliminations).toEqual([
      { displayName: 'Bo', role: 'WEREWOLF', cause: 'DAY_VOTE' },
      { displayName: 'Cy', role: 'VILLAGER', cause: 'HUNTER_SHOT' },
    ]);
    // A Hunter shot is not "voted out".
    expect(stats.ballots[0].votedOut).toEqual(['Bo']);
  });

  test('the vote matrix lists who voted for whom across every ballot', () => {
    const stats = buildGameStats(input({
      published: [phase({ phaseId: 'day1', sequence: 1, kind: 'DAY' }), phase({ phaseId: 'day2', sequence: 3, kind: 'DAY' })],
      votes: [
        { phaseId: 'day1', voterId: 'ada', targetId: 'bo' },
        { phaseId: 'day2', voterId: 'ada', targetId: 'bo' },
        { phaseId: 'day1', voterId: 'cy', targetId: 'bo' },
        { phaseId: 'day2', voterId: 'cy', targetId: 'ada' },
      ],
    }));
    const { voters, targets, cells, maxVotes } = stats.voteMatrix;
    expect(voters.map((voter) => voter.displayName)).toEqual(['Ada', 'Cy']);
    expect(targets.map((target) => target.displayName)).toEqual(['Bo', 'Ada']);
    const named = cells.map((cell) => [voters[cell.voter].displayName, targets[cell.target].displayName, cell.votes]).sort();
    expect(named).toEqual([['Ada', 'Bo', 2], ['Cy', 'Ada', 1], ['Cy', 'Bo', 1]]);
    expect(maxVotes).toBe(2);
  });

  test('top chatters are Town Hall players, most first, capped, and skip people outside the run', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, displayName: `Player ${String(index).padStart(2, '0')}` }));
    const stats = buildGameStats(input({
      seats: many,
      chat: {
        totalMessages: 0,
        townHallQuarterHours: [],
        townHallByAuthor: [...many.map((seat, index) => ({ seatId: seat.id, count: index + 1 })), { seatId: 'removed', count: 99 }, { seatId: 'p0', count: 0 }],
      },
    }));
    expect(stats.chat.topChatters).toHaveLength(TOP_CHATTERS);
    expect(stats.chat.topChatters[0]).toEqual({ playerId: 'p11', displayName: 'Player 11', count: 12 });
    expect(stats.chat.topChatters.some((chatter) => chatter.playerId === 'removed')).toBe(false);
  });

  test('the all-rooms chat total passes through unchanged', () => {
    expect(buildGameStats(input({ chat: { totalMessages: 412, townHallQuarterHours: [], townHallByAuthor: [] } })).summary.chatMessages).toBe(412);
  });
});

describe('chatRhythm', () => {
  test('splits messages by the game timezone, not UTC', () => {
    // 02:30 UTC on 4 March is 21:30 on 3 March in New York (UTC-5).
    const { perDay, perHour } = chatRhythm([{ bucket: '2026-03-04T02:30', count: 3 }, { bucket: '2026-03-04T15:00', count: 2 }], 'America/New_York');
    expect(perDay).toEqual([{ date: '2026-03-03', count: 3 }, { date: '2026-03-04', count: 2 }]);
    expect(perHour[21]).toBe(3);
    expect(perHour[10]).toBe(2);
  });

  test('follows daylight saving time', () => {
    // New York is UTC-4 after 8 March 2026: 02:30 UTC is 22:30 the evening before.
    const { perDay, perHour } = chatRhythm([{ bucket: '2026-03-09T02:30', count: 1 }], 'America/New_York');
    expect(perDay).toEqual([{ date: '2026-03-08', count: 1 }]);
    expect(perHour[22]).toBe(1);
  });

  test('keeps half-hour zones on the right local hour', () => {
    // India is UTC+5:30: 18:45 UTC is 00:15 the next day, 18:15 UTC is 23:45.
    const { perDay, perHour } = chatRhythm([{ bucket: '2026-03-04T18:15', count: 1 }, { bucket: '2026-03-04T18:45', count: 4 }], 'Asia/Kolkata');
    expect(perDay).toEqual([{ date: '2026-03-04', count: 1 }, { date: '2026-03-05', count: 4 }]);
    expect(perHour[23]).toBe(1);
    expect(perHour[0]).toBe(4);
  });

  test('shows quiet days between the first and last message as zero', () => {
    const { perDay } = chatRhythm([{ bucket: '2026-03-01T12:00', count: 2 }, { bucket: '2026-03-04T12:00', count: 1 }], 'UTC');
    expect(perDay).toEqual([
      { date: '2026-03-01', count: 2 },
      { date: '2026-03-02', count: 0 },
      { date: '2026-03-03', count: 0 },
      { date: '2026-03-04', count: 1 },
    ]);
  });

  test('keeps only the newest days of a very long game', () => {
    const { perDay } = chatRhythm([{ bucket: '2025-12-01T12:00', count: 1 }, { bucket: '2026-03-04T12:00', count: 1 }], 'UTC');
    expect(perDay).toHaveLength(MAX_CHAT_DAYS);
    expect(perDay.at(-1)).toEqual({ date: '2026-03-04', count: 1 });
  });

  test('falls back to UTC for an unknown timezone and skips unreadable buckets', () => {
    const { perDay } = chatRhythm([{ bucket: '2026-03-04T12:00', count: 2 }, { bucket: 'not-a-time', count: 5 }], 'Mars/Olympus');
    expect(perDay).toEqual([{ date: '2026-03-04', count: 2 }]);
  });
});
