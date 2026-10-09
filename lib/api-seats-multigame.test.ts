import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { keysOf } from './test-support/keys-of';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';
import { FORBIDDEN_PLAYER_KEYS } from '../e2e/readiness/browser-fixture';
import { hashSecret, sha256 } from './auth/crypto';
import { PIN_LOCKED_MESSAGE, PIN_LOCKOUT_ATTEMPTS } from './auth/pin-lockout';
import { CLAIM_GAME_ENDED } from './auth/claim';

const shared = vi.hoisted(() => ({ db: null as LibsqlDatabase | null, playerSessions: [] as string[], spectatorSessions: [] as string[] }));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('./auth/session', () => ({
  createPlayerSession: async (seatId: string) => { shared.playerSessions.push(seatId); },
  preparePlayerSession: async (seatId: string, version: number) => ({
    values: [crypto.randomUUID(), seatId, `token-${crypto.randomUUID()}`, version, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    setCookie: async () => { shared.playerSessions.push(seatId); },
  }),
  prepareSpectatorSession: async (spectatorId: string, version: number) => ({
    values: [crypto.randomUUID(), spectatorId, `token-${crypto.randomUUID()}`, version, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    setCookie: async () => { shared.spectatorSessions.push(spectatorId); },
  }),
}));
vi.mock('./http/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http/rate-limit')>()),
  // The per-device limit is tested elsewhere; here every attempt reaches the PIN check.
  enforceRateLimit: async () => {},
}));

import { POST as loginPost } from '../app/api/seats/login/route';
import { POST as claimPost } from '../app/api/seats/claim/[code]/route';

let client: Client;

interface LoginBody {
  ok?: boolean;
  error?: string;
  seat?: { displayName: string; gameId: string };
  choices?: Array<{ id: string; kind: string; gameName: string; displayName: string }>;
}

function post(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

async function signIn(identifier: string, pin: string, choiceId?: string) {
  const response = await loginPost(post('/api/seats/login', { identifier, pin, ...(choiceId ? { choiceId } : {}) }));
  return { status: response.status, body: await response.json() as LoginBody };
}

async function addGame(id: string, name: string, status: string) {
  await client.execute({
    sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES (?,?,?,'UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')",
    args: [id, name, status],
  });
}

async function addSeat(id: string, gameId: string, pin: string, options: { email?: string; displayName?: string; claimedAt?: string } = {}) {
  await client.execute({
    sql: "INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,pin_hash,claimed_at,created_at,updated_at) VALUES (?,?,?,?,'CLAIMED',?,?,?,'2026-01-01','2026-01-01')",
    args: [id, gameId, options.displayName ?? 'Ana', options.email ?? 'ana@pilot.test', `claim-${id}`, await hashSecret(pin), options.claimedAt ?? '2026-01-02'],
  });
}

async function addSpectator(id: string, gameId: string, pin: string, email = 'ana@pilot.test') {
  await client.execute({
    sql: "INSERT INTO spectators (id,game_id,display_name,email,status,claim_code_hash,pin_hash,claimed_at,created_at,updated_at) VALUES (?,?,'Ana Watching',?,'ACTIVE',?,?,'2026-01-03','2026-01-01','2026-01-01')",
    args: [id, gameId, email, `watch-${id}`, await hashSecret(pin)],
  });
}

async function lock(bucketOwner: string) {
  await client.execute({ sql: 'INSERT INTO rate_limit_buckets (bucket_key,window_started_at,attempts) VALUES (?,?,?)', args: [`pin-failures:${bucketOwner}`, '2026-01-01T00:00:00.000Z', PIN_LOCKOUT_ATTEMPTS] });
}

async function failureBuckets(): Promise<string[]> {
  const rows = await client.execute("SELECT bucket_key FROM rate_limit_buckets WHERE bucket_key LIKE 'pin-failures:%' ORDER BY bucket_key");
  return rows.rows.map((row) => String(row.bucket_key));
}

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  shared.playerSessions = [];
  shared.spectatorSessions = [];
  await client.execute("INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','x','[]','2026-01-01','2026-01-01')");
});

