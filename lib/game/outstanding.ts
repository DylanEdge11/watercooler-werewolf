import { permissionForRole } from './actions';
import type { ActionKind, PhaseKind, PlayerState } from './types';

/**
 * Living players who still owe a response for an open phase. For a Night this
 * follows the same permission rule players see, so it lists only roles with a
 * Night action. The names are for the moderator alone: a Night list reveals
 * roles, so it must never be copied into a group chat (see nudgeMessage).
 */
export function outstandingResponders(input: {
  phase: { kind: PhaseKind; status: string };
  players: PlayerState[];
  actions: Array<{ actorId: string; kind: ActionKind }>;
  cupidPairExists: boolean;
}): PlayerState[] {
  if (input.phase.status !== 'OPEN') return [];
  const seerAlive = input.players.some((player) => player.alive && player.role === 'SEER');
  const saved = new Set(input.actions.map((action) => `${action.actorId}:${action.kind}`));
  return input.players
    .filter((player) => player.alive)
    .filter((player) => {
      const { actionKind } = permissionForRole(player.role, input.phase.kind, 1, false, {
        seerAlive,
        cupidPairExists: input.cupidPairExists,
      });
      return actionKind !== null && !saved.has(`${player.id}:${actionKind}`);
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
}
