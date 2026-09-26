import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';
import { sha256 } from './auth/crypto';
import type { OutgoingEmail } from './email/smtp';

const shared = vi.hoisted(() => ({
  db: null as unknown,
  sent: [] as OutgoingEmail[],
  signInOk: true,
  refuse: new Set<string>(),
  // Test rosters use .test addresses, which the real rule never sends to;
  // this list stands in for it so delivery can be exercised.
  reserved: new Set<string>(),
  closed: 0,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/auth/authorization', () => ({ requireGameModerator: async () => ({ id: 'mod' }) }));
vi.mock('./email/smtp', () => ({
  openMailer: () => ({
    verify: async () => (shared.signInOk ? { ok: true } : { ok: false, reason: 'The email account rejected the sign-in. Check SMTP_USER and SMTP_PASSWORD.' }),
    send: async (email: OutgoingEmail) => {
      if (shared.refuse.has(email.to)) return { ok: false, reason: 'The email server refused this address.' };
      shared.sent.push(email);
      return { ok: true };
    },
    close: () => {
      shared.closed += 1;
    },
  }),
}));
vi.mock('./email/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./email/settings')>()),
  isReservedTestAddress: (email: string) => shared.reserved.has(email),
}));

import { POST as invitesPost } from '../app/api/games/[gameId]/invites/route';
import { GET as rosterGet } from '../app/api/games/[gameId]/roster/route';
import { GET as claimGet } from '../app/api/seats/claim/[code]/route';

let client: Client;

const params = { params: Promise.resolve({ gameId: 'game' }) };

function sendInvites(body: unknown = {}, origin = 'http://localhost:3000'): Promise<Response> {
  return invitesPost(
    new Request('http://localhost:3000/api/games/game/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(body),
    }),
    params,
  );
}

async function roster(): Promise<{ emailConfigured: boolean; roster: Array<{ id: string; status: string; invitationEmailedAt: string | null }> }> {
  return (await rosterGet(new Request('http://localhost:3000/api/games/game/roster'), params)).json();
}

async function claimStatus(code: string): Promise<number> {
  return (await claimGet(new Request(`http://localhost:3000/api/seats/claim/${code}`), { params: Promise.resolve({ code }) })).status;
}

async function seatHash(id: string): Promise<string> {
  const result = await client.execute({ sql: 'SELECT claim_code_hash AS hash FROM seats WHERE id = ?', args: [id] });
  return String(result.rows[0].hash);
}

function codeIn(email: OutgoingEmail): string {
  const match = /\/claim\/(\S+)/u.exec(email.text);
  if (!match) throw new Error('No claim link in the email.');
  return decodeURIComponent(match[1]);
}

async function seed(status = 'REGISTRATION'): Promise<void> {
  const statements = [
    "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','fake','[]','2026-01-01','2026-01-01')",
    `INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Invite test','${status}','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')`,
    "INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01')",
  ].map((sql): { sql: string; args: string[] } => ({ sql, args: [] }));
  for (const [id, seatStatus] of [['ana', 'INVITED'], ['ben', 'INVITED'], ['cy', 'INVITED'], ['dee', 'CLAIMED']] as const) {
    statements.push({
      sql: 'INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      args: [id, 'game', `Player ${id}`, `${id}@pilot.test`, seatStatus, await sha256(`original-${id}`), '2026-01-01', '2026-01-01'],
    });
  }
  await client.batch(statements, 'write');
}

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  shared.sent = [];
  shared.signInOk = true;
  shared.refuse = new Set();
  shared.reserved = new Set();
  shared.closed = 0;
  vi.stubEnv('SMTP_HOST', 'smtp.pilot.test');
  vi.stubEnv('SMTP_USER', 'moderator@pilot.test');
  vi.stubEnv('SMTP_PASSWORD', 'fictional-app-password');
  vi.stubEnv('EMAIL_FROM', 'Watercooler Werewolf <moderator@pilot.test>');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  shared.db = null;
  client.close();
});

