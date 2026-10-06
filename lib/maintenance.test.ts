import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import type { Database, PreparedStatement } from '../db/contracts';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';
import { purgeExpiredRows } from './maintenance';

const NOW = new Date('2026-10-06T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60_000;
const daysAgo = (days: number) => new Date(NOW.valueOf() - days * DAY_MS).toISOString();

let client: Client;

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  await client.batch(
    [
      { sql: "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','mod@pilot.test','fake','[]','2026-01-01','2026-01-01')", args: [] },
      { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Review','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')", args: [] },
    ],
    'write',
  );
});

afterEach(() => client.close());

async function logEvent(id: string, severity: string, source: string, createdAt: string) {
  await client.execute({
    sql: "INSERT INTO operational_events (id, game_id, severity, source, message, details_json, created_at) VALUES (?, 'game', ?, ?, 'x', '{}', ?)",
    args: [id, severity, source, createdAt],
  });
}

async function remainingEventIds(): Promise<string[]> {
  const rows = await client.execute('SELECT id FROM operational_events ORDER BY id');
  return rows.rows.map((row) => String(row.id));
}

describe('event-log retention', () => {
  test('removes late-attempt rows older than 30 days and keeps newer ones, including the 30-day mark itself', async () => {
    await logEvent('late-old', 'WARNING', 'DEADLINE_MONITOR', daysAgo(31));
    await logEvent('late-at-cutoff', 'WARNING', 'DEADLINE_MONITOR', daysAgo(30));
    await logEvent('late-recent', 'WARNING', 'DEADLINE_MONITOR', daysAgo(2));
    const result = await purgeExpiredRows(new LibsqlDatabase(client as unknown as LibsqlClient), NOW);
    expect(result.lateAttemptEvents).toBe(1);
    expect(await remainingEventIds()).toEqual(['late-at-cutoff', 'late-recent']);
  });

  test('keeps every other kind of event however old: they are the moderators’ audit trail', async () => {
    const audit: Array<[string, string, string]> = [
      ['email', 'INFO', 'EMAIL'],
      ['email-failed', 'WARNING', 'EMAIL'],
      ['scheduler', 'INFO', 'SCHEDULER'],
      ['automation', 'WARNING', 'AUTOMATION'],
      ['control', 'WARNING', 'GAME_CONTROL'],
      ['feedback', 'INFO', 'PILOT_FEEDBACK'],
      ['chat', 'WARNING', 'CHAT_MODERATION'],
      ['pin-reset', 'WARNING', 'SPECTATOR_ACCESS'],
    ];
    for (const [id, severity, source] of audit) await logEvent(id, severity, source, daysAgo(400));
    const result = await purgeExpiredRows(new LibsqlDatabase(client as unknown as LibsqlClient), NOW);
    expect(result.lateAttemptEvents).toBe(0);
    expect(await remainingEventIds()).toEqual(audit.map(([id]) => id).sort());
  });

  test('deletes through an index, never by scanning every game’s events', async () => {
    const statements: string[] = [];
    const real = new LibsqlDatabase(client as unknown as LibsqlClient);
    const recording: Database = {
      prepare: (sql: string): PreparedStatement => {
        statements.push(sql);
        return real.prepare(sql);
      },
      batch: (items, mode) => real.batch(items, mode),
    };
    await purgeExpiredRows(recording, NOW);
    const purge = statements.find((sql) => sql.includes('operational_events'));
    expect(purge).toBeDefined();
    const plan = await client.execute({ sql: `EXPLAIN QUERY PLAN ${purge}`, args: [daysAgo(30)] });
    const detail = plan.rows.map((row) => String(row.detail)).join(' | ');
    expect(detail).toContain('USING INDEX');
    expect(detail).not.toMatch(/\bSCAN operational_events\b/u);
  });
});
