// Characters that let one field name several recipients or a display name
// ("a@x.com;b@y.com", "Ana <a@x.com>"). Mail libraries split on them, which
// would send one player's private claim link to every address in the field.
const PLAIN_PART = String.raw`[^\s@,;:<>"()[\]\\]+`;
const SINGLE_ADDRESS = new RegExp(`^${PLAIN_PART}@${PLAIN_PART}\\.${PLAIN_PART}$`, 'u');

/** True when the value is exactly one plain address, like name@example.com. */
export function isSingleEmailAddress(email: string): boolean {
  return SINGLE_ADDRESS.test(email);
}
