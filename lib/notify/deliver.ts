import { getDb } from '../../db';
import { isReservedTestAddress, readSmtpSettings } from '../email/settings';
import { openMailer } from '../email/smtp';
import type { OutgoingNotification } from './messages';

export interface Recipient {
  seatId: string;
  displayName: string;
  email: string;
  unsubscribeToken: string;
}

export interface DeliveryReport {
  sent: number;
  failed: number;
  /** Addresses on reserved test domains, which can never receive mail. */
  skipped: number;
}

/** The pooled mailer opens at most this many connections, so send that many at a time. */
const CONCURRENT_SENDS = 3;

/**
 * Sends one notification to each recipient and leaves a line for the moderator in the
 * Operations panel. It never throws: a mail problem must not fail a game action, and
 * the caller has already finished its own work by now.
 */
export async function deliver(input: {
  gameId: string;
  /** Unique per phase and kind, so a repeated call cannot write a second summary. */
  eventId: string;
  label: string;
  recipients: Recipient[];
  compose: (recipient: Recipient) => OutgoingNotification;
  details?: Record<string, unknown>;
}): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: 0, failed: 0, skipped: 0 };
  try {
    const settings = readSmtpSettings();
    if (!settings || !input.recipients.length) return report;
    const deliverable = input.recipients.filter((recipient) => {
      const reserved = isReservedTestAddress(recipient.email);
      if (reserved) report.skipped += 1;
      return !reserved;
    });
    if (!deliverable.length) return report;
    const mailer = openMailer(settings);
    try {
      for (let start = 0; start < deliverable.length; start += CONCURRENT_SENDS) {
        const results = await Promise.all(deliverable.slice(start, start + CONCURRENT_SENDS).map((recipient) => {
          const message = input.compose(recipient);
          return mailer.send({
            to: recipient.email,
            subject: message.subject,
            text: message.text,
            headers: { 'List-Unsubscribe': `<${message.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
          });
        }));
        for (const result of results) {
          if (result.ok) report.sent += 1;
          else report.failed += 1;
        }
      }
    } finally {
      mailer.close();
    }
    await record(input, report);
  } catch (error) {
    console.error('Email delivery batch failed', { name: error instanceof Error ? error.name : 'Error' });
  }
  return report;
}

async function record(input: { gameId: string; eventId: string; label: string; details?: Record<string, unknown> }, report: DeliveryReport): Promise<void> {
  const failed = report.failed > 0;
  const message = failed
    ? `${input.label}: ${report.failed} of ${report.sent + report.failed} emails could not be delivered. Check the email settings.`
    : `${input.label}: emailed ${report.sent} ${report.sent === 1 ? 'player' : 'players'}.`;
  await getDb()
    .prepare(
      `INSERT OR IGNORE INTO operational_events (id, game_id, severity, source, message, details_json, created_at)
       VALUES (?, ?, ?, 'EMAIL', ?, ?, ?)`,
    )
    .bind(`email-${input.eventId}`, input.gameId, failed ? 'WARNING' : 'INFO', message, JSON.stringify({ ...input.details, ...report }), new Date().toISOString())
    .run();
}
