import type { RoleComposition } from '@/lib/game/types';

/** The statuses in which the schedule, roster, and roles can still change. */
export const SETUP_STATUSES = new Set(['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW']);

export type Composition = RoleComposition;

/** A private invitation link, shown once and kept only in memory for the invite file. */
export interface InviteRow {
  displayName: string;
  email: string;
  claimUrl: string;
  inviteCode: string;
}

/** What the roster routes answer after a seat is added or removed. */
export interface RosterChange {
  playerCount: number;
  composition: Composition;
  resetToPreset: boolean;
}

export interface InviteEmailResult {
  seatId: string;
  displayName: string;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  reason?: string;
}

/** The private link of the player the moderator just added by hand, shown until they leave the game. */
export interface AddedInvite {
  gameId: string;
  seatId: string;
  displayName: string;
  claimUrl: string;
}