afterEach(() => {
  shared.db = null;
  client.close();
});

describe('email sign-in when the same email and PIN are in more than one game', () => {
  test.each(['COMPLETED', 'STOPPED', 'CANCELLED'])('a %s game never blocks the game that is still going', async (endedStatus) => {
    await addGame('old', 'Old game', endedStatus);
    await addGame('running', 'Running game', 'ACTIVE');
    await addSeat('ana-old', 'old', '123456', { claimedAt: '2026-01-02' });
    await addSeat('ana-running', 'running', '123456', { claimedAt: '2026-02-02' });
    expect(await signIn('ana@pilot.test', '123456')).toEqual({ status: 200, body: { ok: true, seat: { displayName: 'Ana', gameId: 'running' } } });
    expect(shared.playerSessions).toEqual(['ana-running']);
  });

  test('the finished game is skipped even when it was claimed more recently', async () => {
    await addGame('old', 'Old game', 'COMPLETED');
    await addGame('running', 'Running game', 'ACTIVE');
    await addSeat('ana-running', 'running', '123456', { claimedAt: '2026-01-02' });
    await addSeat('ana-old', 'old', '123456', { claimedAt: '2026-03-02' });
    expect((await signIn('ana@pilot.test', '123456')).body.seat?.gameId).toBe('running');
  });

  test('different PINs still sign in to the matching game, finished or not', async () => {
    await addGame('old', 'Old game', 'COMPLETED');
    await addGame('running', 'Running game', 'ACTIVE');
    await addSeat('ana-old', 'old', '111111');
    await addSeat('ana-running', 'running', '222222');
    expect((await signIn('ana@pilot.test', '111111')).body.seat?.gameId).toBe('old');
    expect((await signIn('ana@pilot.test', '222222')).body.seat?.gameId).toBe('running');
  });

  test('a lone finished game still signs in by email and by seat code', async () => {
    await addGame('old', 'Old game', 'COMPLETED');
    await addSeat('ana-old', 'old', '123456');
    await client.execute({ sql: "UPDATE seats SET claim_code_hash = ? WHERE id = 'ana-old'", args: [await sha256('SEAT-OLD')] });
    expect((await signIn('ana@pilot.test', '123456')).status).toBe(200);
    expect((await signIn('SEAT-OLD', '123456')).status).toBe(200);
  });

  test('a stopped game, a game that has not started, and a running game: only the stopped one is dropped', async () => {
    await addGame('stopped', 'Stopped game', 'STOPPED');
    await addGame('waiting', 'Waiting game', 'REGISTRATION');
    await addGame('running', 'Running game', 'ACTIVE');
    for (const id of ['stopped', 'waiting', 'running']) await addSeat(`ana-${id}`, id, '123456');
    const result = await signIn('ana@pilot.test', '123456');
    expect(result.status).toBe(409);
    expect(result.body.choices?.map((choice) => choice.gameName).sort()).toEqual(['Running game', 'Waiting game']);
    expect(shared.playerSessions).toEqual([]);
  });

  test('two running games ask which one, and the choice signs in to that game', async () => {
    await addGame('first', 'First game', 'ACTIVE');
    await addGame('second', 'Second game', 'ACTIVE');
    await addSeat('ana-first', 'first', '123456', { displayName: 'Ana in first' });
    await addSeat('ana-second', 'second', '123456', { displayName: 'Ana in second' });

    const asked = await signIn('ana@pilot.test', '123456');
    expect(asked.status).toBe(409);
    expect(asked.body.error).toEqual(expect.stringContaining('more than one game'));
    expect(asked.body.choices).toHaveLength(2);
    expect(asked.body.choices).toEqual(expect.arrayContaining([
      { id: 'ana-first', kind: 'SEAT', gameName: 'First game', displayName: 'Ana in first' },
      { id: 'ana-second', kind: 'SEAT', gameName: 'Second game', displayName: 'Ana in second' },
    ]));
    expect(shared.playerSessions).toEqual([]);

    expect(await signIn('ana@pilot.test', '123456', 'ana-second')).toEqual({ status: 200, body: { ok: true, seat: { displayName: 'Ana in second', gameId: 'second' } } });
    expect(shared.playerSessions).toEqual(['ana-second']);
    expect((await signIn('ana@pilot.test', '123456', 'ana-first')).body.seat?.gameId).toBe('first');
  });

  test('the list holds only names and ids: no forbidden key, role, seat code, hash, email, or session', async () => {
    await addGame('first', 'First game', 'ACTIVE');
    await addGame('second', 'Second game', 'ACTIVE');
    await addSeat('ana-first', 'first', '123456');
    await addSeat('ana-second', 'second', '123456');
    await client.batch([
      { sql: "INSERT INTO assignment_batches (id,game_id,revision,assignments_json,random_evidence_hash,created_by_moderator_id,created_at) VALUES ('batch','first',1,'[]','hash','mod','2026-01-01')", args: [] },
      { sql: "INSERT INTO role_assignments (game_id,seat_id,role_key,assignment_batch_id) VALUES ('first','ana-first','WEREWOLF','batch')", args: [] },
    ], 'write');
    const { status, body } = await signIn('ana@pilot.test', '123456');
    expect(status).toBe(409);
    expect(Object.keys(body).sort()).toEqual(['choices', 'error', 'ok']);
    for (const choice of body.choices ?? []) expect(Object.keys(choice).sort()).toEqual(['displayName', 'gameName', 'id', 'kind']);
    const sent = JSON.stringify(body);
    for (const key of keysOf(body)) expect(FORBIDDEN_PLAYER_KEYS.has(key), key).toBe(false);
    for (const secret of ['WEREWOLF', 'role', 'ana@pilot.test', 'claim-ana', 'pbkdf2', 'sessionVersion', 'token']) expect(sent, secret).not.toContain(secret);
  });

  test('when every match is in a finished game they are all offered, not hidden', async () => {
    await addGame('one', 'First finished', 'COMPLETED');
    await addGame('two', 'Second finished', 'STOPPED');
    await addSeat('ana-one', 'one', '123456');
    await addSeat('ana-two', 'two', '123456');
    const asked = await signIn('ana@pilot.test', '123456');
    expect(asked.status).toBe(409);
    expect(asked.body.choices).toHaveLength(2);
    expect((await signIn('ana@pilot.test', '123456', 'ana-two')).body.seat?.gameId).toBe('two');
  });

  test('a player seat and a spectator in two running games are both offered, and either can be chosen', async () => {
    await addGame('play', 'Playing game', 'ACTIVE');
    await addGame('watch', 'Watching game', 'ACTIVE');
    await addSeat('ana-play', 'play', '123456');
    await addSpectator('ana-watch', 'watch', '123456');
    const asked = await signIn('ana@pilot.test', '123456');
    expect(asked.status).toBe(409);
    expect(asked.body.choices?.map((choice) => choice.kind).sort()).toEqual(['SEAT', 'SPECTATOR']);
    expect((await signIn('ana@pilot.test', '123456', 'ana-watch')).body.seat).toEqual({ displayName: 'Ana Watching', gameId: 'watch' });
    expect(shared.spectatorSessions).toEqual(['ana-watch']);
    expect(shared.playerSessions).toEqual([]);
  });

  test('a spectator of a finished game does not stop a player in a running game', async () => {
    await addGame('done', 'Finished game', 'COMPLETED');
    await addGame('running', 'Running game', 'ACTIVE');
    await addSpectator('ana-watch', 'done', '123456');
    await addSeat('ana-running', 'running', '123456');
    expect((await signIn('ana@pilot.test', '123456')).body.seat?.gameId).toBe('running');
  });
});

