/** Phases that have stopped taking responses and are waiting for their result. */
const CLOSED_STATUSES = new Set(['LOCKED', 'PENDING_APPROVAL', 'PUBLISHING']);

export function phaseIsClosed(status: string | null | undefined): boolean {
  return status != null && CLOSED_STATUSES.has(status);
}

/**
 * The plain sentence for the small line of the deadline card, instead of the raw status name,
 * or null when the card should keep showing the status as it does for an open phase.
 */
export function phaseCardCaption(status: string | null | undefined): string | null {
  if (status === 'PENDING_HUNTER') return 'Waiting for the Hunter.';
  if (phaseIsClosed(status)) return 'Waiting for the moderator to publish the result.';
  return null;
}
