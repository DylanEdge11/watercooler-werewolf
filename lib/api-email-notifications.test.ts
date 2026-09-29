import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';
import type { OutgoingEmail } from './email/smtp';

const shared = vi.hoisted(() => ({
  db: null as unknown,
  currentPlayer: null as { seatId: string; gameId: string } | null,
  sent: [] as OutgoingEmail[],
  refuse: new Set<string>(),
  openFails: false,
  // Test rosters use .test addresses, which the real rule never sends to; this set stands in for it.
  reserved: new Set<string>(),
  aiText: null as string | null,
  aiRequests: 0,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/auth/authorization', () => ({ requireGameModerator: async () => ({ id: 'mod' }) }));
vi.mock('../lib/auth/session', () => ({ getCurrentPlayer: async () => shared.currentPlayer }));
vi.mock('./email/smtp', () => ({
  openMailer: () => {
    if (shared.openFails) throw new Error('mail server exploded');
    return {
      verify: async () => ({ ok: true }),
      send: async (email: OutgoingEmail) => {
        if (shared.refuse.has(email.to)) return { ok: false, reason: 'The email server refused this address.' };
        shared.sent.push(email);
        return { ok: true };
      },
      close: () => {},
    };
  },
}));
vi.mock('./email/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./email/settings')>()),
  isReservedTestAddress: (email: string) => shared.reserved.has(email),
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async () => {
        shared.aiRequests += 1;
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: shared.aiText ?? '' }] };
      },
    };
  },
}));

import { POST as phasePost } from '../app/api/games/[gameId]/phases/route';
import { POST as emailPreferencePost } from '../app/api/player/email/route';
import { GET as playerGet } from '../app/api/player/route';
import { POST as unsubscribePost } from '../app/api/email/unsubscribe/route';
import { GET as schedulerGet } from '../app/api/scheduler/deadlines/route';
import { flushNotifications } from './notify/notifications';

let client: Client;
const context = { params: Promise.resolve({ gameId: 'game' }) };
const SMTP = { SMTP_HOST: 'smtp.example.io', SMTP_USER: 'sender', SMTP_PASSWORD: 'fictional-password', EMAIL_FROM: 'Game <game@example.io>', SITE_ORIGIN: 'http://localhost:3000', CRON_SECRET: 'fictional-cron-secret' };
const envBefore = new Map(Object.keys({ ...SMTP, ANTHROPIC_API_KEY: '' }).map((key) => [key, process.env[key]]));

const ROLE_WORDS = /werewolf|wolf|seer|bodyguard|hunter|mason|mayor|cupid|villager/iu;