describe('choosing a game after the email and PIN were accepted', () => {
  beforeEach(async () => {
    await addGame('first', 'First game', 'ACTIVE');
    await addGame('second', 'Second game', 'ACTIVE');
    await addSeat('ana-first', 'first', '123456');
    await addSeat('ana-second', 'second', '123456');
  });

  test('an id that is not one of the email\'s own choices gets the generic 401 and no session', async () => {
    await addSeat('bo-first', 'first', '123456', { email: 'bo@pilot.test', displayName: 'Bo' });
    for (const choiceId of ['nobody', 'bo-first', 'first']) {
      const result = await signIn('ana@pilot.test', '123456', choiceId);
      expect(result.status).toBe(401);
      expect(result.body.error).toEqual(expect.stringContaining('Email or seat code and PIN were not accepted.'));
    }
    expect(shared.playerSessions).toEqual([]);
    expect(await failureBuckets()).toEqual([]);
  });

  test('the PIN is checked again for the chosen seat, and a wrong one counts against that seat only', async () => {
    expect((await signIn('ana@pilot.test', '000000', 'ana-second')).status).toBe(401);
    expect(await failureBuckets()).toEqual(['pin-failures:ana-second']);
    expect(shared.playerSessions).toEqual([]);
  });

  test('a locked seat stays locked even when it is chosen with the right PIN', async () => {
    await lock('ana-second');
    const result = await signIn('ana@pilot.test', '123456', 'ana-second');
    expect(result).toEqual({ status: 423, body: { ok: false, error: PIN_LOCKED_MESSAGE } });
    expect(shared.playerSessions).toEqual([]);
    // The other game is not affected by it.
    expect((await signIn('ana@pilot.test', '123456', 'ana-first')).status).toBe(200);
  });

  test('a choice id is ignored when signing in with a seat code', async () => {
    await client.execute({ sql: "UPDATE seats SET claim_code_hash = ? WHERE id = 'ana-first'", args: [await sha256('SEAT-FIRST')] });
    expect((await signIn('SEAT-FIRST', '123456', 'ana-second')).body.seat?.gameId).toBe('first');
  });
});

