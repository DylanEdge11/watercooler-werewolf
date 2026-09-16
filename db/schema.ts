import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { ActionKind, PhaseKind, RoleKey } from '../lib/game/types';

export type GameStatus =
  | 'DRAFT'
  | 'REGISTRATION'
  | 'ASSIGNMENT_PREVIEW'
  | 'ACTIVE'
  | 'FINAL_SHOWDOWN'
  | 'COMPLETED'
  | 'STOPPED'
  | 'CANCELLED'
  // These values are short-lived database claims. They are never a player-
  // facing lifecycle state, but make setup transitions race-safe.
  | 'COMPOSITION_SAVING'
  | 'ASSIGNMENT_PREVIEWING'
  | 'ROSTER_IMPORTING'
  | 'RESETTING'
  | 'RESTORING';
export type PhaseStatus =
  | 'SCHEDULED'
  | 'OPEN'
  | 'LOCKED'
  | 'PENDING_HUNTER'
  | 'PENDING_APPROVAL'
  | 'HUNTER_FINALIZING'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'SUPERSEDED';

export const moderatorAccounts = sqliteTable(
  'moderator_accounts',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    recoveryCodesJson: text('recovery_codes_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_moderator_accounts_email').on(table.email)],
);

export const moderatorSessions = sqliteTable(
  'moderator_sessions',
  {
    id: text('id').primaryKey(),
    moderatorId: text('moderator_id')
      .notNull()
      .references(() => moderatorAccounts.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_moderator_sessions_token').on(table.tokenHash),
    index('idx_moderator_sessions_owner').on(table.moderatorId, table.expiresAt),
  ],
);

export const games = sqliteTable(
  'games',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    status: text('status').$type<GameStatus>().notNull().default('DRAFT'),
    timezone: text('timezone').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    activeWeekdaysJson: text('active_weekdays_json').notNull(),
    scheduleJson: text('schedule_json').notNull(),
    dayDivisor: integer('day_divisor').notNull().default(30),
    nightDivisor: integer('night_divisor').notNull().default(30),
    hunterWindowMinutes: integer('hunter_window_minutes').notNull().default(60),
    finalRoundMinutes: integer('final_round_minutes').notNull().default(60),
    chatRetentionDays: integer('chat_retention_days').notNull().default(7),
    finalCutoffAt: text('final_cutoff_at').notNull(),
    publicationMode: text('publication_mode').$type<'REVIEW' | 'AUTOMATIC'>().notNull().default('REVIEW'),
    // Incremented whenever setup inputs change. Assignment previews capture
    // this value so an old preview cannot be released after a roster or
    // composition change.
    setupRevision: integer('setup_revision').notNull().default(1),
    stoppedAt: text('stopped_at'),
    stoppedByModeratorId: text('stopped_by_moderator_id').references(() => moderatorAccounts.id),
    stopReason: text('stop_reason'),
    resetAt: text('reset_at'),
    resetByModeratorId: text('reset_by_moderator_id').references(() => moderatorAccounts.id),
    createdByModeratorId: text('created_by_moderator_id')
      .notNull()
      .references(() => moderatorAccounts.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_games_status').on(table.status),
    index('idx_games_owner').on(table.createdByModeratorId, table.createdAt),
  ],
);

export const gameModerators = sqliteTable(
  'game_moderators',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    moderatorId: text('moderator_id')
      .notNull()
      .references(() => moderatorAccounts.id, { onDelete: 'cascade' }),
    role: text('role').$type<'OWNER' | 'CO_MODERATOR'>().notNull(),
    addedAt: text('added_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.moderatorId] }),
    index('idx_game_moderators_moderator').on(table.moderatorId),
  ],
);

export const seats = sqliteTable(
  'seats',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    email: text('email').notNull(),
    status: text('status')
      .$type<'INVITED' | 'CLAIMED' | 'REPLACED' | 'REMOVED'>()
      .notNull()
      .default('INVITED'),
    claimCodeHash: text('claim_code_hash').notNull(),
    pinHash: text('pin_hash'),
    sessionVersion: integer('session_version').notNull().default(1),
    alive: integer('alive', { mode: 'boolean' }).notNull().default(true),
    predecessorSeatId: text('predecessor_seat_id'),
    claimedAt: text('claimed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_seats_game_email').on(table.gameId, table.email),
    uniqueIndex('idx_seats_claim_code').on(table.claimCodeHash),
    index('idx_seats_game_status').on(table.gameId, table.status),
    index('idx_seats_game_alive').on(table.gameId, table.alive),
  ],
);

