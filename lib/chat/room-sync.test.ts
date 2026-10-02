import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../../db/libsql';
import { loadMigrations, runMigrations } from '../../scripts/db-migration-runner.mjs';
import { ROLE_KEYS } from '../game/types';
import { allowedRoomTypes } from './policy';

const shared = vi.hoisted(() => ({ db: null as LibsqlDatabase | null }));
vi.mock('../../db', () => ({ getDb: () => shared.db }));

import { ensureGameRooms, ensureGameRoomsExist } from './rooms';

let client: Client;

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  await client.batch([
    { sql: "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','x','[]','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Rooms','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2026-12-01','mod','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO assignment_batches (id,game_id,revision,assignments_json,random_evidence_hash,created_by_moderator_id,created_at) VALUES ('batch','game',1,'[]','hash','mod','2026-01-01')", args: [] },
  ], 'write');
  // One claimed seat for every role, alive and eliminated.
  for (const role of ROLE_KEYS) {
    for (const alive of [1, 0]) {
      const id = `${role}-${alive}`;
      await client.batch([
        { sql: "INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,alive,created_at,updated_at) VALUES (?,'game',?,?,'CLAIMED',?,?,'2026-01-01','2026-01-01')", args: [id, id, `${id.toLowerCase()}@pilot.test`, `claim-${id}`, alive] },
        { sql: "INSERT INTO role_assignments (game_id,seat_id,role_key,assignment_batch_id) VALUES ('game',?,?,'batch')", args: [id, role] },
      ], 'write');
    }
  }
});

afterEach(() => {
  shared.db = null;
  client.close();
  vi.restoreAllMocks();
});

async function memberships(): Promise<string[]> {
  const rows = (await client.execute(
    `SELECT cr.type, crm.seat_id AS seatId, crm.access, crm.revoked_at IS NOT NULL AS revoked
     FROM chat_room_members crm JOIN chat_rooms cr ON cr.id = crm.room_id ORDER BY crm.seat_id, cr.type`,
  )).rows;
  return rows.map((row) => `${row.seatId} ${row.type} ${row.access}${Number(row.revoked) ? ' revoked' : ''}`);
}

describe('room sync', () => {
  test('memberships match allowedRoomTypes for every role, alive or eliminated', async () => {
    await ensureGameRooms('game');
    const expected = ROLE_KEYS.flatMap((role) => [1, 0].flatMap((alive) =>
      allowedRoomTypes(role, Boolean(alive)).map((type) => {
        const access = !alive && type !== 'DEAD' ? 'READ_ONLY' : 'WRITE';
        return `${role}-${alive} ${type} ${access}${access === 'READ_ONLY' ? ' revoked' : ''}`;
      }),
    ));
    expect(await memberships()).toEqual(expected.sort());
  });

  test('an elimination moves a Werewolf to read-only in the pack room and Town Hall and into the Afterlife, and a repeat sync changes nothing', async () => {
    await ensureGameRooms('game');
    await client.execute("UPDATE seats SET alive = 0 WHERE id = 'WEREWOLF-1'");
    await ensureGameRooms('game');
    expect((await memberships()).filter((line) => line.startsWith('WEREWOLF-1 '))).toEqual(['WEREWOLF-1 DEAD WRITE', 'WEREWOLF-1 TOWN_HALL READ_ONLY revoked', 'WEREWOLF-1 WEREWOLF READ_ONLY revoked']);
    const snapshot = async () => (await client.execute('SELECT room_id, seat_id, access, granted_at, revoked_at FROM chat_room_members ORDER BY room_id, seat_id')).rows;
    const before = await snapshot();
    await ensureGameRooms('game');
    expect(await snapshot()).toEqual(before);
  });

  test('the read-side safety net creates missing rooms once and otherwise only reads', async () => {
    await ensureGameRoomsExist('game');
    expect((await client.execute("SELECT COUNT(*) AS count FROM chat_rooms WHERE game_id = 'game'")).rows[0].count).toBe(4);
    const batch = vi.spyOn(shared.db!, 'batch');
    await ensureGameRoomsExist('game');
    expect(batch).not.toHaveBeenCalled();
  });
});
