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
    /** Day and Final ballots only: per-target totals exactly as the engine counted them. */
    voteTotals?: VoteTotal[];
  };
}

export interface VoteTotal {
  name: string;
  votes: number;
}

/** Shown wherever public vote totals appear, whether or not the game has a Mayor. */
export const MAYOR_TOTALS_NOTE = 'The Mayor’s vote counts twice, so totals can be higher than the number of voters.';

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
  // A Bodyguard save is never announced: a blocked attack reads exactly like a quiet night.
  const description = eliminations.length
    ? eliminations.map((item) => `${item.displayName} · ${readableRole(item.role)}${item.cause === 'LOVER_BOND' ? ' · lover bond' : item.cause === 'HUNTER_SHOT' ? ' · Hunter shot' : ''}`).join(', ')
    : 'No one was eliminated.';
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

/**
 * Public per-target totals for a published Day or Final ballot. They come from
 * the engine's own tally in the published outcome, so a living Mayor's vote
 * counts twice exactly as it did when the result was decided. Night tallies
 * are private and never returned.
 */
export function publicVoteTotals(
  kind: unknown,
  outcome: unknown,
  displayNameById: ReadonlyMap<string, string>,
): VoteTotal[] | undefined {
  if (kind !== 'DAY' && kind !== 'FINAL_BALLOT') return undefined;
  const tally = outcome && typeof outcome === 'object' ? (outcome as { tally?: unknown }).tally : undefined;
  if (!Array.isArray(tally)) return [];
  const totals: VoteTotal[] = [];
  for (const entry of tally) {
    if (!entry || typeof entry !== 'object') continue;
    const { playerId, votes } = entry as { playerId?: unknown; votes?: unknown };
    const name = typeof playerId === 'string' ? displayNameById.get(playerId) : undefined;
    if (!name || typeof votes !== 'number' || !Number.isFinite(votes) || votes <= 0) continue;
    totals.push({ name, votes });
  }
  return totals.sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
}
