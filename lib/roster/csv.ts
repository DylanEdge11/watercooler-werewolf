import { MAX_PLAYERS, MIN_PLAYERS } from '../game/player-count';
import { isSingleEmailAddress } from './email-address';
import { inviteMessage } from './invite-message';

export interface RosterEntry {
  displayName: string;
  email: string;
}

export interface RosterParseResult {
  entries: RosterEntry[];
  errors: string[];
}

function parseRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    const next = csv[index + 1];
    if (character === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

/**
 * Reads a pasted roster. A roster that replaces the old one must hold a playable number of
 * players; a list added to players already on the roster only has to hold someone, so the caller
 * lowers `minPlayers` for it.
 */
export function parseRosterCsv(csv: string, options: { minPlayers?: number } = {}): RosterParseResult {
  const minimum = options.minPlayers ?? MIN_PLAYERS;
  const rows = parseRows(csv.replace(/^\uFEFF/u, ''));
  if (rows.length === 0) return { entries: [], errors: ['The CSV is empty.'] };
  const headers = rows[0].map((value) => value.trim().toLowerCase());
  const nameIndex = headers.indexOf('display_name');
  const emailIndex = headers.indexOf('email');
  if (nameIndex < 0 || emailIndex < 0) {
    return { entries: [], errors: ['CSV headers must include display_name and email.'] };
  }

  const entries: RosterEntry[] = [];
  const errors: string[] = [];
  const seenEmails = new Set<string>();
  rows.slice(1).forEach((values, offset) => {
    const line = offset + 2;
    const displayName = values[nameIndex]?.trim() ?? '';
    const email = values[emailIndex]?.trim().toLowerCase() ?? '';
    if (!displayName) errors.push(`Line ${line}: display_name is required.`);
    const validEmail = isSingleEmailAddress(email);
    if (!validEmail) errors.push(`Line ${line}: email must be one plain address, like name@example.com.`);
    if (seenEmails.has(email)) errors.push(`Line ${line}: email is duplicated.`);
    if (displayName && validEmail && !seenEmails.has(email)) {
      entries.push({ displayName, email });
      seenEmails.add(email);
    }
  });
  if (entries.length < minimum || entries.length > MAX_PLAYERS) {
    errors.push(minimum === MIN_PLAYERS
      ? `The roster must contain between ${MIN_PLAYERS} and ${MAX_PLAYERS} valid players.`
      : `The list must contain between ${minimum} and ${MAX_PLAYERS} valid players.`);
  }
  return { entries, errors };
}

/**
 * One quoted CSV cell that a spreadsheet will show as text. A cell that starts with =, +, -, or @ (or a tab or
 * return) is read by Excel and Sheets as a formula, and a name typed on the public sign-up form can start with
 * any of them, so such a cell gets a leading apostrophe. The download opens in a spreadsheet beside private links.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function createInviteExport(
  rows: Array<RosterEntry & { claimUrl: string; inviteCode: string }>,
): string {
  const header = ['display_name', 'email', 'claim_url', 'invite_code', 'message_subject', 'message_body'];
  const data = rows.map((row) => {
    const message = inviteMessage(row.displayName, row.claimUrl);
    return [row.displayName, row.email, row.claimUrl, row.inviteCode, message.subject, message.text];
  });
  return [header, ...data].map((values) => values.map(csvCell).join(',')).join('\r\n');
}

