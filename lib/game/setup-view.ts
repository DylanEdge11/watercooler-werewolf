import { getDb } from '../../db';
import { readSmtpSettings } from '../email/settings';
import { loadSignupSummary } from '../roster/signup-store';
import { HttpError } from '../http/errors';
import type { PublicationMode } from './automation';
import { scoreComposition } from './balance';
import type { EliminationSchedule } from './elimination-schedule';
import { canonicalRoleKey, ROLE_KEYS, type RoleComposition, type RoleKey } from './types';

/**
 * The moderator console's view of one game's setup: its roster and its role
 * composition and assignment batches. The roster and assignments routes serve
 * these on their own; GET /api/games includes both for the selected game, so
 * the console needs one request instead of three.
 */

/** One game in the moderator's list, as GET /api/games sends it. */
export interface GameSummary {
  id: string;
  name: string;
  status: string;
  timezone: string;
  startDate: string;
  endDate: string;
  activeWeekdays: number[];
  schedule: { dayCloses?: string; nightCloses?: string };
  finalCutoffAt: string;
  /** The final cutoff as a datetime-local value in the game's timezone. */
  finalCutoffLocal: string;
  hunterWindowMinutes: number;
  dayDivisor: number;
  nightDivisor: number;
  eliminationSchedule: EliminationSchedule | null;
  publicationMode: PublicationMode;
  reviewWindowMinutes: number;
  automationPaused: boolean;
  moderatorRole: string;
}

/** A seat as the console's roster shows it. */
export interface RosterSeatView {
  id: string;
  displayName: string;
  email: string;
  status: string;
  claimedAt: string | null;
  invitationEmailedAt: string | null;
}

/** An assignment batch with its decoded assignments; `releasedAt` is null until the roles are released. */
export interface AssignmentBatchView {
  id: string;
  revision: number;
  setupRevision: number;
  rosterFingerprint: string;
  compositionFingerprint: string;
  randomEvidenceHash: string;
  releasedAt: string | null;
  createdAt: string;
  assignments: Array<{ seatId: string; role: RoleKey }>;
}

export async function loadComposition(gameId: string): Promise<RoleComposition> {
  const rows = await getDb()
    .prepare('SELECT role_key AS roleKey, count FROM game_role_counts WHERE game_id = ?')
    .bind(gameId)
    .all<{ roleKey: RoleKey; count: number }>();
  const composition = Object.fromEntries(ROLE_KEYS.map((role) => [role, 0])) as RoleComposition;
  for (const row of rows.results) composition[canonicalRoleKey(row.roleKey)] = Number(row.count);
  return composition;
}

export async function loadRosterView(gameId: string) {
  const db = getDb();
  // An emailed invitation counts only until the seat's link is replaced
  // again (by a later send, a reset, or a restore), which bumps updated_at.
  const [roster, composition, signups] = await Promise.all([
    db
      .prepare(
        `SELECT id, display_name AS displayName, email, status, claimed_at AS claimedAt,
                CASE WHEN status = 'INVITED' THEN (
                  SELECT MAX(e.created_at) FROM game_events e
                  WHERE e.game_id = seats.game_id AND e.event_type = 'INVITE_EMAILED'
                    AND json_extract(e.payload_json, '$.seatId') = seats.id
                    AND e.created_at >= seats.updated_at
                ) END AS invitationEmailedAt
         FROM seats WHERE game_id = ? AND status != 'REMOVED'
         ORDER BY display_name COLLATE NOCASE`,
      )
      .bind(gameId)
      .all<RosterSeatView>(),
    db
      .prepare(
        `SELECT role_key AS roleKey, count, power_snapshot AS powerSnapshot
         FROM game_role_counts WHERE game_id = ? ORDER BY role_key`,
      )
      .bind(gameId)
      .all<{ roleKey: string; count: number; powerSnapshot: number }>(),
    loadSignupSummary(gameId),
  ]);
  return {
    emailConfigured: readSmtpSettings() !== null,
    signups,
    roster: roster.results,
    composition: composition.results.map((row) => ({ ...row, roleKey: canonicalRoleKey(row.roleKey) })),
  };
}

export type RosterView = Awaited<ReturnType<typeof loadRosterView>>;

interface AssignmentRow {
  seatId: string;
  role: RoleKey;
}

export async function loadAssignmentsView(gameId: string) {
  const db = getDb();
  const [game, composition, roster, batches] = await Promise.all([
    db
      .prepare('SELECT status, setup_revision AS setupRevision FROM games WHERE id = ? LIMIT 1')
      .bind(gameId)
      .first<{ status: string; setupRevision: number }>(),
    loadComposition(gameId),
    db
      .prepare(
        `SELECT id, display_name AS displayName, status
         FROM seats WHERE game_id = ? AND status != 'REMOVED'
         ORDER BY display_name COLLATE NOCASE`,
      )
      .bind(gameId)
      .all<{ id: string; displayName: string; status: string }>(),
    db
      .prepare(
        `SELECT id, revision, setup_revision AS setupRevision,
                roster_fingerprint AS rosterFingerprint, composition_fingerprint AS compositionFingerprint,
                assignments_json AS assignmentsJson,
                random_evidence_hash AS randomEvidenceHash, released_at AS releasedAt, created_at AS createdAt
         FROM assignment_batches WHERE game_id = ? ORDER BY revision DESC`,
      )
      .bind(gameId)
      .all<Omit<AssignmentBatchView, 'assignments'> & { assignmentsJson: string }>(),
  ]);
  if (!game) throw new HttpError(404, 'Game not found.');
  return {
    game: { status: game.status, setupRevision: Number(game.setupRevision ?? 1) },
    composition,
    balance: scoreComposition(composition),
    roster: roster.results,
    batches: batches.results.map(({ assignmentsJson, ...batch }): AssignmentBatchView => ({
      ...batch,
      assignments: (JSON.parse(assignmentsJson) as AssignmentRow[]).map((assignment) => ({
        ...assignment,
        role: canonicalRoleKey(assignment.role),
      })),
    })),
  };
}

export type AssignmentsView = Awaited<ReturnType<typeof loadAssignmentsView>>;

/** The selected game's setup, as GET /api/games sends it beside the games list. */
export interface SelectedGameSetup {
  gameId: string;
  roster: RosterView;
  assignments: AssignmentsView;
}
