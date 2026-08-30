export type LifecycleGameStatus =
  | 'DRAFT'
  | 'REGISTRATION'
  | 'ASSIGNMENT_PREVIEW'
  | 'ACTIVE'
  | 'FINAL_SHOWDOWN'
  | 'COMPLETED'
  | 'STOPPED'
  | 'CANCELLED';

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
  return { allowed: true, idempotent: status === 'DRAFT' };
}
