import type { PhaseKind } from './types';

/** "Friday 09:00" in the game's timezone. */
export function formatDeadlineForChat(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('weekday')} ${part('hour')}:${part('minute')}`;
}

/**
 * A reminder that is safe to paste into the office group chat. A Day or Final
 * ballot may name who has not voted, since every living player votes. A Night
 * never names or counts anyone, because that would reveal who holds a Night role.
 */
export function nudgeMessage(input: {
  kind: PhaseKind;
  sequence: number;
  closesAt: string;
  timeZone: string;
  outstandingNames: string[];
  siteUrl: string;
}): string {
  const when = formatDeadlineForChat(input.closesAt, input.timeZone);
  if (input.kind === 'NIGHT') {
    return `Night ${input.sequence} closes ${when} (${input.timeZone}). If your role has a night action, save it before ${when} at ${input.siteUrl}`;
  }
  const heading = input.kind === 'FINAL_BALLOT' ? 'Final ballot closes' : `Day ${input.sequence} ballot closes`;
  const names = input.outstandingNames;
  return names.length
    ? `${heading} ${when} (${input.timeZone}). Still to vote: ${names.join(', ')}. Save your vote at ${input.siteUrl}`
    : `${heading} ${when} (${input.timeZone}). Everyone has voted; you can still change your vote at ${input.siteUrl}`;
}

export function announcementEmailCopy(input: { emailSubject: string; emailBody: string }): string {
  return `Subject: ${input.emailSubject}\n\n${input.emailBody}`;
}

/** Bold title in the *asterisk* style Slack and WhatsApp use, then the body and the site link. */
export function announcementChatCopy(input: { title: string; body: string }, siteUrl: string): string {
  return `*${input.title}*\n${input.body}\n\n${siteUrl}`;
}
