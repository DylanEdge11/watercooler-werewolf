import nodemailer from 'nodemailer';
import type { SmtpSettings } from './settings';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  /** Extra message headers, such as List-Unsubscribe. */
  headers?: Record<string, string>;
}

export type DeliveryResult = { ok: true } | { ok: false; reason: string };

export interface Mailer {
  /** Signs in to the mail server without sending anything. */
  verify(): Promise<DeliveryResult>;
  send(email: OutgoingEmail): Promise<DeliveryResult>;
  close(): void;
}

// Provider errors can echo server responses; keep the moderator-facing text
// generic, and log only the code and message (never the transport options).
function describeFailure(context: string, error: unknown): string {
  const { code, responseCode, message } = (error ?? {}) as { code?: string; responseCode?: number; message?: string };
  console.error(context, { code, responseCode, message });
  if (code === 'EAUTH') return 'The email account rejected the sign-in. Check SMTP_USER and SMTP_PASSWORD.';
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'EDNS') {
    return 'The email server could not be reached. Check SMTP_HOST and SMTP_PORT.';
  }
  if (code === 'EENVELOPE') return 'The email server refused this address.';
  return 'The email server did not accept this message.';
}

export function openMailer(settings: SmtpSettings): Mailer {
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: !settings.secure,
    auth: { user: settings.user, pass: settings.password },
    pool: true,
    maxConnections: 3,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    async verify() {
      try {
        await transport.verify();
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: describeFailure('Email sign-in failed', error) };
      }
    },
    async send(email) {
      try {
        await transport.sendMail({ from: settings.from, to: email.to, subject: email.subject, text: email.text, ...(email.headers ? { headers: email.headers } : {}) });
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: describeFailure('Email delivery failed', error) };
      }
    },
    close() {
      transport.close();
    },
  };
}
