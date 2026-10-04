import { describe, expect, test } from 'vitest';
import { buildModeratorChoices, describeChoiceCounts, groupPhaseChoices, type ChoicesSeatInput } from './moderator-choices';

const seats: ChoicesSeatInput[] = [
  { id: 'ada', displayName: 'Ada', role: 'SEER' },
  { id: 'bo', displayName: 'Bo', role: 'WEREWOLF' },
  { id: 'cy', displayName: 'Cy', role: 'BODYGUARD' },
  { id: 'di', displayName: 'Di', role: 'CUPID' },
  { id: 'eli', displayName: 'Eli', role: 'VILLAGER' },
  { id: 'fay', displayName: 'Fay', role: 'WEREWOLF' },
];

describe('buildModeratorChoices', () => {
  test('names every chooser and target with their role, newest phase first', () => {
    const result = buildModeratorChoices({
      seats,
      phases: [
        { id: 'night2', sequence: 2, kind: 'NIGHT', status: 'PUBLISHED' },
        { id: 'day3', sequence: 3, kind: 'DAY', status: 'OPEN' },
      ],
      actions: [
        { phaseId: 'night2', actorId: 'ada', kind: 'INVESTIGATE', targetIds: ['bo'] },
        { phaseId: 'day3', actorId: 'eli', kind: 'DAY_VOTE', targetIds: ['bo', 'fay'] },
      ],
    });
    expect(result.map((phase) => phase.phaseId)).toEqual(['day3', 'night2']);
    expect(result[1].choices).toEqual([{
      actorId: 'ada',
      actorName: 'Ada',
      actorRole: 'Seer',
      kind: 'INVESTIGATE',
      label: 'Investigated',
      targets: [{ id: 'bo', displayName: 'Bo', role: 'Werewolf' }],
    }]);
    expect(result[0].choices[0].targets.map((target) => target.displayName)).toEqual(['Bo', 'Fay']);
  });

  test('lists Night roles before ballots, each sorted by name', () => {
    const [night] = buildModeratorChoices({
      seats,
      phases: [{ id: 'n', sequence: 2, kind: 'NIGHT', status: 'OPEN' }],
      actions: [
        { phaseId: 'n', actorId: 'cy', kind: 'PROTECT', targetIds: ['eli'] },
        { phaseId: 'n', actorId: 'fay', kind: 'WOLF_VOTE', targetIds: ['eli'] },
        { phaseId: 'n', actorId: 'di', kind: 'CUPID_PAIR', targetIds: ['di', 'eli'] },
        { phaseId: 'n', actorId: 'bo', kind: 'WOLF_VOTE', targetIds: ['ada'] },
        { phaseId: 'n', actorId: 'ada', kind: 'INVESTIGATE', targetIds: ['fay'] },
      ],
    });
    expect(night.choices.map((choice) => `${choice.actorName}:${choice.kind}`)).toEqual([
      'Bo:WOLF_VOTE',
      'Fay:WOLF_VOTE',
      'Ada:INVESTIGATE',
      'Cy:PROTECT',
      'Di:CUPID_PAIR',
    ]);
  });

  test('keeps a phase with no choices, leaves out actions for unknown phases, and labels unknown seats', () => {
    const result = buildModeratorChoices({
      seats,
      phases: [{ id: 'day1', sequence: 1, kind: 'DAY', status: 'OPEN' }],
      actions: [
        { phaseId: 'elsewhere', actorId: 'ada', kind: 'DAY_VOTE', targetIds: ['bo'] },
        { phaseId: 'day1', actorId: 'gone', kind: 'DAY_VOTE', targetIds: ['missing'] },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].choices).toEqual([{
      actorId: 'gone',
      actorName: 'Unknown player',
      actorRole: null,
      kind: 'DAY_VOTE',
      label: 'Voted for',
      targets: [{ id: 'missing', displayName: 'Unknown player', role: null }],
    }]);
  });
});

describe('groupPhaseChoices', () => {
  const night = () => buildModeratorChoices({
    seats,
    phases: [{ id: 'night1', sequence: 2, kind: 'NIGHT', status: 'PUBLISHED' }],
    actions: [
      { phaseId: 'night1', actorId: 'bo', kind: 'WOLF_VOTE', targetIds: ['eli'] },
      { phaseId: 'night1', actorId: 'fay', kind: 'WOLF_VOTE', targetIds: ['eli'] },
      { phaseId: 'night1', actorId: 'ada', kind: 'INVESTIGATE', targetIds: ['bo'] },
      { phaseId: 'night1', actorId: 'cy', kind: 'PROTECT', targetIds: ['eli'] },
      { phaseId: 'night1', actorId: 'di', kind: 'CUPID_PAIR', targetIds: ['ada', 'cy'] },
    ],
  })[0].choices;

  test('puts the special powers apart from the pack’s targets', () => {
    const { powers, groups } = groupPhaseChoices('NIGHT', night());
    expect(powers.map((choice) => `${choice.actorName}:${choice.kind}`)).toEqual(['Ada:INVESTIGATE', 'Cy:PROTECT', 'Di:CUPID_PAIR']);
    expect(groups.map((group) => group.key)).toEqual(['pack']);
    expect(groups[0].title).toBe('Pack targets');
    expect(groups[0].choices.map((choice) => choice.actorName)).toEqual(['Bo', 'Fay']);
  });

  test('counts the Hunter’s shot as a special power', () => {
    const [phase] = buildModeratorChoices({
      seats,
      phases: [{ id: 'day1', sequence: 1, kind: 'DAY', status: 'PENDING_HUNTER' }],
      actions: [{ phaseId: 'day1', actorId: 'eli', kind: 'HUNTER_SHOT', targetIds: ['bo'] }],
    });
    expect(groupPhaseChoices('DAY', phase.choices).powers.map((choice) => choice.kind)).toEqual(['HUNTER_SHOT']);
  });

  test('keeps Day votes and Afterlife votes as their own lists, titled for the ballot', () => {
    const [phase] = buildModeratorChoices({
      seats,
      phases: [{ id: 'day1', sequence: 1, kind: 'DAY', status: 'PUBLISHED' }],
      actions: [
        { phaseId: 'day1', actorId: 'eli', kind: 'DAY_VOTE', targetIds: ['bo'] },
        { phaseId: 'day1', actorId: 'ada', kind: 'DAY_VOTE', targetIds: ['bo'] },
        { phaseId: 'day1', actorId: 'fay', kind: 'AFTERLIFE_VOTE', targetIds: ['bo'] },
      ],
    });
    const day = groupPhaseChoices('DAY', phase.choices);
    expect(day.powers).toEqual([]);
    expect(day.groups.map((group) => [group.title, group.choices.length])).toEqual([['Day votes', 2], ['Afterlife tiebreak votes', 1]]);
    expect(groupPhaseChoices('FINAL_BALLOT', phase.choices).groups[0].title).toBe('Final ballot votes');
  });

  test('leaves out a list with nothing in it, and has nothing at all for a phase with no choices', () => {
    expect(groupPhaseChoices('NIGHT', [])).toEqual({ powers: [], groups: [] });
  });
});

describe('describeChoiceCounts', () => {
  test('summarises what a collapsed phase holds', () => {
    const [phase] = buildModeratorChoices({
      seats,
      phases: [{ id: 'night1', sequence: 2, kind: 'NIGHT', status: 'PUBLISHED' }],
      actions: [
        { phaseId: 'night1', actorId: 'bo', kind: 'WOLF_VOTE', targetIds: ['eli'] },
        { phaseId: 'night1', actorId: 'ada', kind: 'INVESTIGATE', targetIds: ['bo'] },
        { phaseId: 'night1', actorId: 'cy', kind: 'PROTECT', targetIds: ['eli'] },
      ],
    });
    expect(describeChoiceCounts(groupPhaseChoices('NIGHT', phase.choices))).toBe('2 special powers, 1 pack target');
  });

  test('counts votes and Afterlife votes, and is empty when nothing was saved', () => {
    const [phase] = buildModeratorChoices({
      seats,
      phases: [{ id: 'day1', sequence: 1, kind: 'DAY', status: 'PUBLISHED' }],
      actions: [
        { phaseId: 'day1', actorId: 'eli', kind: 'DAY_VOTE', targetIds: ['bo'] },
        { phaseId: 'day1', actorId: 'fay', kind: 'AFTERLIFE_VOTE', targetIds: ['bo'] },
      ],
    });
    expect(describeChoiceCounts(groupPhaseChoices('DAY', phase.choices))).toBe('1 vote, 1 Afterlife vote');
    expect(describeChoiceCounts({ powers: [], groups: [] })).toBe('');
  });
});
