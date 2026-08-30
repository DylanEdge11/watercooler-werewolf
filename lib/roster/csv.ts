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

export function parseRosterCsv(csv: string): RosterParseResult {
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
    if (!/^\S+@\S+\.\S+$/u.test(email)) errors.push(`Line ${line}: email is invalid.`);
    if (seenEmails.has(email)) errors.push(`Line ${line}: email is duplicated.`);
    if (displayName && /^\S+@\S+\.\S+$/u.test(email) && !seenEmails.has(email)) {
      entries.push({ displayName, email });
      seenEmails.add(email);
    }
  });
  if (entries.length < 20 || entries.length > 80) {
    errors.push('The roster must contain between 20 and 80 valid players.');
  }
  return { entries, errors };
}

function escapeCsv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function createInviteExport(
  rows: Array<RosterEntry & { claimUrl: string; inviteCode: string }>,
): string {
  const header = ['display_name', 'email', 'claim_url', 'invite_code', 'message_subject', 'message_body'];
  const data = rows.map((row) => [
    row.displayName,
    row.email,
    row.claimUrl,
    row.inviteCode,
    'Your Watercooler Werewolf seat',
    `Hi ${row.displayName}, claim your private Watercooler Werewolf seat here: ${row.claimUrl}. Your one-time code is ${row.inviteCode}. Do not forward it.`,
  ]);
  return [header, ...data].map((values) => values.map(escapeCsv).join(',')).join('\r\n');
}

