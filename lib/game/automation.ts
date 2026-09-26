/**
 * Automatic publication rules. Pure: given a game, its current phase, and the
 * time, decide the one step the sweep should take next. The sweep
 * (lib/game/automation-sweep.ts) applies that step through the same shared
 * transitions the moderator's buttons use.
 *
 * In AUTOMATIC mode: an open phase locks and calculates at its deadline; a
 * Hunter follow-up finishes once the shot is saved or the Hunter window
 * closes; a calculated result publishes once it has waited the review window.
 * REVIEW mode, a paused game, or a game that is not running never acts.
 * Opening phases stays manual.
 */

export type PublicationMode = 'REVIEW' | 'AUTOMATIC';

export interface AutomationGame {
  status: string;
  publicationMode: PublicationMode;
  reviewWindowMinutes: number;
  pausedAt: string | null;
}

export interface AutomationPhase {
  id: string;
  status: string;
  closesAt: string;
  hunterDeadlineAt: string | null;
  /** When the phase last changed status; for PENDING_APPROVAL, when the result became ready for review. */
  updatedAt: string;
  hunterShotSaved: boolean;
}

export type AutomaticStep =
  | { kind: 'LOCK_AND_PROPOSE'; phaseId: string }
  | { kind: 'FINALIZE_HUNTER'; phaseId: string; skipHunter: boolean }
  | { kind: 'PUBLISH'; phaseId: string; reviewCutoff: string };

const RUNNING = new Set(['ACTIVE', 'FINAL_SHOWDOWN']);

function automationOn(game: AutomationGame): boolean {
  return RUNNING.has(game.status) && game.publicationMode === 'AUTOMATIC' && !game.pausedAt;
}

function reviewEndsAt(game: AutomationGame, phase: AutomationPhase): number {
  return new Date(phase.updatedAt).valueOf() + game.reviewWindowMinutes * 60_000;
}

export function nextAutomaticStep(game: AutomationGame, phase: AutomationPhase | null, now: Date): AutomaticStep | null {
  if (!phase || !automationOn(game)) return null;
  const time = now.valueOf();
  if (phase.status === 'OPEN') {
    return new Date(phase.closesAt).valueOf() <= time ? { kind: 'LOCK_AND_PROPOSE', phaseId: phase.id } : null;
  }
  if (phase.status === 'LOCKED') return { kind: 'LOCK_AND_PROPOSE', phaseId: phase.id };
  if (phase.status === 'PENDING_HUNTER') {
    if (phase.hunterShotSaved) return { kind: 'FINALIZE_HUNTER', phaseId: phase.id, skipHunter: false };
    const deadline = phase.hunterDeadlineAt ? new Date(phase.hunterDeadlineAt).valueOf() : Number.POSITIVE_INFINITY;
    return deadline <= time ? { kind: 'FINALIZE_HUNTER', phaseId: phase.id, skipHunter: true } : null;
  }
  if (phase.status === 'PENDING_APPROVAL' && reviewEndsAt(game, phase) <= time) {
    return { kind: 'PUBLISH', phaseId: phase.id, reviewCutoff: new Date(time - game.reviewWindowMinutes * 60_000).toISOString() };
  }
  return null;
}

/** When the next automatic step will happen, for the console and the player's deadline card. */
export function automaticStepDueAt(game: AutomationGame, phase: AutomationPhase | null): { kind: AutomaticStep['kind']; at: string } | null {
  if (!phase || !automationOn(game)) return null;
  if (phase.status === 'OPEN') return { kind: 'LOCK_AND_PROPOSE', at: phase.closesAt };
  if (phase.status === 'PENDING_HUNTER' && phase.hunterDeadlineAt) return { kind: 'FINALIZE_HUNTER', at: phase.hunterDeadlineAt };
  if (phase.status === 'PENDING_APPROVAL') return { kind: 'PUBLISH', at: new Date(reviewEndsAt(game, phase)).toISOString() };
  return null;
}

export interface AutomationSettings {
  publicationMode: PublicationMode;
  reviewWindowMinutes: number;
}

/** New games start in review mode; a moderator opts a game in to automatic results. */
export const DEFAULT_NEW_GAME_AUTOMATION: AutomationSettings = { publicationMode: 'REVIEW', reviewWindowMinutes: 60 };

/** Validates the moderator's choice. A field left out keeps its current value. */
export function resolveAutomationSettings(
  input: { publicationMode?: unknown; reviewWindowMinutes?: unknown },
  current: AutomationSettings,
): { settings: AutomationSettings; errors: string[] } {
  const settings = { ...current };
  const errors: string[] = [];
  if (input.publicationMode !== undefined && input.publicationMode !== null) {
    if (input.publicationMode === 'REVIEW' || input.publicationMode === 'AUTOMATIC') settings.publicationMode = input.publicationMode;
    else errors.push('Choose automatic publication or moderator review.');
  }
  if (input.reviewWindowMinutes !== undefined && input.reviewWindowMinutes !== null) {
    const raw = input.reviewWindowMinutes;
    const minutes = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) errors.push('The review window must be a whole number of minutes from 0 to 1440.');
    else settings.reviewWindowMinutes = minutes;
  }
  return { settings, errors };
}