export const seatSessions = sqliteTable(
  'seat_sessions',
  {
    id: text('id').primaryKey(),
    seatId: text('seat_id')
      .notNull()
      .references(() => seats.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    sessionVersion: integer('session_version').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_seat_sessions_token').on(table.tokenHash),
    index('idx_seat_sessions_owner').on(table.seatId, table.expiresAt),
  ],
);

export const gameRoleCounts = sqliteTable(
  'game_role_counts',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    roleKey: text('role_key').$type<RoleKey>().notNull(),
    count: integer('count').notNull(),
    powerSnapshot: integer('power_snapshot').notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.roleKey] })],
);

export const assignmentBatches = sqliteTable(
  'assignment_batches',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    setupRevision: integer('setup_revision').notNull().default(1),
    rosterFingerprint: text('roster_fingerprint').notNull().default(''),
    compositionFingerprint: text('composition_fingerprint').notNull().default(''),
    assignmentsJson: text('assignments_json').notNull(),
    randomEvidenceHash: text('random_evidence_hash').notNull(),
    releasedAt: text('released_at'),
    createdByModeratorId: text('created_by_moderator_id')
      .notNull()
      .references(() => moderatorAccounts.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('idx_assignment_batches_revision').on(table.gameId, table.revision)],
);

export const roleAssignments = sqliteTable(
  'role_assignments',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    seatId: text('seat_id')
      .notNull()
      .references(() => seats.id, { onDelete: 'cascade' }),
    roleKey: text('role_key').$type<RoleKey>().notNull(),
    assignmentBatchId: text('assignment_batch_id')
      .notNull()
      .references(() => assignmentBatches.id),
    revealedAt: text('revealed_at'),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.seatId] }),
    index('idx_role_assignments_game_role').on(table.gameId, table.roleKey),
  ],
);

export const phases = sqliteTable(
  'phases',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    kind: text('kind').$type<PhaseKind>().notNull(),
    status: text('status').$type<PhaseStatus>().notNull().default('SCHEDULED'),
    opensAt: text('opens_at').notNull(),
    closesAt: text('closes_at').notNull(),
    slots: integer('slots').notNull(),
    divisorSnapshot: integer('divisor_snapshot').notNull(),
    hunterDeadlineAt: text('hunter_deadline_at'),
    version: integer('version').notNull().default(1),
    publishedAt: text('published_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_phases_game_sequence').on(table.gameId, table.sequence),
    index('idx_phases_due').on(table.status, table.closesAt),
    index('idx_phases_game_status').on(table.gameId, table.status),
  ],
);

export const actionSubmissions = sqliteTable(
  'action_submissions',
  {
    id: text('id').primaryKey(),
    phaseId: text('phase_id')
      .notNull()
      .references(() => phases.id, { onDelete: 'cascade' }),
    actorSeatId: text('actor_seat_id')
      .notNull()
      .references(() => seats.id),
    kind: text('kind').$type<ActionKind>().notNull(),
    targetIdsJson: text('target_ids_json').notNull(),
    version: integer('version').notNull(),
    submittedAt: text('submitted_at').notNull(),
    supersededAt: text('superseded_at'),
  },
  (table) => [
    uniqueIndex('idx_actions_revision').on(table.phaseId, table.actorSeatId, table.kind, table.version),
    index('idx_actions_current').on(table.phaseId, table.kind, table.supersededAt),
  ],
);

