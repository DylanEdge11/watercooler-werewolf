import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../../db/libsql';
import { loadMigrations, runMigrations } from '../../scripts/db-migration-runner.mjs';

const shared = vi.hoisted(() => ({ db: null as LibsqlDatabase | null }));
vi.mock('../../db', () => ({ getDb: () => shared.db }));

import { collectGameBackup, createBackupRecord, restoreGameBackup } from './snapshot';

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

  test('leaves out the public sign-up link, which is a live invitation to the game', async () => {
    await client.execute("UPDATE games SET signup_state = 'OPEN', signup_code = 'public-join-secret' WHERE id = 'game'");
    const backup = await collectGameBackup('game');
    expect(JSON.stringify(backup)).not.toContain('public-join-secret');
    expect(backup.game).not.toHaveProperty('signup_code');
  });

  test('restoring a backup starts the run unpaused and with the next phase no longer opening by itself', async () => {
    // A backup can be restored only with a real roster: six to eighty seats.
    for (let index = 1; index <= 5; index += 1) {
      await client.execute({ sql: "INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,created_at,updated_at) VALUES (?, 'game', ?, ?, 'INVITED', ?, '2026-01-01', '2026-01-01')", args: [`seat-${index}`, `Player ${index}`, `player${index}@pilot.test`, `hash-${index}`] });
    }
    const { backupId, checksum } = await createBackupRecord('game', 'mod');
    const stored = (await client.execute({ sql: 'SELECT payload_json AS payloadJson, schema_version AS schemaVersion FROM backup_exports WHERE id = ?', args: [backupId] })).rows[0];
    await client.execute("UPDATE games SET auto_open_next_phase = 1, automation_paused_at = '2026-01-02T00:00:00.000Z' WHERE id = 'game'");
    await restoreGameBackup('game', { id: backupId, gameId: 'game', schemaVersion: Number(stored.schemaVersion), checksum, payloadJson: String(stored.payloadJson) }, 'mod', 'http://localhost:3000');
    expect((await client.execute("SELECT auto_open_next_phase AS autoOpen, automation_paused_at AS paused, status FROM games WHERE id = 'game'")).rows[0]).toMatchObject({ autoOpen: 0, paused: null, status: 'DRAFT' });
  });

  test('refuses a game that does not exist', async () => {
    await expect(collectGameBackup('missing')).rejects.toThrow('Game not found.');
  });
});
