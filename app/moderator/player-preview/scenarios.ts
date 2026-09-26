import type { PublicTimelineEvent } from '../../../lib/game/timeline-view';
import { permissionForRole } from '../../../lib/game/actions';
import { ROLE_CATALOG } from '../../../lib/game/catalog';
import type { DashboardData } from '../../player-dashboard';
import type { RoleKey } from '../../../lib/game/types';

export const PREVIEW_SCENARIOS = [
  { id: 'day-ballot', label: 'Day ballot' },
  { id: 'day-submitted', label: 'Day ballot · response submitted' },
  { id: 'night-action', label: 'Night action' },
  { id: 'hunter-follow-up', label: 'Hunter follow-up' },
  { id: 'moderator-review', label: 'Moderator reviewing outcome' },
  { id: 'final-ballot', label: 'Final showdown ballot' },
  { id: 'between-phases', label: 'Between phases' },
  { id: 'eliminated', label: 'Eliminated spectator' },
  { id: 'completed', label: 'Campaign completed' },
  { id: 'stopped', label: 'Campaign stopped' },
  { id: 'unreleased', label: 'Roles not released' },
] as const;

export type PreviewScenarioId = (typeof PREVIEW_SCENARIOS)[number]['id'];

const candidates = [
  { id: 'preview-casey', displayName: 'Casey Rivera' },
  { id: 'preview-morgan', displayName: 'Morgan Lee' },
  { id: 'preview-jamie', displayName: 'Jamie Park' },
  { id: 'preview-taylor', displayName: 'Taylor Reed' },
  { id: 'preview-riley', displayName: 'Riley Chen' },
  { id: 'preview-jordan', displayName: 'Jordan Blake' },
  { id: 'preview-quinn', displayName: 'Quinn Patel' },
  { id: 'preview-avery', displayName: 'Avery Brooks' },
  { id: 'preview-sam', displayName: 'Sam Wilson' },
  { id: 'preview-drew', displayName: 'Drew Campbell' },
  { id: 'preview-reese', displayName: 'Reese Kim' },
  { id: 'preview-blake', displayName: 'Blake Murphy' },
  { id: 'preview-jules', displayName: 'Jules Bennett' },
  { id: 'preview-parker', displayName: 'Parker Singh' },
];

function makeTimeline(now: Date, scenario: PreviewScenarioId): DashboardData['timeline'] {
  if (scenario === 'unreleased') return [];
  const publishedAt = new Date(now.valueOf() - 5 * 60 * 60_000).toISOString();
  const isDay = scenario === 'day-ballot' || scenario === 'day-submitted';
  return [
    {
      id: 'preview-event-day',
      eventType: scenario === 'completed' ? 'GAME_COMPLETED' : scenario === 'stopped' ? 'GAME_STOPPED' : 'PHASE_PUBLISHED',
      createdAt: publishedAt,
      payload: {
        kind: isDay ? 'DAY' : 'NIGHT',
        phaseId: 'preview-published-phase',
        sequence: 3,
        winner: scenario === 'completed' ? 'VILLAGE' : null,
        eliminations: [{ displayName: 'Jordan Blake', role: 'WEREWOLF', cause: 'DAY_VOTE' }],
        votes: [
          { actorName: 'Casey Rivera', targetNames: ['Jordan Blake'] },
          { actorName: 'Morgan Lee', targetNames: ['Jordan Blake'] },
          { actorName: 'Taylor Reed', targetNames: ['Riley Chen'] },
        ],
        protectedAttackBlocked: scenario === 'night-action',
      },
    },
    {
      id: 'preview-event-announcement',
      eventType: 'ANNOUNCEMENT',
      createdAt: new Date(now.valueOf() - 2 * 60 * 60_000).toISOString(),
      payload: { title: 'A note from the moderator', body: 'The next response window is open for review.' },
    },
  ];
}

