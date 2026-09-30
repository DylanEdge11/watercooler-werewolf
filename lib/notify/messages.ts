import { formatDeadlineForChat } from '../game/moderator-copy';
import { cycleNumber } from '../game/timeline-view';
import type { PhaseKind } from '../game/types';

export interface OutgoingNotification {
  subject: string;
  text: string;
  /** Sent as List-Unsubscribe headers so mail apps can offer their own unsubscribe button. */
  unsubscribeUrl: string;
}

interface Recipient {
  displayName: string;
  unsubscribeToken: string;
}

interface PhaseFacts {
  gameName: string;
  kind: PhaseKind;
  sequence: number;
  closesAt: string;
  timeZone: string;
}

/** "Day 3", "Night 2", or "The final ballot". */
export function phaseName(kind: PhaseKind, sequence: number): string {
  if (kind === 'FINAL_BALLOT') return 'The final ballot';
  return `${kind === 'NIGHT' ? 'Night' : 'Day'} ${cycleNumber(sequence)}`;
}

/** The page a player lands on to turn email off. It shows a button; opening it changes nothing. */
export function unsubscribePageUrl(origin: string, token: string): string {
  return `${origin}/email/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** The address a mail app posts to for its one-click unsubscribe. */
export function unsubscribePostUrl(origin: string, token: string): string {
  return `${origin}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
}

function footer(origin: string, recipient: Recipient): string {
  return `You get these emails because you turned them on in Watercooler Werewolf. Turn them off here: ${unsubscribePageUrl(origin, recipient.unsubscribeToken)}`;
}

function build(origin: string, recipient: Recipient, subject: string, paragraphs: string[]): OutgoingNotification {
  return {
    subject,
    text: `${[`Hi ${recipient.displayName},`, ...paragraphs, footer(origin, recipient)].join('\n\n')}\n`,
    unsubscribeUrl: unsubscribePostUrl(origin, recipient.unsubscribeToken),
  };
}

/*
 * Wording rules for every email below. They go to a person's inbox, where a
 * preview can be seen by others and the message can be forwarded, so none names
 * a role or a private result, and none says what kind of action is due. A phase
 * email goes only to players with something to do; that is all it can tell them.
 */

/** A phase opened and this player has something to do. */
export function phaseOpenedMessage(origin: string, recipient: Recipient, phase: PhaseFacts): OutgoingNotification {
  const name = phaseName(phase.kind, phase.sequence);
  const deadline = `${formatDeadlineForChat(phase.closesAt, phase.timeZone)} (${phase.timeZone})`;
  return build(origin, recipient, `${phase.gameName}: ${name} is open`, [
    `${name} is open in ${phase.gameName}, and you have something to do before ${deadline}.`,
    `Open the game: ${origin}`,
  ]);
}

/** Thirty minutes to go and this player has not saved their move. */
export function closingSoonMessage(origin: string, recipient: Recipient, phase: PhaseFacts): OutgoingNotification {
  const name = phaseName(phase.kind, phase.sequence);
  const deadline = `${formatDeadlineForChat(phase.closesAt, phase.timeZone)} (${phase.timeZone})`;
  return build(origin, recipient, `${phase.gameName}: ${name} closes soon`, [
    `${name} closes at ${deadline} and you have not saved your move yet.`,
    `Save it now: ${origin}`,
  ]);
}

/** A result was published. The story is the public recap; the full result stays in the game. */
export function resultPublishedMessage(origin: string, recipient: Recipient, phase: Pick<PhaseFacts, 'gameName' | 'kind' | 'sequence'>, story: string): OutgoingNotification {
  const name = phase.kind === 'FINAL_BALLOT' ? 'final ballot' : phaseName(phase.kind, phase.sequence);
  return build(origin, recipient, `${phase.gameName}: the ${name} result is in`, [
    story,
    `See the full result and what happens next: ${origin}`,
  ]);
}
