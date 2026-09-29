/**
 * Facts about a published result that every player may see, derived from the
 * stored PHASE_PUBLISHED payload. The player Timeline and the result email
 * both use these, so the two never disagree about what became public.
 */

/** Whether the result shows a pack attack that a protection stopped. */
export function protectedAttackBlocked(payload: Record<string, unknown>): boolean {
  const rawEliminations = Array.isArray(payload.eliminations) ? payload.eliminations : [];
  const publishedOutcome = payload.publishedOutcome && typeof payload.publishedOutcome === 'object'
    ? payload.publishedOutcome as Record<string, unknown>
    : null;
  const selectedTargets = Array.isArray(publishedOutcome?.selectedTargets)
    ? publishedOutcome.selectedTargets.filter((id): id is string => typeof id === 'string')
    : [];
  const protectedPlayerIds = Array.isArray(publishedOutcome?.protectedPlayerIds)
    ? publishedOutcome.protectedPlayerIds.filter((id): id is string => typeof id === 'string')
    : [];
  const packEliminatedIds = new Set(rawEliminations
    .map((item) => item as Record<string, unknown>)
    .filter((item) => item.cause === 'WEREWOLF_ATTACK')
    .map((item) => item.playerId)
    .filter((id): id is string => typeof id === 'string'));
  return selectedTargets.some((id) => protectedPlayerIds.includes(id) && !packEliminatedIds.has(id));
}