export const resolutionProposals = sqliteTable(
  'resolution_proposals',
  {
    id: text('id').primaryKey(),
    phaseId: text('phase_id')
      .notNull()
      .references(() => phases.id, { onDelete: 'cascade' }),
    inputHash: text('input_hash').notNull(),
    engineVersion: text('engine_version').notNull(),
    outcomeJson: text('outcome_json').notNull(),
    randomRollsJson: text('random_rolls_json').notNull(),
    status: text('status')
      .$type<'PROPOSED' | 'APPROVED' | 'OVERRIDDEN' | 'SUPERSEDED'>()
      .notNull()
      .default('PROPOSED'),
    overrideReason: text('override_reason'),
    overrideJson: text('override_json'),
    reviewedByModeratorId: text('reviewed_by_moderator_id').references(() => moderatorAccounts.id),
    reviewedAt: text('reviewed_at'),
    reviewedOutcomeJson: text('reviewed_outcome_json'),
    publishedOutcomeJson: text('published_outcome_json'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_resolution_phase_input').on(table.phaseId, table.inputHash),
    index('idx_resolution_phase_status').on(table.phaseId, table.status),
  ],
);

export const gameEvents = sqliteTable(
  'game_events',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    phaseId: text('phase_id').references(() => phases.id),
    eventType: text('event_type').notNull(),
    actorModeratorId: text('actor_moderator_id').references(() => moderatorAccounts.id),
    actorSeatId: text('actor_seat_id').references(() => seats.id),
    payloadJson: text('payload_json').notNull(),
    supersedesEventId: text('supersedes_event_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_game_events_timeline').on(table.gameId, table.createdAt),
    index('idx_game_events_phase').on(table.phaseId, table.createdAt),
  ],
);

export const chatRooms = sqliteTable(
  'chat_rooms',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    type: text('type').$type<'WEREWOLF' | 'MASON' | 'DEAD'>().notNull(),
    status: text('status').$type<'OPEN' | 'READ_ONLY' | 'PURGED'>().notNull().default('OPEN'),
    expiresAt: text('expires_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('idx_chat_rooms_game_type').on(table.gameId, table.type)],
);

export const chatRoomMembers = sqliteTable(
  'chat_room_members',
  {
    roomId: text('room_id')
      .notNull()
      .references(() => chatRooms.id, { onDelete: 'cascade' }),
    seatId: text('seat_id')
      .notNull()
      .references(() => seats.id, { onDelete: 'cascade' }),
    access: text('access').$type<'WRITE' | 'READ_ONLY' | 'REVOKED'>().notNull(),
    grantedAt: text('granted_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.seatId] }),
    index('idx_chat_members_seat').on(table.seatId, table.access),
  ],
);

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => chatRooms.id, { onDelete: 'cascade' }),
    authorSeatId: text('author_seat_id')
      .notNull()
      .references(() => seats.id),
    body: text('body'),
    deletedByModeratorId: text('deleted_by_moderator_id').references(() => moderatorAccounts.id),
    deletedAt: text('deleted_at'),
    purgedAt: text('purged_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_chat_messages_room_time').on(table.roomId, table.createdAt)],
);

export const announcements = sqliteTable(
  'announcements',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    moderatorId: text('moderator_id')
      .notNull()
      .references(() => moderatorAccounts.id),
    title: text('title').notNull(),
    body: text('body').notNull(),
    emailSubject: text('email_subject').notNull(),
    emailBody: text('email_body').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_announcements_game_time').on(table.gameId, table.createdAt)],
);

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    seatId: text('seat_id')
      .notNull()
      .references(() => seats.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    readAt: text('read_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_notifications_seat_unread').on(table.seatId, table.readAt, table.createdAt)],
);

export const backupExports = sqliteTable(
  'backup_exports',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    moderatorId: text('moderator_id')
      .notNull()
      .references(() => moderatorAccounts.id),
    schemaVersion: integer('schema_version').notNull(),
    checksum: text('checksum').notNull(),
    payloadJson: text('payload_json'),
    exportedAt: text('exported_at').notNull(),
  },
  (table) => [index('idx_backup_exports_game_time').on(table.gameId, table.exportedAt)],
);

export const operationalEvents = sqliteTable(
  'operational_events',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id').references(() => games.id, { onDelete: 'cascade' }),
    severity: text('severity').$type<'INFO' | 'WARNING' | 'ERROR'>().notNull(),
    source: text('source').notNull(),
    message: text('message').notNull(),
    detailsJson: text('details_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_operational_events_recent').on(table.severity, table.createdAt)],
);

export const pilotFeedback = sqliteTable(
  'pilot_feedback',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    respondentType: text('respondent_type').$type<'MODERATOR' | 'PLAYER'>().notNull(),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_pilot_feedback_game_time').on(table.gameId, table.createdAt)],
);

export const rateLimitBuckets = sqliteTable('rate_limit_buckets', {
  bucketKey: text('bucket_key').primaryKey(),
  windowStartedAt: text('window_started_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
});