function post(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

async function exec(sql: string, args: Array<string | number | null> = []): Promise<void> {
  await client.execute({ sql, args });
}

async function rows<T>(sql: string, args: Array<string | number | null> = []): Promise<T[]> {
  return (await client.execute({ sql, args })).rows as unknown as T[];
}

const minutes = (count: number) => new Date(Date.now() + count * 60_000).toISOString();

/**
 * A running review-mode game with 20 fictional players: p0 is the Seer, p17 to p19 are Werewolves,
 * everyone else a Villager. No phase yet.
 */
async function seedGame(): Promise<void> {
  await exec("INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','fake','[]','2026-01-01','2026-01-01')");
  await exec(
    `INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at,publication_mode)
     VALUES ('game','Office Campaign','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01','REVIEW')`,
  );
  await exec("INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01')");
  await exec("INSERT INTO assignment_batches (id,game_id,revision,assignments_json,random_evidence_hash,created_by_moderator_id,created_at) VALUES ('batch','game',1,'[]','hash','mod','2026-01-01')");
  for (let index = 0; index < 20; index += 1) {
    await exec("INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,created_at,updated_at) VALUES (?,?,?,?,'CLAIMED',?,'2026-01-01','2026-01-01')", [`p${index}`, 'game', `Player ${index}`, `p${index}@office.io`, `hash-${index}`]);
    const role = index === 0 ? 'SEER' : index >= 17 ? 'WEREWOLF' : 'VILLAGER';
    await exec("INSERT INTO role_assignments (game_id,seat_id,role_key,assignment_batch_id) VALUES ('game',?,?,'batch')", [`p${index}`, role]);
  }
}

async function seedPhase(options: { id?: string; sequence?: number; kind?: 'DAY' | 'NIGHT'; status?: string; opensAt?: string; closesAt?: string } = {}): Promise<void> {
  await exec(
    "INSERT INTO phases (id,game_id,sequence,kind,status,opens_at,closes_at,slots,divisor_snapshot,created_at,updated_at) VALUES (?,'game',?,?,?,?,?,1,30,'2026-01-01','2026-01-01')",
    [options.id ?? 'phase', options.sequence ?? 1, options.kind ?? 'DAY', options.status ?? 'OPEN', options.opensAt ?? minutes(-2 * 24 * 60), options.closesAt ?? minutes(2 * 24 * 60)],
  );
}

async function optIn(...seatIds: string[]): Promise<void> {
  for (const seatId of seatIds) {
    await exec("INSERT INTO email_preferences (seat_id,enabled,unsubscribe_token,created_at,updated_at) VALUES (?,1,?,'2026-01-01','2026-01-01')", [seatId, `token-${seatId}`]);
  }
}

async function vote(...seatIds: string[]): Promise<void> {
  for (const seatId of seatIds) {
    await exec("INSERT INTO action_submissions (id,phase_id,actor_seat_id,kind,target_ids_json,version,submitted_at) VALUES (?, 'phase', ?, 'DAY_VOTE', '[\"p1\"]', 1, '2026-01-01')", [`vote-${seatId}`, seatId]);
  }
}

function recipients(): string[] {
  return shared.sent.map((email) => email.to).sort();
}

async function openPhase(kind: 'DAY' | 'NIGHT'): Promise<Response> {
  const response = await phasePost(post('/api/games/game/phases', { action: 'OPEN', kind, closesAt: minutes(2 * 24 * 60).slice(0, 16) }), context);
  await flushNotifications();
  return response;
}

async function visit(seatId: string) {
  shared.currentPlayer = { seatId, gameId: 'game' };
  const response = await playerGet(new Request('http://localhost:3000/api/player'));
  await flushNotifications();
  expect(response.status).toBe(200);
  return response.json() as Promise<{ emailNotifications: { available: boolean; enabled: boolean } }>;
}

async function emailEvents(): Promise<Array<{ severity: string; message: string; details: Record<string, unknown> }>> {
  const found = await rows<{ severity: string; message: string; details: string }>("SELECT severity, message, details_json AS details FROM operational_events WHERE source = 'EMAIL' ORDER BY created_at, id");
  return found.map((row) => ({ severity: row.severity, message: row.message, details: JSON.parse(row.details) as Record<string, unknown> }));
}

beforeEach(async () => {
  for (const [key, value] of Object.entries(SMTP)) process.env[key] = value;
  delete process.env.ANTHROPIC_API_KEY;
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  shared.currentPlayer = null;
  shared.sent = [];
  shared.refuse = new Set();
  shared.reserved = new Set();
  shared.openFails = false;
  shared.aiText = null;
  shared.aiRequests = 0;
  await seedGame();
});

afterEach(() => {
  for (const [key, value] of envBefore) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  shared.db = null;
  client.close();
  vi.restoreAllMocks();
});

describe('the email switch', () => {
  test('is off until a player turns it on, and the dashboard reflects it', async () => {
    expect((await visit('p5')).emailNotifications).toEqual({ available: true, enabled: false });

    shared.currentPlayer = { seatId: 'p5', gameId: 'game' };
    const on = await emailPreferencePost(post('/api/player/email', { enabled: true }));
    expect(on.status).toBe(200);
    expect((await visit('p5')).emailNotifications).toEqual({ available: true, enabled: true });
    expect((await visit('p6')).emailNotifications.enabled).toBe(false);

    shared.currentPlayer = { seatId: 'p5', gameId: 'game' };
    await emailPreferencePost(post('/api/player/email', { enabled: false }));
    expect((await visit('p5')).emailNotifications.enabled).toBe(false);
    // The unsubscribe token is created once and survives switching off and on.
    shared.currentPlayer = { seatId: 'p5', gameId: 'game' };
    const token = (await rows<{ token: string }>("SELECT unsubscribe_token AS token FROM email_preferences WHERE seat_id = 'p5'"))[0].token;
    await emailPreferencePost(post('/api/player/email', { enabled: true }));
    expect(await rows("SELECT unsubscribe_token AS token, enabled FROM email_preferences WHERE seat_id = 'p5'")).toEqual([{ token, enabled: 1 }]);
  });

  test('needs a signed-in player and a yes or no', async () => {
    shared.currentPlayer = null;
    expect((await emailPreferencePost(post('/api/player/email', { enabled: true }))).status).toBe(401);
    shared.currentPlayer = { seatId: 'p5', gameId: 'game' };
    expect((await emailPreferencePost(post('/api/player/email', { enabled: 'yes' }))).status).toBe(400);
    expect((await emailPreferencePost(new Request('http://localhost:3000/api/player/email', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ enabled: true }) }))).status).toBe(403);
    expect(await rows('SELECT * FROM email_preferences')).toHaveLength(0);
  });

  test('is unavailable, and cannot be turned on, when the site has no mail account', async () => {
    delete process.env.SMTP_HOST;
    expect((await visit('p5')).emailNotifications).toEqual({ available: false, enabled: false });
    shared.currentPlayer = { seatId: 'p5', gameId: 'game' };
    expect((await emailPreferencePost(post('/api/player/email', { enabled: true }))).status).toBe(503);
  });
});

