import { describe, expect, test } from 'vitest';
import { buildModeratorChoices, type ChoicesSeatInput } from './moderator-choices';

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