export function createPreviewData(roleKey: RoleKey, scenario: PreviewScenarioId): DashboardData {
  const now = new Date();
  const deadline = new Date(now.valueOf() + 3 * 60 * 60_000).toISOString();
  const isEliminated = scenario === 'eliminated' || (scenario === 'hunter-follow-up' && roleKey === 'HUNTER');
  const isUnreleased = scenario === 'unreleased';
  const isBallot = scenario === 'day-ballot' || scenario === 'day-submitted';
  const isNight = scenario === 'night-action';
  const isHunter = scenario === 'hunter-follow-up';
  const isReview = scenario === 'moderator-review';
  const isFinal = scenario === 'final-ballot';
  const isClosed = scenario === 'completed' || scenario === 'stopped';

  let phase: DashboardData['phase'] = null;
  if (isBallot) phase = { id: 'preview-phase-day', sequence: 4, kind: 'DAY', status: 'OPEN', slots: 1, deadline };
  else if (isNight || isHunter || isReview) {
    phase = {
      id: 'preview-phase-night', sequence: 5, kind: 'NIGHT',
      status: isHunter ? 'PENDING_HUNTER' : isReview ? 'PENDING_APPROVAL' : 'OPEN',
      slots: 1, deadline: isReview ? null : deadline,
    };
  } else if (isFinal) phase = { id: 'preview-phase-final', sequence: 6, kind: 'FINAL_BALLOT', status: 'OPEN', slots: 2, deadline };

  const permission: DashboardData['permission'] = phase && (!isEliminated || (isHunter && roleKey === 'HUNTER')) && !isUnreleased && !isReview
    ? permissionForRole(roleKey, phase.kind, phase.slots, isHunter, { seerAlive: false, cupidPairExists: false })
    : {
      actionKind: null,
      maxTargets: 0,
      label: isReview ? 'The moderator is reviewing the outcome.'
        : isEliminated ? 'You have been eliminated and can spectate the campaign.'
          : isUnreleased ? 'Your role will appear here when the moderator releases assignments.'
            : scenario === 'completed' ? 'The campaign has ended.'
              : scenario === 'stopped' ? 'The moderator has stopped this campaign.'
                : 'The next phase has not opened yet.',
    };

  const player = { id: 'preview-player', displayName: 'Alex Morgan' };
  const actionCandidates = roleKey === 'CUPID' ? [player, ...candidates] : candidates;
  const livingPlayers = isEliminated ? candidates : [player, ...candidates];
  const roomStatus = isClosed ? 'CLOSED' : 'OPEN';
  const roomAccess = isClosed ? 'READ' : 'WRITE';
  const rooms: DashboardData['rooms'] = isUnreleased
    ? []
    : scenario === 'eliminated'
      ? [{ id: 'preview-room-dead', type: 'DEAD', status: 'OPEN', access: 'READ' }]
      : !isEliminated && roleKey === 'WEREWOLF'
        ? [{ id: 'preview-room-werewolf', type: 'WEREWOLF', status: roomStatus, access: roomAccess }]
        : !isEliminated && roleKey === 'MASON'
          ? [{ id: 'preview-room-mason', type: 'MASON', status: roomStatus, access: roomAccess }]
          : [];

  const currentAction = scenario === 'day-submitted'
    ? { targetIds: [candidates[0].id], version: 2, submittedAt: new Date(now.valueOf() - 12 * 60_000).toISOString() }
    : null;
  const notifications: DashboardData['notifications'] = isUnreleased
    ? []
    : roleKey === 'SEER' || roleKey === 'APPRENTICE_SEER'
      ? [{ id: 'preview-seer-result', type: 'INVESTIGATION_RESULT', title: 'Your investigation', body: 'Morgan Lee is a Werewolf.', createdAt: new Date(now.valueOf() - 2 * 60 * 60_000).toISOString() }]
      : roleKey === 'CUPID'
        ? [{ id: 'preview-cupid-result', type: 'LOVER_BOND', title: 'Your bond is known', body: 'Casey Rivera and Morgan Lee are linked as lovers.', createdAt: new Date(now.valueOf() - 2 * 60 * 60_000).toISOString() }]
        : [{ id: 'preview-announcement', type: 'ANNOUNCEMENT', title: 'A note from the moderator', body: 'The next update will arrive after this response window closes.', createdAt: new Date(now.valueOf() - 45 * 60_000).toISOString() }];

  const gameStatus = scenario === 'completed' ? 'COMPLETED'
    : scenario === 'stopped' ? 'STOPPED'
      : isFinal ? 'FINAL_SHOWDOWN'
        : isUnreleased ? 'DRAFT' : 'ACTIVE';

  return {
    player: {
      id: 'preview-player',
      displayName: 'Alex Morgan',
      alive: !isEliminated,
      role: isUnreleased ? null : roleKey,
      roleDefinition: isUnreleased ? null : ROLE_CATALOG[roleKey],
      teammates: isEliminated || isUnreleased ? []
        : roleKey === 'WEREWOLF' ? [{ id: 'preview-pack-morgan', displayName: 'Morgan Lee', alive: true }, { id: 'preview-pack-jordan', displayName: 'Jordan Blake', alive: false }]
          : roleKey === 'MASON' ? [{ id: 'preview-mason-casey', displayName: 'Casey Rivera', alive: true }, { id: 'preview-mason-riley', displayName: 'Riley Chen', alive: true }]
            : [],
    },
    game: {
      id: 'preview-game',
      name: 'Studio Sample Campaign',
      status: gameStatus,
      timezone: 'America/Regina',
      counts: {
        total: isUnreleased ? candidates.length + 1 : 20,
        living: isUnreleased ? candidates.length + 1 : isEliminated ? 14 : 15,
        werewolvesRemaining: isUnreleased ? 0 : 3,
      },
      livingPlayers: livingPlayers.map(({ id, displayName }) => ({ id, displayName })),
      eliminatedPlayers: isUnreleased ? [] : [
        { id: 'preview-eliminated-jordan', displayName: 'Jordan Blake', role: 'WEREWOLF' },
        { id: 'preview-eliminated-riley', displayName: 'Riley Chen', role: 'VILLAGER' },
      ],
      stopReason: scenario === 'stopped' ? 'The moderator paused this sample campaign for review.' : null,
    },
    phase,
    permission,
    candidates: actionCandidates,
    currentAction,
    participation: isUnreleased
      ? { submitted: 0, eligible: 0 }
      : { submitted: currentAction ? 9 : 8, eligible: isFinal ? 6 : 15 },
    timeline: makeTimeline(now, scenario),
    notifications,
    notificationsHasMore: false,
    notificationsNextCursor: null,
    rooms,
  };
}

