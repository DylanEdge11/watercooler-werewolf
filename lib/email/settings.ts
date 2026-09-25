export interface SmtpSettings {
  host: string;
  port: number;
  /** Port 465 uses TLS from the start; other ports upgrade with STARTTLS. */
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

/**
 * Invite email uses plain SMTP so the sender can move from a Gmail app
 * password to a domain provider (Resend, Postmark, SES, ...) by changing
 * environment variables only. Returns null unless every required value is set.
 */
export function readSmtpSettings(env: Record<string, string | undefined> = process.env): SmtpSettings | null {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD?.trim();
  const from = env.EMAIL_FROM?.trim();
  const port = Number(env.SMTP_PORT?.trim() || 465);
  if (!host || !user || !password || !from) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port, secure: port === 465, user, password, from };
}

const RESERVED_DOMAINS = new Set(['example.com', 'example.net', 'example.org']);
const RESERVED_SUFFIXES = ['.test', '.example', '.invalid', '.localhost'];

/**
 * Addresses on reserved test domains (RFC 2606) can never receive mail. Test
 * rosters use them, so sending would only bounce back to the sender's inbox.
 */
export function isReservedTestAddress(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@').pop() ?? '';
  return RESERVED_DOMAINS.has(domain) || RESERVED_SUFFIXES.some((suffix) => domain === suffix.slice(1) || domain.endsWith(suffix));
}