describe('emailing invitations', () => {
  test('emails every unclaimed player a working link and replaces the old one', async () => {
    await seed();
    const response = await sendInvites();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sent).toBe(3);
    expect(body.results.map((result: { seatId: string; status: string }) => [result.seatId, result.status])).toEqual([
      ['ana', 'SENT'],
      ['ben', 'SENT'],
      ['cy', 'SENT'],
    ]);
    expect(JSON.stringify(body)).not.toMatch(/\/claim\//u);

    expect(shared.sent.map((email) => email.to).sort()).toEqual(['ana@pilot.test', 'ben@pilot.test', 'cy@pilot.test']);
    const ana = shared.sent.find((email) => email.to === 'ana@pilot.test')!;
    expect(ana.subject).toBe('Your Watercooler Werewolf seat');
    expect(ana.text).toContain('Hi Player ana,');
    expect(await sha256(codeIn(ana))).toBe(await seatHash('ana'));
    expect(await claimStatus(codeIn(ana))).toBe(200);
    expect(await claimStatus('original-ana')).toBe(404);
    expect(await seatHash('dee')).toBe(await sha256('original-dee'));
    expect(shared.closed).toBe(1);

    const after = await roster();
    expect(after.emailConfigured).toBe(true);
    const emailed = Object.fromEntries(after.roster.map((seat) => [seat.id, seat.invitationEmailedAt]));
    expect(emailed.ana).toEqual(expect.any(String));
    expect(emailed.cy).toEqual(expect.any(String));
    expect(emailed.dee).toBeNull();
  });

  test('a resend goes only to the chosen player and retires their emailed link', async () => {
    await seed();
    await sendInvites({ seatIds: ['ben'] });
    const first = codeIn(shared.sent[0]);
    await sendInvites({ seatIds: ['ben', 'dee'] });
    expect(shared.sent.map((email) => email.to)).toEqual(['ben@pilot.test', 'ben@pilot.test']);
    expect(await claimStatus(first)).toBe(404);
    expect(await claimStatus(codeIn(shared.sent[1]))).toBe(200);
    expect(await seatHash('ana')).toBe(await sha256('original-ana'));

    const claimedOnly = await sendInvites({ seatIds: ['dee'] });
    expect(claimedOnly.status).toBe(409);
  });

  test('a failed sign-in changes no links', async () => {
    await seed();
    shared.signInOk = false;
    const response = await sendInvites();
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/rejected the sign-in/u);
    expect(shared.sent).toEqual([]);
    expect(await seatHash('ana')).toBe(await sha256('original-ana'));
    expect(shared.closed).toBe(1);
  });

  test('a refused address is reported and not marked as emailed', async () => {
    await seed();
    shared.refuse.add('ben@pilot.test');
    const body = await (await sendInvites()).json();
    expect(body.sent).toBe(2);
    expect(body.results.find((result: { seatId: string }) => result.seatId === 'ben')).toMatchObject({ status: 'FAILED', reason: 'The email server refused this address.' });
    const seats = (await roster()).roster;
    expect(seats.find((seat) => seat.id === 'ben')?.invitationEmailedAt).toBeNull();
    expect(seats.find((seat) => seat.id === 'ana')?.invitationEmailedAt).toEqual(expect.any(String));
  });

  test('reserved test addresses are skipped without replacing their links', async () => {
    await seed();
    shared.reserved.add('cy@pilot.test');
    const body = await (await sendInvites()).json();
    expect(body.results.find((result: { seatId: string }) => result.seatId === 'cy')).toMatchObject({ status: 'SKIPPED', reason: 'Test address; not sent.' });
    expect(body.results.filter((result: { status: string }) => result.status === 'SKIPPED')).toHaveLength(1);
    expect(shared.sent.map((email) => email.to)).not.toContain('cy@pilot.test');
    expect(await seatHash('cy')).toBe(await sha256('original-cy'));
  });

  test('never emails a seat whose stored email holds more than one address', async () => {
    await seed();
    // Imported before rosters were limited to one address per player.
    await client.execute({ sql: 'UPDATE seats SET email = ? WHERE id = ?', args: ['ben@pilot.test;mallory@pilot.test', 'ben'] });
    const body = await (await sendInvites()).json();
    expect(body.results.find((result: { seatId: string }) => result.seatId === 'ben')).toMatchObject({ status: 'FAILED', reason: 'Not a single email address; fix it in the roster.' });
    expect(shared.sent.map((email) => email.to)).not.toContain('ben@pilot.test;mallory@pilot.test');
    expect(shared.sent).toHaveLength(2);
    expect(await seatHash('ben')).toBe(await sha256('original-ben'));
  });

  test.each([null, [], 'ben'])('rejects a malformed request body (%j) cleanly', async (body) => {
    await seed();
    const response = await sendInvites(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Send a JSON object with seatIds.');
    expect(shared.sent).toEqual([]);
  });

  test('single-player resends have their own allowance and never use up the bulk one', async () => {
    await seed();
    for (let send = 1; send <= 30; send += 1) expect((await sendInvites()).status).toBe(200);
    expect((await sendInvites()).status).toBe(429);
    // The bulk allowance is spent, but one player can still be resent to.
    for (let resend = 1; resend <= 5; resend += 1) expect((await sendInvites({ seatIds: ['ben'] })).status).toBe(200);
    // Each player's own allowance stops an accidental flood of one inbox.
    expect((await sendInvites({ seatIds: ['ben'] })).status).toBe(429);
    expect((await sendInvites({ seatIds: ['ana'] })).status).toBe(200);
  });

  test('is unavailable until email is configured', async () => {
    await seed();
    vi.stubEnv('SMTP_PASSWORD', '');
    const response = await sendInvites();
    expect(response.status).toBe(503);
    expect((await roster()).emailConfigured).toBe(false);
    expect(await seatHash('ana')).toBe(await sha256('original-ana'));
  });

  test('is refused once the game is active', async () => {
    await seed('ACTIVE');
    const response = await sendInvites();
    expect(response.status).toBe(409);
    expect(shared.sent).toEqual([]);
  });

  test('rejects a cross-origin request', async () => {
    await seed();
    const response = await sendInvites({}, 'https://attacker.test');
    expect(response.status).toBe(403);
    expect(shared.sent).toEqual([]);
  });
});
