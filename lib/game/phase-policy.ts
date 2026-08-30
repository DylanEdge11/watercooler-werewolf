import type { PhaseKind } from './types';

export interface PhaseSequenceEntry {
  kind: PhaseKind;
  status: string;
  winner?: string | null;
}

export interface PhaseOpenPolicyInput {
  gameStatus: string;
  latestPhase: PhaseSequenceEntry | null;
  requestedKind: PhaseKind;
}

export function validatePhaseOpen(input: PhaseOpenPolicyInput): string | null {
  if (input.gameStatus === 'STOPPED') return 'This game is stopped. Reset it before starting another phase.';
  if (input.gameStatus === 'COMPLETED') return 'This game is already complete.';
  if (input.gameStatus === 'FINAL_SHOWDOWN') {
    if (input.requestedKind !== 'FINAL_BALLOT') {
      return 'Final showdown accepts only a final ballot.';
    }
    if (input.latestPhase && input.latestPhase.status !== 'PUBLISHED') {
      return 'Finish the current final ballot before opening another one.';
    }
    if (input.latestPhase?.kind === 'FINAL_BALLOT' && input.latestPhase.winner) {
      return 'The final ballot already produced a winner.';
    }
    return null;
  }
  if (input.gameStatus !== 'ACTIVE') return 'Release roles before opening a phase.';
  if (input.requestedKind === 'FINAL_BALLOT') {
    return 'Enter final showdown before opening the final ballot.';
  }
  if (!input.latestPhase) {
    return input.requestedKind === 'DAY' ? null : 'The first phase must be a Day ballot.';
  }
  if (input.latestPhase.status !== 'PUBLISHED') return 'Finish the current phase before opening another.';
  const expected = input.latestPhase.kind === 'DAY' ? 'NIGHT' : input.latestPhase.kind === 'NIGHT' ? 'DAY' : null;
  return expected === input.requestedKind
    ? null
    : `Phases must alternate. The next phase must be ${expected ?? 'a regular phase'}.`;
}

export interface FinalShowdownPolicyInput {
  gameStatus: string;
  latestPhase: PhaseSequenceEntry | null;
  finalCutoffAt: string;
  now: Date;
}

export function validateFinalShowdownEntry(input: FinalShowdownPolicyInput): string | null {
  if (input.gameStatus === 'FINAL_SHOWDOWN') return null;
  if (input.gameStatus !== 'ACTIVE') return 'Only an active game can enter final showdown.';
  if (!input.latestPhase || input.latestPhase.status !== 'PUBLISHED') {
    return 'Publish the current Day or Night phase before entering final showdown.';
  }
  if (input.latestPhase.kind === 'FINAL_BALLOT') return 'The final ballot is already in progress.';
  const cutoff = new Date(input.finalCutoffAt);
  if (Number.isNaN(cutoff.valueOf())) return 'The game final cutoff is invalid.';
  if (input.now < cutoff) return 'Final showdown cannot begin before the final cutoff.';
  return null;
}
