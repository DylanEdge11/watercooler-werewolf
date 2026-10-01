import { readSmtpSettings } from '../email/settings';

/** How many minutes before a deadline the "closes soon" email goes out. */
export const CLOSING_SOON_MINUTES = 30;

/**
 * A phase this short (or shorter) gets no "closes soon" email: the "opened"
 * email already arrived within the last hour, and a second one would just be noise.
 */
export const MIN_PHASE_MINUTES_FOR_REMINDER = 60;

/** Whether this site can send player email at all. Players see the switch only when it can. */
export function emailNotificationsAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return readSmtpSettings(env) !== null && siteOrigin(env) !== null;
}

/**
 * The address players open from an email link. SITE_ORIGIN when set; on Vercel
 * the deployment's own address otherwise. Null means "unknown", and nothing is sent
 * rather than sending a link that goes nowhere.
 */
export function siteOrigin(env: Record<string, string | undefined> = process.env): string | null {
  const configured = env.SITE_ORIGIN?.trim();
  const candidate = configured || (env.VERCEL_URL?.trim() ? `https://${env.VERCEL_URL.trim()}` : '');
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null;
  } catch {
    return null;
  }
}
