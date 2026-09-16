import { describe, expect, it } from 'vitest';
import type { GameBackup } from './snapshot';
import { backupComposition, backupGameFromRecord, backupSeats, restoreConfirmation, validateBackupForRestore } from './restore';

function backup(overrides: Partial<GameBackup> = {}): GameBackup {
  const seats = Array.from({ length: 20 }, (_, index) => ({
    id: `seat-${index}`,
    display_name: `Player ${index + 1}`,
    email: `player${index + 1}@example.test`,
    created_at: '2026-01-01T00:00:00.000Z',
  }));
  return {
    schemaVersion: 2,
    exportedAt: '2026-01-01T00:00:00.000Z',
    game: {
      id: 'game-1',
      name: 'Pilot Game',
      timezone: 'America/Regina',
      start_date: '2026-01-05',
      end_date: '2026-01-30',
      active_weekdays_json: '[1,2,3,4,5]',
      schedule_json: '{"dayCloses":"16:00","nightCloses":"09:00"}',
      day_divisor: 30,
      night_divisor: 30,
      hunter_window_minutes: 60,
      final_round_minutes: 60,
      chat_retention_days: 7,
      final_cutoff_at: '2026-01-30T23:00:00.000Z',
      publication_mode: 'REVIEW',
    },
    moderators: [],
    seats,
    composition: [{ game_id: 'game-1', role_key: 'DOCTOR', count: 1, power_snapshot: 2 }],
    assignmentBatches: [],
    roleAssignments: [],
    phases: [],
    actionSubmissions: [],
    resolutionProposals: [],
    gameEvents: [],
    chatRooms: [],
    chatRoomMembers: [],
    chatMessages: [],
    announcements: [],
    notifications: [],
    operationalEvents: [],
    pilotFeedback: [],
    ...overrides,
  };
}

describe('backup restore preparation', () => {
  it('accepts a valid setup snapshot and canonicalizes legacy Doctor composition', () => {
    const data = backup();
    expect(validateBackupForRestore(data, 'game-1')).toEqual([]);
    expect(backupComposition(data)).toEqual([{ roleKey: 'BODYGUARD', count: 1, powerSnapshot: 2 }]);
  });

  it('rejects a snapshot for another game or malformed roster', () => {
    const data = backup({ game: { ...(backup().game as Record<string, unknown>), id: 'other-game' }, seats: [] });
    const errors = validateBackupForRestore(data, 'game-1');
    expect(errors).toContain('The backup belongs to a different game.');
    expect(errors).toContain('The backup must contain between 20 and 80 seats.');
  });

  it('requires exact name confirmation for destructive restore', () => {
    expect(restoreConfirmation('Pilot Game', 'pilot game', true)).toBeTruthy();
    expect(restoreConfirmation('Pilot Game', 'Pilot Game', false)).toBeTruthy();
    expect(restoreConfirmation('Pilot Game', 'Pilot Game', true)).toBeNull();
  });

  it('normalizes snake_case and camelCase game configuration', () => {
    expect(backupGameFromRecord({
      name: 'Pilot Game', timezone: 'UTC', startDate: '2026-01-01', end_date: '2026-01-02',
      activeWeekdaysJson: '[]', schedule_json: '{}', day_divisor: 30, nightDivisor: 30,
      hunter_window_minutes: 60, finalRoundMinutes: 60, chat_retention_days: 7,
      finalCutoffAt: '2026-01-02T00:00:00.000Z', publicationMode: 'REVIEW',
    })).toMatchObject({ name: 'Pilot Game', timezone: 'UTC', publicationMode: 'REVIEW' });
  });

  it('keeps archived seats in the backup for audit but excludes them from a restored roster', () => {
    const data = backup({
      seats: [
        ...backup().seats,
        { id: 'archived-seat', display_name: 'Prior Player', email: 'prior@example.test', status: 'REMOVED', created_at: '2026-01-01' },
      ],
    });
    expect(validateBackupForRestore(data, 'game-1')).toEqual([]);
    expect(backupSeats(data)).toHaveLength(20);
    expect(backupSeats(data).some((seat) => seat.id === 'archived-seat')).toBe(false);
  });

  it('rejects an impossible backed-up calendar date', () => {
    const data = backup({ game: { ...(backup().game as Record<string, unknown>), start_date: '2026-02-31' } });
    expect(validateBackupForRestore(data, 'game-1')).toContain('The backup is missing valid game configuration.');
  });
});
