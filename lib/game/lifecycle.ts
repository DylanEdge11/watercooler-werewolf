export interface LifecycleDecision {
  allowed: boolean;
  idempotent?: boolean;
  error?: string;
}

export function canStopGame(status: string, reason: string, confirmed: boolean): LifecycleDecision {
  if (!confirmed) return { allowed: false, error: 'Stop requires explicit confirmation.' };
  if (reason.trim().length < 5) return { allowed: false, error: 'Stop requires a reason of at least 5 characters.' };
  if (status === 'STOPPED') return { allowed: true, idempotent: true };
  if (status === 'COMPLETED' || status === 'CANCELLED') {
    return { allowed: false, error: 'A completed or cancelled game cannot be stopped.' };
  }
  return { allowed: true };
}

export function canResetGame(
  status: string,
  gameName: string,
  confirmation: string,
  moderatorRole: string,
  confirmed: boolean,
): LifecycleDecision {
  if (moderatorRole !== 'OWNER') return { allowed: false, error: 'Only the game owner can reset this game.' };
  if (!confirmed || confirmation !== gameName) {
    return { allowed: false, error: 'Reset requires typing the exact game name.' };
  }
  if (status === 'CANCELLED') return { allowed: false, error: 'A cancelled game cannot be reset.' };
  if (['COMPOSITION_SAVING', 'ASSIGNMENT_PREVIEWING', 'ROSTER_IMPORTING', 'RESETTING', 'RESTORING'].includes(status)) {
    return { allowed: false, error: 'A setup or recovery operation is already in progress. Refresh and try again when it finishes.' };
  }
  return { allowed: true, idempotent: status === 'DRAFT' };
}

export function canCancelSetup(
  status: string,
  gameName: string,
  confirmation: string,
  moderatorRole: string,
  confirmed: boolean,
): LifecycleDecision {
  if (moderatorRole !== 'OWNER') return { allowed: false, error: 'Only the game owner can cancel an unfinished setup.' };
  if (!confirmed || confirmation !== gameName) {
    return { allowed: false, error: 'Cancelling setup requires explicit confirmation with the exact game name.' };
  }
  if (!['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW'].includes(status)) {
    return { allowed: false, error: 'Only an unfinished setup can be cancelled. Active and completed games are unchanged.' };
  }
  return { allowed: true };
}
