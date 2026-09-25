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
    eliminations?: Array<{ displayName: string; role: string; cause: string }>;
    votes?: Array<{ actorName: string; targetNames: string[] }>;
    protectedAttackBlocked?: boolean;
  };
}

export interface TimelineEntryView {
  /** Short label above the headline, e.g. "Day · Cycle 3". */
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
    return {
      eyebrow: 'Campaign complete',
      title: `${payload.winner} wins`,
      description: 'The campaign is complete. Review the official timeline and your private results.',
      headline: `${payload.winner ? readableRole(payload.winner) : 'A team'} wins`,
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
    eyebrow: `${phaseLabel(payload.kind)}${payload.sequence ? ` · Cycle ${payload.sequence}` : ''}`,
    title: `${payload.kind}${payload.sequence ? ` · Cycle ${payload.sequence}` : ''} resolved`,
    description,
    headline,
    tone: 'phase',
    publicBallot: ['DAY', 'FINAL_BALLOT'].includes(payload.kind ?? ''),
  };
}

/** Votes per target, most first; ties keep name order. */
export function tallyVotes(votes: Array<{ targetNames: string[] }>): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const vote of votes) for (const name of vote.targetNames) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
