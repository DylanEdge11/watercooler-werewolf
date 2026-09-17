import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../../db/libsql';
import { bootstrapPrimaryModerator } from './bootstrap';
import { loadMigrations, runMigrations } from '../../scripts/db-migration-runner.mjs';

let client: Client;

function database(): LibsqlDatabase {
  return new LibsqlDatabase(client as unknown as LibsqlClient);
}

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
});

afterEach(() => client.close());

describe('operator-owned moderator bootstrap', () => {
  test('creates the singleton marker and account atomically under contention', async () => {
    const db = database();
    const results = await Promise.allSettled([
      bootstrapPrimaryModerator(db, 'Owner@pilot.test', 'fictional-owner-password'),
      bootstrapPrimaryModerator(db, 'Other@pilot.test', 'fictional-other-password'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const created = results.find((result) => result.status === 'fulfilled');
    if (!created || created.status !== 'fulfilled') throw new Error('Expected one successful bootstrap.');
    expect(['owner@pilot.test', 'other@pilot.test']).toContain(created.value.email);
    expect(created.value.recoveryCodes).toHaveLength(8);

    const account = await client.execute('SELECT email, password_hash AS passwordHash, recovery_codes_json AS recoveryCodes FROM moderator_accounts');
    expect(account.rows).toHaveLength(1);
    expect(['owner@pilot.test', 'other@pilot.test']).toContain(account.rows[0]?.email);
    expect(String(account.rows[0]?.passwordHash)).not.toContain('fictional-owner-password');
    expect(String(account.rows[0]?.passwordHash)).not.toContain('fictional-other-password');
    expect(String(account.rows[0]?.recoveryCodes)).not.toContain(created.value.recoveryCodes[0]);
    const marker = await client.execute('SELECT COUNT(*) AS count FROM app_bootstrap');
    expect(Number(marker.rows[0]?.count)).toBe(1);
  });

  test('cannot be invoked a second time after the marker is committed', async () => {
    const db = database();
    await bootstrapPrimaryModerator(db, 'owner@pilot.test', 'fictional-owner-password');
    await expect(
      bootstrapPrimaryModerator(db, 'owner@pilot.test', 'fictional-owner-password'),
    ).rejects.toThrow('already exists');
  });
});