describe('unsubscribe link', () => {
  test('switches one seat off with the token in the address or the body, with no Origin header', async () => {
    await optIn('p5', 'p6');
    const byAddress = await unsubscribePost(new Request('http://localhost:3000/api/email/unsubscribe?token=token-p5', { method: 'POST' }));
    expect(byAddress.status).toBe(200);
    const byBody = await unsubscribePost(new Request('http://localhost:3000/api/email/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'token-p6' }) }));
    expect(byBody.status).toBe(200);
    expect(await rows('SELECT seat_id AS seat, enabled FROM email_preferences ORDER BY seat_id')).toEqual([{ seat: 'p5', enabled: 0 }, { seat: 'p6', enabled: 0 }]);
  });

  test('an unknown or missing token changes nothing', async () => {
    await optIn('p5');
    expect((await unsubscribePost(new Request('http://localhost:3000/api/email/unsubscribe?token=nope', { method: 'POST' }))).status).toBe(404);
    expect((await unsubscribePost(new Request('http://localhost:3000/api/email/unsubscribe', { method: 'POST' }))).status).toBe(404);
    expect(await rows('SELECT enabled FROM email_preferences')).toEqual([{ enabled: 1 }]);
  });
});

describe('phase opened', () => {
  test('a Day goes to every opted-in living player, and no one else', async () => {
    await optIn('p0', 'p1', 'p5', 'p17', 'p3');
    shared.reserved.add('p3@office.io');
    await exec("UPDATE seats SET alive = 0 WHERE id = 'p1'");
    expect((await openPhase('DAY')).status).toBe(200);
    expect(recipients()).toEqual(['p0@office.io', 'p17@office.io', 'p5@office.io']);
    const [email] = shared.sent.filter((sent) => sent.to === 'p5@office.io');
    expect(email.subject).toBe('Office Campaign: Day 1 is open');
    expect(email.text).toContain('you have something to do before');
    expect(email.text).toContain('http://localhost:3000/email/unsubscribe?token=token-p5');
    expect(email.headers).toMatchObject({ 'List-Unsubscribe': '<http://localhost:3000/api/email/unsubscribe?token=token-p5>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    expect(await emailEvents()).toEqual([expect.objectContaining({ severity: 'INFO', message: 'Day 1 opened: emailed 3 players.' })]);
  });

  test('a Night goes only to opted-in players who have a Night action, and says nothing about roles', async () => {
    await seedPhase({ status: 'PUBLISHED', closesAt: '2026-01-02T00:00:00.000Z', opensAt: '2026-01-01T00:00:00.000Z' });
    await optIn('p0', 'p5', 'p17', 'p18', 'p19');
    await exec("UPDATE seats SET alive = 0 WHERE id = 'p19'");
    expect((await openPhase('NIGHT')).status).toBe(200);
    expect(recipients()).toEqual(['p0@office.io', 'p17@office.io', 'p18@office.io']);
    for (const email of shared.sent) {
      expect(`${email.subject}\n${email.text}`.replaceAll('Watercooler Werewolf', '')).not.toMatch(ROLE_WORDS);
    }
  });

  test('opening the same phase twice emails once', async () => {
    await optIn('p5');
    await openPhase('DAY');
    await openPhase('DAY');
    expect(shared.sent).toHaveLength(1);
  });

  test('sends nothing when the site has no mail account, and the phase still opens', async () => {
    await optIn('p5');
    delete process.env.SMTP_HOST;
    expect((await openPhase('DAY')).status).toBe(200);
    expect(shared.sent).toHaveLength(0);
    expect(await emailEvents()).toHaveLength(0);
  });

  test('a mail server that is down never fails the phase opening', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await optIn('p5');
    shared.openFails = true;
    expect((await openPhase('DAY')).status).toBe(200);
    expect((await rows<{ status: string }>("SELECT status FROM phases WHERE game_id = 'game'"))[0].status).toBe('OPEN');
  });
});

describe('closes soon', () => {
  test('a visit in the last half hour reminds opted-in players who have not voted, once', async () => {
    await seedPhase({ closesAt: minutes(20) });
    await optIn('p5', 'p6', 'p7');
    await vote('p6');
    await visit('p9');
    expect(recipients()).toEqual(['p5@office.io', 'p7@office.io']);
    expect(shared.sent[0].subject).toBe('Office Campaign: Day 1 closes soon');
    expect(shared.sent[0].text).toContain('you have not saved your move yet');
    await visit('p9');
    await visit('p5');
    expect(shared.sent).toHaveLength(2);
    expect((await emailEvents()).map((event) => event.message)).toEqual(['Day 1 closing soon: emailed 2 players.']);
  });

  test('a visit before the last half hour sends nothing and leaves the reminder for later', async () => {
    await seedPhase({ closesAt: minutes(45) });
    await optIn('p5');
    await visit('p9');
    expect(shared.sent).toHaveLength(0);
    expect((await rows<{ at: string | null }>('SELECT closing_reminder_at AS at FROM phases'))[0].at).toBeNull();
  });

  test('a phase of an hour or less gets no reminder, because the opened email just went out', async () => {
    await seedPhase({ opensAt: minutes(-30), closesAt: minutes(20) });
    await optIn('p5');
    await visit('p9');
    expect(shared.sent).toHaveLength(0);
  });

  test('on a Night only players with a Night action who have not acted are reminded', async () => {
    await seedPhase({ id: 'day', status: 'PUBLISHED', closesAt: '2026-01-02T00:00:00.000Z', opensAt: '2026-01-01T00:00:00.000Z' });
    await seedPhase({ id: 'phase', sequence: 2, kind: 'NIGHT', closesAt: minutes(20) });
    await optIn('p0', 'p5', 'p17', 'p18');
    await exec("INSERT INTO action_submissions (id,phase_id,actor_seat_id,kind,target_ids_json,version,submitted_at) VALUES ('w','phase','p18','WOLF_VOTE','[\"p5\"]',1,'2026-01-01')");
    await visit('p9');
    expect(recipients()).toEqual(['p0@office.io', 'p17@office.io']);
    for (const email of shared.sent) expect(`${email.subject}\n${email.text}`.replaceAll('Watercooler Werewolf', '')).not.toMatch(ROLE_WORDS);
  });

  test('the scheduler sends it too, with nobody visiting, and reports how many phases it handled', async () => {
    await seedPhase({ closesAt: minutes(25) });
    await optIn('p5');
    const response = await schedulerGet(new Request('http://localhost:3000/api/scheduler/deadlines', { headers: { authorization: 'Bearer fictional-cron-secret' } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, reminders: 1 });
    expect(recipients()).toEqual(['p5@office.io']);
    // A second sweep, or a visit, finds it already sent, and the sweep says it sent nothing.
    const second = await schedulerGet(new Request('http://localhost:3000/api/scheduler/deadlines', { headers: { authorization: 'Bearer fictional-cron-secret' } }));
    expect(await second.json()).toMatchObject({ reminders: 0 });
    await visit('p9');
    expect(shared.sent).toHaveLength(1);
  });

  test('two visits at once send it once', async () => {
    await seedPhase({ closesAt: minutes(20) });
    await optIn('p5');
    shared.currentPlayer = { seatId: 'p9', gameId: 'game' };
    await Promise.all([playerGet(new Request('http://localhost:3000/api/player')), playerGet(new Request('http://localhost:3000/api/player')), playerGet(new Request('http://localhost:3000/api/player'))]);
    await flushNotifications();
    expect(shared.sent).toHaveLength(1);
  });
});

describe('result published', () => {
  /** Everyone votes out Player 1 on a Day past its deadline, then the moderator locks and publishes. */
  async function publishDay(): Promise<Response> {
    await seedPhase({ closesAt: minutes(-5), opensAt: minutes(-2 * 24 * 60) });
    await vote(...Array.from({ length: 20 }, (_, index) => `p${index}`).filter((id) => id !== 'p1'));
    expect((await phasePost(post('/api/games/game/phases', { action: 'LOCK_AND_PROPOSE', phaseId: 'phase' }), context)).status).toBe(200);
    const response = await phasePost(post('/api/games/game/phases', { action: 'PUBLISH', phaseId: 'phase' }), context);
    await flushNotifications();
    return response;
  }

  test('every opted-in player gets the recap, including the one who was eliminated', async () => {
    await optIn('p1', 'p5', 'p17');
    expect((await publishDay()).status).toBe(200);
    expect(recipients()).toEqual(['p17@office.io', 'p1@office.io', 'p5@office.io']);
    const [email] = shared.sent;
    expect(email.subject).toBe('Office Campaign: the Day 1 result is in');
    expect(email.text).toContain('Player 1');
    expect(email.text).toContain('Player 1 was a Villager');
    expect(email.text).toContain('See the full result and what happens next: http://localhost:3000');
    expect(shared.aiRequests).toBe(0);
    expect(await emailEvents()).toEqual([expect.objectContaining({ severity: 'INFO', message: 'Day 1 result: emailed 3 players.', details: expect.objectContaining({ storySource: 'TEMPLATE' }) })]);
  });

  test('with an AI key the story is written by the model, once, and the same one goes to everyone', async () => {
    process.env.ANTHROPIC_API_KEY = 'fictional-key';
    shared.aiText = 'The village argued over the last biscuit and then, in a rare moment of unity, sent Player 1 packing. A Villager, no less, which says something about the state of the fridge.';
    await optIn('p5', 'p17');
    await publishDay();
    expect(shared.aiRequests).toBe(1);
    expect(shared.sent).toHaveLength(2);
    for (const email of shared.sent) expect(email.text).toContain(shared.aiText);
    expect((await emailEvents())[0].details).toMatchObject({ storySource: 'AI', story: shared.aiText });
  });

  test('a model answer that ignores the brief is replaced by the template', async () => {
    process.env.ANTHROPIC_API_KEY = 'fictional-key';
    shared.aiText = 'Something happened. Read more at https://example.io/story';
    await optIn('p5');
    await publishDay();
    expect(shared.sent[0].text).not.toContain('example.io/story');
    expect(shared.sent[0].text).toContain('Player 1 was a Villager');
  });

  test('players who did not opt in get nothing, and nothing is generated for them', async () => {
    process.env.ANTHROPIC_API_KEY = 'fictional-key';
    await publishDay();
    expect(shared.sent).toHaveLength(0);
    expect(shared.aiRequests).toBe(0);
  });

  test('a refused address is reported to the moderator and the result still publishes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await optIn('p5', 'p6');
    shared.refuse.add('p6@office.io');
    expect((await publishDay()).status).toBe(200);
    expect(recipients()).toEqual(['p5@office.io']);
    expect((await emailEvents())[0]).toMatchObject({ severity: 'WARNING', message: 'Day 1 result: 1 of 2 emails could not be delivered. Check the email settings.' });
    expect((await rows<{ status: string }>('SELECT status FROM phases'))[0].status).toBe('PUBLISHED');
  });

  test('a mail server that is down never fails the publication', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await optIn('p5');
    shared.openFails = true;
    expect((await publishDay()).status).toBe(200);
    expect((await rows<{ status: string }>('SELECT status FROM phases'))[0].status).toBe('PUBLISHED');
  });

  test('publishing again emails nothing more', async () => {
    await optIn('p5');
    await publishDay();
    const again = await phasePost(post('/api/games/game/phases', { action: 'PUBLISH', phaseId: 'phase' }), context);
    await flushNotifications();
    expect(again.status).toBe(200);
    expect(shared.sent).toHaveLength(1);
  });
});
