import { describe, expect, it } from 'vitest';
import { createPreviewData } from '../app/moderator/player-preview/scenarios';

describe('player preview unreleased scenario', () => {
  it('does not expose role details, private rooms, or campaign history', () => {
    for (const role of ['SEER', 'CUPID', 'WEREWOLF', 'MASON'] as const) {
      const data = createPreviewData(role, 'unreleased');

      expect(data.player.role).toBeNull();
      expect(data.player.roleDefinition).toBeNull();
      expect(data.player.teammates).toEqual([]);
      expect(data.permission.actionKind).toBeNull();
      expect(data.currentAction).toBeNull();
      expect(data.phase).toBeNull();
      expect(data.participation).toEqual({ submitted: 0, eligible: 0 });
      expect(data.timeline).toEqual([]);
      expect(data.notifications).toEqual([]);
      expect(data.game.eliminatedPlayers).toEqual([]);
      expect(data.game.counts.living).toBe(data.game.counts.total);
      expect(data.game.counts.werewolvesRemaining).toBe(0);
      expect(data.rooms).toEqual([]);
    }
  });
});
