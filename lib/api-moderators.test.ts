import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';

const shared = vi.hoisted(() => ({
  db: null as LibsqlDatabase | null,
  moderator: null as { id: string; email: string } | null,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('./auth/session', () => ({ getCurrentModerator: async () => shared.moderator }));

import { GET as moderatorsGet, POST as moderatorsPost } from '../app/api/games/[gameId]/moderators/route';
import { DELETE as moderatorDelete, PATCH as moderatorPatch } from '../app/api/games/[gameId]/moderators/[moderatorId]/route';
import { transferOwnershipStatements } from './auth/game-moderators';

let client: Client;

const as = (id: string) => { shared.moderator = { id, email: `${id}@pilot.test` }; };

function request(method: string, body?: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/games/game/moderators', {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function read(response: Response) {
  return { status: response.status, body: await response.json() as { ok: boolean; error?: string } };
}

const remove = async (moderatorId: string) => read(await moderatorDelete(request('DELETE'), { params: Promise.resolve({ gameId: 'game', moderatorId }) }));
const makeOwner = async (moderatorId: string) => read(await moderatorPatch(request('PATCH', { role: 'OWNER' }), { params: Promise.resolve({ gameId: 'game', moderatorId }) }));

async function roles(): Promise<Record<string, string>> {
  const rows = (await client.execute("SELECT moderator_id, role FROM game_moderators WHERE game_id = 'game'")).rows;
  return Object.fromEntries(rows.map((row) => [String(row.moderator_id), String(row.role)]));
}

async function events(type: string): Promise<Array<{ actor: string; payload: string }>> {
  const rows = (await client.execute({ sql: 'SELECT actor_moderator_id AS actor, payload_json AS payload FROM game_events WHERE event_type = ?', args: [type] })).rows;
  return rows.map((row) => ({ actor: String(row.actor), payload: String(row.payload) }));
}

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  const account = (id: string) => ({ sql: `INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('${id}','${id}@pilot.test','x','[]','2026-01-01','2026-01-01')`, args: [] });
  await client.batch([
    account('owner'), account('cora'), account('dev'),
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Moderators','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2026-12-01','owner','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','owner','OWNER','2026-01-01'), ('game','cora','CO_MODERATOR','2026-01-01'), ('game','dev','CO_MODERATOR','2026-01-01')", args: [] },
  ], 'write');
  as('owner');
});

afterEach(() => {
  shared.db = null;
  shared.moderator = null;
  client.close();
});

describe('removing a co-moderator', () => {
  test('the owner removes a co-moderator, who then loses access to the game at once', async () => {
    expect(await remove('cora')).toEqual({ status: 200, body: { ok: true } });
    expect(await roles()).toEqual({ owner: 'OWNER', dev: 'CO_MODERATOR' });
    expect(await events('CO_MODERATOR_REMOVED')).toEqual([{ actor: 'owner', payload: JSON.stringify({ moderatorId: 'cora', email: 'cora@pilot.test' }) }]);
    // The account stays, for their other games or to be added back.
    expect((await client.execute("SELECT COUNT(*) AS count FROM moderator_accounts WHERE id = 'cora'")).rows[0].count).toBe(1);
    as('cora');
    expect((await moderatorsGet(request('GET'), { params: Promise.resolve({ gameId: 'game' }) })).status).toBe(403);
  });

  test('a repeated removal is a 409 that records nothing more', async () => {
    await remove('cora');
    expect(await remove('cora')).toEqual({ status: 409, body: expect.objectContaining({ error: expect.stringContaining('no longer a co-moderator') }) });
    expect(await events('CO_MODERATOR_REMOVED')).toHaveLength(1);
  });

  test('the owner cannot remove themselves, and a co-moderator cannot remove anyone', async () => {
    expect((await remove('owner')).status).toBe(400);
    as('cora');
    expect(await remove('dev')).toEqual({ status: 403, body: { ok: false, error: 'Only the game owner can remove co-moderators.' } });
    expect(await roles()).toEqual({ owner: 'OWNER', cora: 'CO_MODERATOR', dev: 'CO_MODERATOR' });
  });
});

describe('transferring ownership', () => {
  test('the owner makes a co-moderator the owner and stays on as a co-moderator', async () => {
    expect(await makeOwner('cora')).toEqual({ status: 200, body: { ok: true } });
    expect(await roles()).toEqual({ owner: 'CO_MODERATOR', cora: 'OWNER', dev: 'CO_MODERATOR' });
    expect(await events('OWNERSHIP_TRANSFERRED')).toEqual([{ actor: 'owner', payload: JSON.stringify({ moderatorId: 'cora', email: 'cora@pilot.test' }) }]);
    // The previous owner has only co-moderator powers now; the new owner has all of them.
    expect((await remove('dev')).status).toBe(403);
    as('cora');
    expect((await remove('owner')).status).toBe(200);
    expect(await roles()).toEqual({ cora: 'OWNER', dev: 'CO_MODERATOR' });
  });

  test('only a transfer is accepted, and only to a current co-moderator', async () => {
    expect((await read(await moderatorPatch(request('PATCH', { role: 'CO_MODERATOR' }), { params: Promise.resolve({ gameId: 'game', moderatorId: 'cora' }) }))).status).toBe(400);
    expect((await makeOwner('owner')).status).toBe(400);
    expect((await makeOwner('stranger')).status).toBe(409);
    expect(await roles()).toEqual({ owner: 'OWNER', cora: 'CO_MODERATOR', dev: 'CO_MODERATOR' });
    expect(await events('OWNERSHIP_TRANSFERRED')).toEqual([]);
  });

  test('a transfer that lost a race to another transfer changes nothing', async () => {
    await makeOwner('cora');
    // A second transfer the old owner started before the first landed: its write re-checks ownership.
    const db = shared.db!;
    const results = await db.batch(transferOwnershipStatements(db, { gameId: 'game', ownerId: 'owner', moderatorId: 'dev', eventId: 'late', now: '2026-09-26T00:00:00.000Z' }));
    expect(results.map((result) => (result as { meta?: { changes?: number } }).meta?.changes ?? 0)).toEqual([0, 0, 0]);
    expect(await roles()).toEqual({ owner: 'CO_MODERATOR', cora: 'OWNER', dev: 'CO_MODERATOR' });
  });
});

describe('adding a co-moderator', () => {
  test('adding someone who is already a moderator here is a 409 with no second event', async () => {
    const add = async (email: string) => read(await moderatorsPost(request('POST', { email, password: 'fictional-password-2026' }), { params: Promise.resolve({ gameId: 'game' }) }));
    expect((await add('new@pilot.test')).status).toBe(200);
    expect(await add('cora@pilot.test')).toEqual({ status: 409, body: { ok: false, error: 'cora@pilot.test is already a moderator of this game.' } });
    expect((await events('CO_MODERATOR_ADDED')).map((event) => JSON.parse(event.payload).email)).toEqual(['new@pilot.test']);
  });
});
