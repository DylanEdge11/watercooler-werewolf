import { describe, expect, it } from 'vitest';
import { buildRecap, recapText, type RecapInput } from './recap';
import type { PhaseResolution, RoleKey } from './types';

function outcome(partial: Partial<PhaseResolution> & Pick<PhaseResolution, 'phaseId' | 'kind'>): PhaseResolution {
  return {
    slots: 1,
    tally: [],
    selectedTargets: [],
    protectedPlayerIds: [],
    loverPair: null,
    eliminations: [],
    investigations: [],
    hunterRequiredIds: [],
    randomDraws: [],
    warnings: [],
    ...partial,
  };
}

const roster: Array<{ id: string; displayName: string; role: RoleKey; alive: boolean }> = [
  { id: 'wren', displayName: 'Wren', role: 'WEREWOLF', alive: false },
  { id: 'wade', displayName: 'Wade', role: 'WEREWOLF', alive: false },
  { id: 'sky', displayName: 'Sky', role: 'SEER', alive: false },
  { id: 'ash', displayName: 'Ash', role: 'APPRENTICE_SEER', alive: true },
  { id: 'gale', displayName: 'Gale', role: 'BODYGUARD', alive: true },
  { id: 'hal', displayName: 'Hal', role: 'HUNTER', alive: false },
  { id: 'cory', displayName: 'Cory', role: 'CUPID', alive: true },
  { id: 'lee', displayName: 'Lee', role: 'VILLAGER', alive: false },
  { id: 'max', displayName: 'Max', role: 'MAYOR', alive: true },
  { id: 'val', displayName: 'Val', role: 'VILLAGER', alive: true },
];

function published(sequence: number, kind: PhaseResolution['kind'], published: PhaseResolution, extra: { proposed?: PhaseResolution; overrideReason?: string | null } = {}) {
  return {
    phaseId: published.phaseId,
    sequence,
    kind,
    payload: {
      kind,
      proposedOutcome: extra.proposed ?? published,
      publishedOutcome: published,
      eliminations: published.eliminations.map((item) => ({ ...item, displayName: roster.find((seat) => seat.id === item.playerId)?.displayName, role: roster.find((seat) => seat.id === item.playerId)?.role })),
      winner: null,
      overrideReason: extra.overrideReason ?? null,
    },
  };
}

// A complete fictional game: Day 1 takes Wren, Night 2 the pack goes for Val but Gale saves her
// and Sky sees Wade, Day 3 takes Hal who shoots Lee, Night 4 kills Sky and the Apprentice
// looks at Wade, Day 5 is a tie between Wade and Val settled by the draw, and the Village wins.
const input: RecapInput = {
  winner: 'VILLAGE',
  roster,
  phases: [
    published(1, 'DAY', outcome({ phaseId: 'd1', kind: 'DAY', tally: [{ playerId: 'wren', votes: 5 }, { playerId: 'val', votes: 3 }], selectedTargets: ['wren'], eliminations: [{ playerId: 'wren', cause: 'DAY_VOTE' }] })),
    published(2, 'NIGHT', outcome({ phaseId: 'n2', kind: 'NIGHT', tally: [{ playerId: 'val', votes: 2 }], selectedTargets: ['val'], protectedPlayerIds: ['val'], investigations: [{ seerId: 'sky', targetId: 'wade', role: 'WEREWOLF' }], loverPair: { cupidId: 'cory', playerIds: ['cory', 'max'] } })),
    published(3, 'DAY', outcome({ phaseId: 'd3', kind: 'DAY', tally: [{ playerId: 'hal', votes: 4 }, { playerId: 'wade', votes: 3 }], selectedTargets: ['hal'], eliminations: [{ playerId: 'hal', cause: 'DAY_VOTE' }, { playerId: 'lee', cause: 'HUNTER_SHOT' }] })),
    published(4, 'NIGHT', outcome({ phaseId: 'n4', kind: 'NIGHT', tally: [{ playerId: 'sky', votes: 1 }], selectedTargets: ['sky'], protectedPlayerIds: ['gale'], eliminations: [{ playerId: 'sky', cause: 'WEREWOLF_ATTACK' }], investigations: [{ seerId: 'ash', targetId: 'wade', role: 'WEREWOLF' }] })),
    published(5, 'DAY', outcome({ phaseId: 'd5', kind: 'DAY', tally: [{ playerId: 'val', votes: 2 }, { playerId: 'wade', votes: 2 }], selectedTargets: ['wade'], eliminations: [{ playerId: 'wade', cause: 'DAY_VOTE' }], randomDraws: [{ kind: 'BOUNDARY_TIE', candidates: ['val', 'wade'], selected: ['wade'], rolls: [0.7] }] })),
  ],
  pairings: [{ phaseId: 'n2', cupidId: 'cory', playerIds: ['cory', 'max'] }],
  ballots: [
    { phaseId: 'd1', actorId: 'val', targetIds: ['wren'] },
    { phaseId: 'd1', actorId: 'lee', targetIds: ['wren'] },
    { phaseId: 'd1', actorId: 'wren', targetIds: ['val'] },
    { phaseId: 'd1', actorId: 'wade', targetIds: ['val'] },
    { phaseId: 'd3', actorId: 'val', targetIds: ['wade'] },
    { phaseId: 'd3', actorId: 'wade', targetIds: ['hal'] },
    { phaseId: 'd3', actorId: 'sky', targetIds: ['wade'] },
    { phaseId: 'd5', actorId: 'val', targetIds: ['wade'] },
    { phaseId: 'd5', actorId: 'wade', targetIds: ['val'] },
  ],
};

