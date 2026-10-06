import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../../db/libsql';
import { loadMigrations, runMigrations } from '../../scripts/db-migration-runner.mjs';

const shared = vi.hoisted(() => ({ db: null as LibsqlDatabase | null }));
vi.mock('../../db', () => ({ getDb: () => shared.db }));

import { BACKUPS_KEPT_PER_GAME, collectGameBackup, createBackupRecord, restoreGameBackup } from './snapshot';

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

  describe('keeping only the newest backups', () => {
    const stamp = (day: number) => `2020-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;

    /** Stores a backup and backdates it, so the order of several backups does not depend on the clock. */
    async function backup(gameId: string, day: number, keepBackupIds: string[] = []) {
      const { backupId } = await createBackupRecord(gameId, 'mod', { keepBackupIds });
      await client.execute({ sql: 'UPDATE backup_exports SET exported_at = ? WHERE id = ?', args: [stamp(day), backupId] });
      return backupId;
    }

    async function storedIds(gameId: string): Promise<string[]> {
      const rows = (await client.execute({ sql: 'SELECT id FROM backup_exports WHERE game_id = ?', args: [gameId] })).rows;
      return rows.map((row) => String(row.id));
    }

    test('a game keeps its newest five backups and saving another deletes the oldest', async () => {
      expect(BACKUPS_KEPT_PER_GAME).toBe(5);
      const ids: string[] = [];
      for (let day = 1; day <= 7; day += 1) ids.push(await backup('game', day));
      expect((await storedIds('game')).sort()).toEqual(ids.slice(2).sort());
    });

    test('another game\'s backups are never touched', async () => {
      await client.execute("INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('other','Other','REGISTRATION','UTC','2026-01-01','2027-01-01','[1]','{}','2026-06-01','mod','2026-01-01','2026-01-01')");
      for (let day = 1; day <= 6; day += 1) await client.execute({ sql: "INSERT INTO backup_exports (id, game_id, moderator_id, schema_version, checksum, payload_json, exported_at) VALUES (?, 'other', 'mod', 2, 'x', '{}', ?)", args: [`other-${day}`, stamp(day)] });
      for (let day = 1; day <= 6; day += 1) await backup('game', day);
      expect(await storedIds('other')).toHaveLength(6);
      expect(await storedIds('game')).toHaveLength(5);
    });

    test('a backup named to be kept survives even when it is the oldest', async () => {
      const oldest = await backup('game', 1);
      for (let day = 2; day <= 5; day += 1) await backup('game', day);
      await backup('game', 6, [oldest]);
      const kept = await storedIds('game');
      expect(kept).toContain(oldest);
      expect(kept).toHaveLength(6);
    });

    test('restoring from the oldest stored backup does not delete it', async () => {
      for (let index = 1; index <= 5; index += 1) {
        await client.execute({ sql: "INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,created_at,updated_at) VALUES (?, 'game', ?, ?, 'INVITED', ?, '2026-01-01', '2026-01-01')", args: [`seat-${index}`, `Player ${index}`, `player${index}@pilot.test`, `claim-${index}`] });
      }
      const source = await backup('game', 1);
      for (let day = 2; day <= 5; day += 1) await backup('game', day);
      const stored = (await client.execute({ sql: 'SELECT checksum, payload_json AS payloadJson, schema_version AS schemaVersion FROM backup_exports WHERE id = ?', args: [source] })).rows[0];
      await restoreGameBackup('game', { id: source, gameId: 'game', schemaVersion: Number(stored.schemaVersion), checksum: String(stored.checksum), payloadJson: String(stored.payloadJson) }, 'mod', 'http://localhost:3000');
      const after = await storedIds('game');
      expect(after).toContain(source);
      expect(after).toHaveLength(6);
    });
  });

  test('refuses a game that does not exist', async () => {
    await expect(collectGameBackup('missing')).rejects.toThrow('Game not found.');
  });
});
