/** How often a page refreshes: every 30 s, or every 10 s while an open phase closes within 15 minutes. */
export const RELAXED_POLL_MS = 30_000;
export const URGENT_POLL_MS = 10_000;
const URGENT_WINDOW_MS = 15 * 60_000;

export function pollInterval(phase: { status: string; deadline?: string | null } | null | undefined, now = Date.now()): number {
  if (phase?.status !== 'OPEN' || !phase.deadline) return RELAXED_POLL_MS;
  const remaining = new Date(phase.deadline).valueOf() - now;
  return Number.isFinite(remaining) && remaining <= URGENT_WINDOW_MS ? URGENT_POLL_MS : RELAXED_POLL_MS;
}
