/**
 * Wording for the player's official timeline. Every field here already
 * reaches players through GET /api/player; this module only phrases it, so
 * the rail summary and the full Timeline view say the same thing.
 */
export interface PublicTimelineEvent {
  id: string;
  eventType: string;
  createdAt: string;
  payload: {
    kind?: string;
    phaseId?: string | null;
    sequence?: number | null;
    title?: string;
    body?: string;
    winner?: string | null;
    eliminations?: Array<{ displayName: string; role: string; cause: string; isYou?: boolean }>;
    votes?: Array<{ actorName: string; targetNames: string[] }>;
    protectedAttackBlocked?: boolean;
    /** Published by the sweep after the review window rather than by a moderator. */
    publishedAutomatically?: boolean;
  };
}

export interface TimelineEntryView {
  /** Short label above the headline, e.g. "Day 2" or "Final ballot". */
  eyebrow: string;
  /** One-line summary used in the rail. */
  title: string;
  description: string;
  /** Headline for the full Timeline view. */
  headline: string;
  tone: 'phase' | 'announcement' | 'milestone';
  /** Day and Final ballots publish who voted for whom. */
  publicBallot: boolean;
}

export function readableRole(role: string | null): string {
  return role
    ? role.toLowerCase().split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    : 'Role unavailable';
}

export function eliminationCause(cause: string): string {
  if (cause === 'LOVER_BOND') return 'lover bond';
  if (cause === 'HUNTER_SHOT') return 'Hunter shot';
  if (cause === 'WEREWOLF_ATTACK') return 'pack attack';
  if (cause === 'DAY_VOTE') return 'village vote';
  return '';
}

function phaseLabel(kind: string | undefined): string {
  if (kind === 'DAY') return 'Day';
  if (kind === 'NIGHT') return 'Night';
  if (kind === 'FINAL_BALLOT') return 'Final ballot';
  return kind ? readableRole(kind) : 'Phase';
}

/**
 * Phases are numbered one by one (Day 1 is 1, Night 1 is 2, Day 2 is 3), and
 * the game always starts with a Day and alternates, so a Day and the Night
 * after it share one cycle number.
 */
export function cycleNumber(sequence: number): number {
  return Math.max(1, Math.ceil(sequence / 2));
}

/**
 * The cycle the game is in: the open phase's, or between phases the latest
 * published one's (the timeline is newest first and always keeps it). 0
 * before the first phase.
 */
export function currentCycle(openPhaseSequence: number | null | undefined, timeline: PublicTimelineEvent[]): number {
  const sequence = openPhaseSequence
    ?? timeline.find((event) => event.eventType === 'PHASE_PUBLISHED' && event.payload.sequence)?.payload.sequence;
  return sequence ? cycleNumber(sequence) : 0;
}

/** "Day 2", "Night 2", or "Final ballot": the one name players and moderators see for a phase. */
export function phaseName(kind: string | undefined, sequence?: number | null): string {
  if ((kind === 'DAY' || kind === 'NIGHT') && sequence) return `${phaseLabel(kind)} ${cycleNumber(sequence)}`;
  return phaseLabel(kind);
}

export function describeTimelineEvent(event: PublicTimelineEvent): TimelineEntryView {
  const { payload } = event;
  if (event.eventType === 'ANNOUNCEMENT') {
    return {
      eyebrow: 'Moderator announcement',
      title: payload.title ?? 'Announcement',
      description: payload.body ?? '',
      headline: payload.title ?? 'Announcement',
      tone: 'announcement',
      publicBallot: false,
    };
  }
  if (event.eventType === 'GAME_COMPLETED') {
    const winner = `${payload.winner ? readableRole(payload.winner) : 'A team'} wins`;
    return {
      eyebrow: 'Campaign complete',
      title: winner,
      description: 'The campaign is complete. Review the official timeline and your private results.',
      headline: winner,
      tone: 'milestone',
      publicBallot: false,
    };
  }
  if (event.eventType === 'GAME_STOPPED') {
    return {
      eyebrow: 'Campaign stopped',
      title: 'Campaign stopped',
      description: 'Player actions are blocked and rooms are read-only.',
      headline: 'The moderator stopped the campaign',
      tone: 'milestone',
      publicBallot: false,
    };
  }
  if (event.eventType === 'FINAL_SHOWDOWN_ENTERED') {
    return {
      eyebrow: 'Final showdown',
      title: 'Final showdown entered',
      description: 'The final ballot is now the only legal phase.',
      headline: 'The final showdown begins',
      tone: 'milestone',
      publicBallot: false,
    };
  }

  const eliminations = payload.eliminations ?? [];
  const description = eliminations.length
    ? `${eliminations.map((item) => `${item.displayName} · ${readableRole(item.role)}${item.cause === 'LOVER_BOND' ? ' · lover bond' : item.cause === 'HUNTER_SHOT' ? ' · Hunter shot' : ''}`).join(', ')}${payload.protectedAttackBlocked ? ' · Bodyguard protection stopped a pack attack.' : ''}`
    : payload.protectedAttackBlocked
      ? 'Bodyguard protection stopped a pack attack. No one died.'
      : 'No elimination published.';
  const names = eliminations.map((item) => item.displayName);
  const headline = names.length === 0
    ? 'No one was eliminated'
    : `${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`} eliminated`;
  return {
    eyebrow: phaseName(payload.kind, payload.sequence),
    title: `${phaseName(payload.kind, payload.sequence)} resolved`,
    description,
    headline,
    tone: 'phase',
    publicBallot: ['DAY', 'FINAL_BALLOT'].includes(payload.kind ?? ''),
  };
}