describe('game recap', () => {
  const recap = buildRecap(input);

  it('names the winner and every player’s role and fate', () => {
    expect(recap.winner).toBe('VILLAGE');
    expect(recap.cast.find((entry) => entry.name === 'Wren')).toEqual({ name: 'Wren', role: 'WEREWOLF', team: 'Werewolves', survived: false, fate: 'Voted out on Day 1' });
    expect(recap.cast.find((entry) => entry.name === 'Lee')).toMatchObject({ survived: false, fate: 'Shot by the Hunter on Day 3' });
    expect(recap.cast.find((entry) => entry.name === 'Sky')).toMatchObject({ fate: 'Taken by the pack on Night 4' });
    expect(recap.cast.find((entry) => entry.name === 'Gale')).toMatchObject({ role: 'BODYGUARD', team: 'Village', survived: true, fate: 'Survived' });
    expect(recap.cast.map((entry) => entry.name)).toEqual(['Ash', 'Cory', 'Gale', 'Max', 'Val', 'Hal', 'Lee', 'Sky', 'Wade', 'Wren']);
  });

  it('tells each cycle in order with totals, the pack, saves, visions, pairings, shots, and draws', () => {
    expect(recap.cycles.map((cycle) => `${cycle.kind} ${cycle.cycle}`)).toEqual(['DAY 1', 'NIGHT 2', 'DAY 3', 'NIGHT 4', 'DAY 5']);
    const [day1, night2, day3, night4, day5] = recap.cycles;
    expect(day1.voteTotals).toEqual([{ name: 'Wren', votes: 5 }, { name: 'Val', votes: 3 }]);
    expect(day1.eliminated).toEqual([{ name: 'Wren', role: 'WEREWOLF', cause: 'DAY_VOTE' }]);
    expect(night2).toMatchObject({
      packTargets: ['Val'],
      saves: [{ bodyguard: 'Gale', saved: 'Val' }],
      visions: [{ seer: 'Sky', seerRole: 'SEER', target: 'Wade', targetRole: 'WEREWOLF' }],
      pairing: { cupid: 'Cory', lovers: ['Cory', 'Max'] },
      eliminated: [],
    });
    expect(night2.voteTotals).toBeUndefined();
    expect(day3.hunterShots).toEqual([{ hunter: 'Hal', target: 'Lee' }]);
    expect(night4.saves).toEqual([]);
    expect(night4.visions).toEqual([{ seer: 'Ash', seerRole: 'APPRENTICE_SEER', target: 'Wade', targetRole: 'WEREWOLF' }]);
    expect(day5.tieDraws).toEqual([{ candidates: ['Val', 'Wade'], chosen: ['Wade'] }]);
  });

  it('records lover-bond deaths and moderator overrides with the calculated result', () => {
    const lovers = buildRecap({
      ...input,
      roster: roster.map((seat) => ['cory', 'max'].includes(seat.id) ? { ...seat, alive: false } : seat),
      phases: [published(1, 'DAY', outcome({ phaseId: 'd1', kind: 'DAY', tally: [{ playerId: 'cory', votes: 3 }], selectedTargets: ['cory'], eliminations: [{ playerId: 'cory', cause: 'DAY_VOTE' }, { playerId: 'max', cause: 'LOVER_BOND' }] }), {
        proposed: outcome({ phaseId: 'd1', kind: 'DAY', selectedTargets: ['val'], eliminations: [{ playerId: 'val', cause: 'DAY_VOTE' }] }),
        overrideReason: 'A player voted by email after the lock.',
      })],
      ballots: [],
    });
    expect(lovers.cycles[0].loverDeaths).toEqual([{ name: 'Max', lover: 'Cory' }]);
    expect(lovers.cycles[0].override).toEqual({ reason: 'A player voted by email after the lock.', calculated: ['Val'] });
    expect(lovers.cast.find((entry) => entry.name === 'Max')).toMatchObject({ fate: 'Followed their lover on Day 1' });
  });

  it('awards only the moments the data proves', () => {
    expect(recap.moments).toEqual([
      { id: 'sharpest', title: 'Keenest eye in the house', detail: 'Val cast 3 Day votes at players who turned out to be Werewolves.' },
      { id: 'suspected', title: 'Best supporting suspicion', detail: 'Val drew 3 Day votes without ever being a Werewolf.' },
      { id: 'closest', title: 'Closest call', detail: 'Day 5 ended level at 2 votes each and the draw chose Wade.' },
      { id: 'save', title: 'Saved in the wings', detail: 'Gale the Bodyguard turned the pack away from Val on Night 2.' },
      { id: 'survivors', title: 'Still standing at the curtain', detail: 'Ash, Cory, Gale, Max and Val.' },
      { id: 'last-wolf', title: 'Last of the pack', detail: 'Wade lasted until Day 5.' },
    ]);
  });

  it('leaves out moments with nothing to show', () => {
    const quiet = buildRecap({ ...input, phases: [input.phases[0]], ballots: [], pairings: [] });
    expect(quiet.moments.map((moment) => moment.id)).toEqual(['closest', 'survivors', 'last-wolf']);
    expect(quiet.moments.find((moment) => moment.id === 'closest')?.detail).toBe('Day 1 was decided by 2 votes: Wren 5, Val 3.');
  });

  it('names a surviving Werewolf as the last of the pack', () => {
    const wolvesWin = buildRecap({ ...input, winner: 'WEREWOLF', roster: roster.map((seat) => seat.id === 'wade' ? { ...seat, alive: true } : seat), phases: input.phases.slice(0, 4) });
    expect(wolvesWin.moments.find((moment) => moment.id === 'last-wolf')?.detail).toBe('Wade was still prowling at the final curtain.');
  });

  it('says the Mayor’s vote counted twice only on ballots the Mayor voted in', () => {
    const withMayor = buildRecap({ ...input, ballots: [...input.ballots, { phaseId: 'd3', actorId: 'max', targetIds: ['hal'] }] });
    expect(withMayor.cycles.map((cycle) => cycle.mayorVoted)).toEqual([false, undefined, true, undefined, false]);
    expect(recapText(withMayor, 'Game')).toContain('Day 3: Hal 4, Wade 3 (the Mayor’s vote counted twice).');
    expect(recapText(recap, 'Game')).not.toContain('Mayor’s vote');
  });

  it('writes a plain-text recap for chat with roles included', () => {
    const text = recapText(recap, 'Friday Coffee Club');
    expect(text.split('\n').slice(0, 3)).toEqual(['Friday Coffee Club: the final curtain', 'The Village wins.', '']);
    expect(text).toContain('Wren (Werewolf): Voted out on Day 1');
    expect(text).toContain('Night 2: the pack went for Val. Gale the Bodyguard saved Val. Sky the Seer saw Wade: Werewolf. Cupid (Cory) linked Cory and Max.');
    expect(text).toContain('Day 5: Val 2, Wade 2. A tie between Val and Wade was settled by a draw: Wade. Out: Wade (Werewolf).');
    expect(text).toContain('Best supporting suspicion: Val drew 3 Day votes without ever being a Werewolf.');
  });
});
