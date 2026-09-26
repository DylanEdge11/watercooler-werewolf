import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../../db/libsql';
import { loadMigrations, runMigrations } from '../../scripts/db-migration-runner.mjs';

const shared = vi.hoisted(() => ({ db: null as LibsqlDatabase | null }));
vi.mock('../../db', () => ({ getDb: () => shared.db }));

import { collectGameBackup } from './snapshot';

let client: Client;

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  await client.batch([
    { sql: "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','x','[]','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Backup','REGISTRATION','UTC','2026-01-01','2027-01-01','[1]','{}','2026-06-01','mod','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01')", args: [] },
    { sql: "INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,pin_hash,created_at,updated_at) VALUES ('ana','game','Ana','ana@pilot.test','CLAIMED','claim-secret','pin-secret','2026-01-01','2026-01-01')", args: [] },
  ], 'write');
});

afterEach(() => {
  shared.db = null;
  client.close();
});

describe('game backup', () => {
  test('reads every table in one read-only transaction and never includes secrets', async () => {
    const batch = vi.spyOn(shared.db!, 'batch');
    const backup = await collectGameBackup('game');
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][1]).toBe('read');
    expect(backup.game).toMatchObject({ id: 'game', name: 'Backup' });
    expect(backup.moderators).toEqual([expect.objectContaining({ id: 'mod', role: 'OWNER' })]);
    expect(backup.seats).toEqual([expect.objectContaining({ id: 'ana', displayName: 'Ana' })]);
    expect(JSON.stringify(backup)).not.toMatch(/claim-secret|pin-secret/u);
  });

  test('refuses a game that does not exist', async () => {
    await expect(collectGameBackup('missing')).rejects.toThrow('Game not found.');
  });
});