export const PREVIEW_ELIMINATIONS = [
  { id: 'night-attack', label: 'Night · pack attack' },
  { id: 'day-vote', label: 'Day · village vote' },
  { id: 'hunter-shot', label: 'Day · vote and Hunter shot' },
  { id: 'lovers', label: 'Night · attack and lover bond' },
  { id: 'you', label: 'You are eliminated' },
] as const;

export type PreviewEliminationId = (typeof PREVIEW_ELIMINATIONS)[number]['id'];

/** A synthetic published phase for replaying the elimination announcement. */
export function createPreviewElimination(scene: PreviewEliminationId, roleKey: RoleKey): PublicTimelineEvent {
  const night = scene === 'night-attack' || scene === 'lovers';
  const eliminations = {
    'night-attack': [{ displayName: 'Jordan Blake', role: 'SEER', cause: 'WEREWOLF_ATTACK' }],
    'day-vote': [{ displayName: 'Casey Rivera', role: 'WEREWOLF', cause: 'DAY_VOTE' }],
    'hunter-shot': [
      { displayName: 'Taylor Reed', role: 'HUNTER', cause: 'DAY_VOTE' },
      { displayName: 'Riley Chen', role: 'WEREWOLF', cause: 'HUNTER_SHOT' },
    ],
    lovers: [
      { displayName: 'Morgan Lee', role: 'MASON', cause: 'WEREWOLF_ATTACK' },
      { displayName: 'Jamie Park', role: 'CUPID', cause: 'LOVER_BOND' },
    ],
    you: [{ displayName: 'Alex Morgan', role: roleKey, cause: 'DAY_VOTE', isYou: true }],
  }[scene];
  return {
    id: `preview-elimination-${scene}`,
    eventType: 'PHASE_PUBLISHED',
    createdAt: new Date().toISOString(),
    payload: { kind: night ? 'NIGHT' : 'DAY', sequence: 4, eliminations },
  };
}
