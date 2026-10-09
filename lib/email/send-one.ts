import { isReservedTestAddress, readSmtpSettings } from './settings';
import { openMailer } from './smtp';

export type SendOneResult =
  | { status: 'SENT' }
  /** A reserved test address: it can never receive mail, so nothing is sent. */
  | { status: 'SKIPPED' }
  /** The site has no email settings. */
  | { status: 'UNAVAILABLE' }
  | { status: 'FAILED'; reason: string };

/** Sends one message over the site's SMTP account, for the few emails that go to one person at a moderator's request. */
export async function sendOneEmail(to: string, message: { subject: string; text: string }): Promise<SendOneResult> {
  const settings = readSmtpSettings();
  if (!settings) return { status: 'UNAVAILABLE' };
  if (isReservedTestAddress(to)) return { status: 'SKIPPED' };
  const mailer = openMailer(settings);
  try {
    const delivery = await mailer.send({ to, ...message });
    return delivery.ok ? { status: 'SENT' } : { status: 'FAILED', reason: delivery.reason };
  } finally {
    mailer.close();
  }
}