describe('a locked seat in a running game', () => {
  beforeEach(async () => {
    await addGame('old', 'Old game', 'COMPLETED');
    await addGame('running', 'Running game', 'ACTIVE');
    await addSeat('ana-old', 'old', '123456');
    await addSeat('ana-running', 'running', '123456');
    await lock('ana-running');
  });

  test('is reported, not hidden by quietly signing in to a finished game with the same PIN', async () => {
    expect(await signIn('ana@pilot.test', '123456')).toEqual({ status: 423, body: { ok: false, error: PIN_LOCKED_MESSAGE } });
    expect(shared.playerSessions).toEqual([]);
    // Nothing was counted against the finished game's seat, and the lock is untouched.
    expect(await failureBuckets()).toEqual(['pin-failures:ana-running']);
  });

  test('is reported when the locked running seat is a spectator seat too', async () => {
    await client.execute("DELETE FROM rate_limit_buckets");
    await client.execute("UPDATE seats SET status = 'REMOVED' WHERE id = 'ana-running'");
    await addSpectator('ana-watch', 'running', '123456');
    await lock('spectator:ana-watch');
    const result = await signIn('ana@pilot.test', '123456');
    expect(result.status).toBe(423);
    expect(shared.playerSessions).toEqual([]);
  });

  test('does not stop a sign-in to another game that is still going', async () => {
    await addGame('other', 'Other running game', 'ACTIVE');
    await addSeat('ana-other', 'other', '123456');
    expect((await signIn('ana@pilot.test', '123456')).body.seat?.gameId).toBe('other');
  });

  test('a locked seat in a finished game does not matter', async () => {
    await client.execute("DELETE FROM rate_limit_buckets");
    await lock('ana-old');
    await client.execute("UPDATE seats SET status = 'REMOVED' WHERE id = 'ana-running'");
    await addGame('other', 'Other running game', 'ACTIVE');
    await addSeat('ana-other', 'other', '123456');
    expect((await signIn('ana@pilot.test', '123456')).body.seat?.gameId).toBe('other');
  });
});

