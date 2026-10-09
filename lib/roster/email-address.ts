/** The longest email address the standard allows. Anything longer is refused before any other check. */
export const MAX_EMAIL_LENGTH = 254;

// Characters that let one field name several recipients or a display name
// ("a@x.com;b@y.com", "Ana <a@x.com>"). Mail libraries split on them, which
// would send one player's private claim link to every address in the field.
// "@" is allowed here and counted separately: there must be exactly one.
const NOT_PLAIN = /[\s,;:<>"()[\]\\]/u;

/**
 * True when the value is exactly one plain address, like name@example.com.
 *
 * This runs on unauthenticated input (the sign-in and recovery routes), so it
 * must stay linear: a length cap first, then single-pass scans. A single
 * pattern with two overlapping "one or more" parts on either side of a dot
 * backtracks quadratically on a long run of dots.
 */
export function isSingleEmailAddress(email: string): boolean {
  if (email.length > MAX_EMAIL_LENGTH) return false;
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return false;
  if (NOT_PLAIN.test(email)) return false;
  // The domain needs a dot with at least one character before and after it.
  const domain = email.slice(at + 1);
  const dot = domain.indexOf('.', 1);
  return dot !== -1 && dot <= domain.length - 2;
}
