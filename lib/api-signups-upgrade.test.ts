import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';

/*
 * Games that existed before sign-ups were added. Their data is written with the schema as it stood
 * at migration 0011, then migration 0012 is applied on top, exactly as the Production database
 * will be. Nothing about those games may change unless a moderator turns the new features on.
 */

const shared = vi.hoisted(() => ({
  db: null as LibsqlDatabase | null,
  moderator: null as { id: string; email: string } | null,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('./auth/session', () => ({
  getCurrentModerator: async () => shared.moderator,
  createModeratorSession: async () => {},
  preparePlayerSession: async (seatId: string, version: number) => ({
    values: [crypto.randomUUID(), seatId, `token-${seatId}`, version, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    setCookie: async () => {},
  }),
}));

import { POST as applicationsPost } from '../app/api/games/[gameId]/applications/route';
import { POST as signupsPost } from '../app/api/games/[gameId]/signups/route';
import { POST as rosterPost } from '../app/api/games/[gameId]/roster/route';
import { POST as seatsPost } from '../app/api/games/[gameId]/seats/route';
import { DELETE as seatDelete } from '../app/api/games/[gameId]/seats/[seatId]/route';
import { GET as joinGet } from '../app/api/join/[code]/route';
import { POST as claimPost } from '../app/api/seats/claim/[code]/route';
import { sha256 } from './auth/crypto';
import { defaultComposition } from './game/balance';
import { ROLE_KEYS } from './game/types';
import { loadAssignmentsView, loadRosterView } from './game/setup-view';
import { createBackupRecord, restoreGameBackup } from './backup/snapshot';

let client: Client;
const ORIGIN = 'http://localhost:3000';

function request(method: string, body?: unknown): Request {
  return new Request(`${ORIGIN}/api/test`, {
    method,
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

interface Reply { status: number; body: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
const read = async (response: Response): Promise<Reply> => ({ status: response.status, body: await response.json() as Record<string, any> }); // eslint-disable-line @typescript-eslint/no-explicit-any
const ctx = (gameId: string) => ({ params: Promise.resolve({ gameId }) });

async function rows(sql: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  return (await client.execute({ sql, args })).rows as unknown as Array<Record<string, unknown>>;
}
const count = async (sql: string, args: Array<string | number> = []) => Number((await rows(sql, args))[0]?.count);

const COMPOSITION_8 = defaultComposition(8);

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  const all = await loadMigrations();
  // The database as Production has it today: every migration up to 0011.
  await runMigrations(client, all.filter((migration: { version: string }) => migration.version < '0012'));
  const seat = (id: string, game: string, status: string, n: number) => ({
    sql: 'INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,pin_hash,session_version,alive,claimed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,1,?,?,?)',
    args: [id, game, `Player ${n}`, `${id}@legacy.test`, status, `hash-${id}`, status === 'CLAIMED' ? 'pin-hash' : null, status === 'CLAIMED' ? '2026-01-02' : null, '2026-01-01', '2026-01-02'],
  });
  await client.batch([
    { sql: "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('owner','owner@legacy.test','x','[]','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,setup_revision,created_by_moderator_id,created_at,updated_at) VALUES ('setup','Legacy setup','REGISTRATION','UTC','2026-03-02','2026-04-03','[1,2,3,4,5]','{}','2026-04-01',4,'owner','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('live','Legacy running game','ACTIVE','UTC','2026-01-05','2026-02-06','[1,2,3,4,5]','{}','2099-02-01','owner','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('setup','owner','OWNER','2026-01-01'), ('live','owner','OWNER','2026-01-01')", args: [] },
    // The setup game: 8 players, six have claimed. The running game: 6 claimed players.
    ...[1, 2, 3, 4, 5, 6].map((n) => seat(`s${n}`, 'setup', 'CLAIMED', n)),
    ...[7, 8].map((n) => seat(`s${n}`, 'setup', 'INVITED', n)),
    ...[1, 2, 3, 4, 5, 6].map((n) => seat(`l${n}`, 'live', 'CLAIMED', n)),
    ...ROLE_KEYS.map((role) => ({ sql: "INSERT INTO game_role_counts (game_id,role_key,count,power_snapshot) VALUES ('setup', ?, ?, 0)", args: [role, COMPOSITION_8[role]] })),
  ], 'write');
  // The new migration, applied over those games.
  await runMigrations(client, all);
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  shared.moderator = { id: 'owner', email: 'owner@legacy.test' };
});

afterEach(() => {
  shared.db = null;
  shared.moderator = null;
  client.close();
});

describe('games that existed before sign-ups', () => {
  test('keep every row, and the new settings start switched off', async () => {
    expect(await count('SELECT COUNT(*) AS count FROM seats')).toBe(14);
    expect(await rows("SELECT status, COUNT(*) AS count FROM seats WHERE game_id = 'setup' GROUP BY status ORDER BY status")).toEqual([{ status: 'CLAIMED', count: 6 }, { status: 'INVITED', count: 2 }]);
    expect(await rows("SELECT name, status, setup_revision AS revision FROM games ORDER BY id")).toEqual([
      { name: 'Legacy running game', status: 'ACTIVE', revision: 1 },
      { name: 'Legacy setup', status: 'REGISTRATION', revision: 4 },
    ]);
    expect(await rows('SELECT id, signup_state AS state, signup_code AS code, signup_note AS note, moderator_applications_open AS applications FROM games ORDER BY id')).toEqual([
      { id: 'live', state: 'NOT_OPEN', code: null, note: null, applications: 0 },
      { id: 'setup', state: 'NOT_OPEN', code: null, note: null, applications: 0 },
    ]);
    expect(await count('SELECT COUNT(*) AS count FROM signups')).toBe(0);
    expect(await count('SELECT COUNT(*) AS count FROM moderator_applications')).toBe(0);
  });

  test('look the same to the console, with sign-ups reported as not in use', async () => {
    const view = await loadRosterView('setup');
    expect(view.roster).toHaveLength(8);
    expect(view.composition.map((row) => [row.roleKey, Number((row as Record<string, unknown>).count)]).filter(([, value]) => Number(value) > 0).sort()).toEqual(
      ROLE_KEYS.filter((role) => COMPOSITION_8[role] > 0).map((role) => [role, COMPOSITION_8[role]]).sort(),
    );
    expect(view.signups).toEqual({ state: 'NOT_OPEN', live: false, pending: 0, accepted: 0, applicationsOpen: false, pendingApplications: 0 });
    expect((await loadAssignmentsView('setup')).game).toEqual({ status: 'REGISTRATION', setupRevision: 4 });
    expect((await loadRosterView('live')).signups).toMatchObject({ state: 'NOT_OPEN', pending: 0 });
  });

  test('have no public link, so nobody can sign up to them by guessing', async () => {
    for (const code of ['setup', 'live', 'legacy-setup', 'AAAAAAAAAAAA']) {
      expect((await read(await joinGet(request('GET'), { params: Promise.resolve({ code }) }))).status).toBe(404);
    }
  });

  test('a running game cannot be opened for sign-ups, and takes applications only if the owner turns them on', async () => {
    expect(await read(await signupsPost(request('POST', { action: 'OPEN' }), ctx('live')))).toMatchObject({ status: 409 });
    expect(await rows("SELECT signup_state AS state FROM games WHERE id = 'live'")).toEqual([{ state: 'NOT_OPEN' }]);
    expect(await read(await applicationsPost(request('POST', { action: 'OPEN' }), ctx('live')))).toMatchObject({ status: 200, body: { open: true } });
    expect(await read(await applicationsPost(request('POST', { action: 'CLOSE' }), ctx('live')))).toMatchObject({ status: 200, body: { open: false } });
  });

  test('keep working the way they did: claim, add a player, remove a player, replace the roster', async () => {
    // A player who never claimed uses the link they already had.
    await client.execute({ sql: "UPDATE seats SET claim_code_hash = ? WHERE id = 's7'", args: [await sha256('legacy-code-7')] });
    const claimed = await read(await claimPost(request('POST', { pin: '246810' }), { params: Promise.resolve({ code: 'legacy-code-7' }) }));
    expect(claimed).toMatchObject({ status: 200, body: { ok: true, seat: { displayName: 'Player 7' } } });
    expect(await rows("SELECT status FROM seats WHERE id = 's7'")).toEqual([{ status: 'CLAIMED' }]);

    // One more player by hand: one Villager more, exactly as before.
    const added = await read(await seatsPost(request('POST', { displayName: 'Late Larry', email: 'larry@legacy.test' }), ctx('setup')));
    expect(added).toMatchObject({ status: 200, body: { ok: true, playerCount: 9, resetToPreset: false } });
    expect((await rows("SELECT count FROM game_role_counts WHERE game_id = 'setup' AND role_key = 'VILLAGER'"))[0].count).toBe(COMPOSITION_8.VILLAGER + 1);

    // And one fewer: the unclaimed player is archived, one Villager goes.
    const removed = await read(await seatDelete(request('DELETE'), { params: Promise.resolve({ gameId: 'setup', seatId: 's8' }) }));
    expect(removed).toMatchObject({ status: 200, body: { ok: true, playerCount: 8 } });
    expect(await rows("SELECT status FROM seats WHERE id = 's8'")).toEqual([{ status: 'REMOVED' }]);

    // A fresh list replaces the roster, as it always has.
    const csv = ['display_name,email', ...Array.from({ length: 6 }, (_, index) => `New ${index},new${index}@legacy.test`)].join('\n');
    const imported = await read(await rosterPost(request('POST', { csv }), ctx('setup')));
    expect(imported).toMatchObject({ status: 200, body: { ok: true, playerCount: 6 } });
    expect(await count("SELECT COUNT(*) AS count FROM seats WHERE game_id = 'setup' AND status != 'REMOVED'")).toBe(6);
    expect((await read(await signupsPost(request('POST', { action: 'CLOSE' }), ctx('setup')))).status).toBe(409);
  });

  test('back up and restore with a backup file made before sign-ups existed', async () => {
    const { backupId, checksum } = await createBackupRecord('setup', 'owner');
    const stored = (await rows('SELECT payload_json AS payload, schema_version AS version FROM backup_exports WHERE id = ?', [backupId]))[0];
    // Production's backups have none of the new fields on the game row.
    const payload = JSON.parse(String(stored.payload)) as { game: Record<string, unknown> };
    for (const key of ['signup_state', 'signup_code', 'signup_note', 'moderator_applications_open']) delete payload.game[key];
    const oldFormat = JSON.stringify(payload);
    expect(checksum).not.toBe(await sha256(oldFormat));
    await restoreGameBackup('setup', { id: backupId, gameId: 'setup', schemaVersion: Number(stored.version), checksum: await sha256(oldFormat), payloadJson: oldFormat }, 'owner', ORIGIN);
    expect(await rows("SELECT status, signup_state AS state, signup_code AS code FROM games WHERE id = 'setup'")).toEqual([{ status: 'DRAFT', state: 'NOT_OPEN', code: null }]);
    expect(await count("SELECT COUNT(*) AS count FROM seats WHERE game_id = 'setup' AND status != 'REMOVED'")).toBe(8);
  });
});