describe('the answer to a wrong email or PIN', () => {
  const sentence = 'After ten wrong PINs a seat is locked until a moderator resets it.';

  test('is the same for an email with a seat and an email without one, and says how the lock works', async () => {
    await addGame('running', 'Running game', 'ACTIVE');
    await addSeat('ana-running', 'running', '123456');
    const known = await signIn('ana@pilot.test', '000000');
    const unknown = await signIn('nobody@pilot.test', '000000');
    const byCode = await signIn('NOT-A-SEAT-CODE', '000000');
    expect(known.status).toBe(401);
    expect(known.body.error).toBe(`Email or seat code and PIN were not accepted. ${sentence}`);
    expect(unknown.body).toEqual(known.body);
    expect(byCode.body).toEqual(known.body);
  });

  test('matches the lock the game actually applies', () => {
    expect(PIN_LOCKOUT_ATTEMPTS).toBe(10);
    expect(PIN_LOCKED_MESSAGE).toContain('Ask your moderator to reset your PIN');
  });
});

describe('claiming a seat from an invitation', () => {
  async function invite(gameId: string, code: string) {
    await client.execute({
      sql: "INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,session_version,created_at,updated_at) VALUES (?,?,'Ana','ana@pilot.test','INVITED',?,1,'2026-01-01','2026-01-01')",
      args: [`seat-${gameId}`, gameId, await sha256(code)],
    });
  }
  const claim = (code: string) => claimPost(post(`/api/seats/claim/${code}`, { pin: '123456' }), { params: Promise.resolve({ code }) });

  test.each(['COMPLETED', 'STOPPED', 'CANCELLED'])('is refused when the game is %s, and the seat stays unclaimed', async (status) => {
    await addGame('dead', 'Dead game', status);
    await invite('dead', 'invite-dead');
    const response = await claim('invite-dead');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: CLAIM_GAME_ENDED });
    expect(CLAIM_GAME_ENDED).toBe('This game has ended, so its seats can no longer be claimed.');
    const seat = await client.execute("SELECT status, pin_hash FROM seats WHERE id = 'seat-dead'");
    expect(seat.rows[0]).toMatchObject({ status: 'INVITED', pin_hash: null });
    expect(shared.playerSessions).toEqual([]);
    expect((await client.execute("SELECT COUNT(*) AS count FROM game_events WHERE event_type = 'SEAT_CLAIMED'")).rows[0].count).toBe(0);
  });

  test.each(['REGISTRATION', 'ACTIVE'])('still works when the game is %s', async (status) => {
    await addGame('live', 'Live game', status);
    await invite('live', 'invite-live');
    const response = await claim('invite-live');
    expect(response.status).toBe(200);
    expect(shared.playerSessions).toEqual(['seat-live']);
    expect((await client.execute("SELECT status FROM seats WHERE id = 'seat-live'")).rows[0].status).toBe('CLAIMED');
  });

  test('a seat that is already claimed still gets the "already claimed" answer, even in a finished game', async () => {
    await addGame('dead', 'Dead game', 'COMPLETED');
    await addSeat('claimed-seat', 'dead', '123456');
    await client.execute({ sql: "UPDATE seats SET claim_code_hash = ? WHERE id = 'claimed-seat'", args: [await sha256('invite-claimed')] });
    const response = await claim('invite-claimed');
    expect(response.status).toBe(409);
    expect((await response.json() as { error: string }).error).toContain('already claimed');
  });

  test('a claimed seat in a game that has ended no longer collides with a later game, because it cannot be claimed twice', async () => {
    await addGame('old', 'Old game', 'COMPLETED');
    await addGame('running', 'Running game', 'ACTIVE');
    await invite('old', 'invite-old');
    await invite('running', 'invite-running');
    expect((await claim('invite-old')).status).toBe(409);
    expect((await claim('invite-running')).status).toBe(200);
    expect((await signIn('ana@pilot.test', '123456')).body.seat?.gameId).toBe('running');
  });
});
