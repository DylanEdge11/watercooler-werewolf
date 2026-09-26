import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../../db/libsql';
import { loadMigrations, runMigrations } from '../../scripts/db-migration-runner.mjs';

const shared = vi.hoisted(() => ({ db: null as LibsqlDatabase | null }));
vi.mock('../../db', () => ({ getDb: () => shared.db }));

import { loadDashboard } from './dashboard-data';

let client: Client;
const exec = (sql: string, args: Array<string | number | null> = []) => client.execute({ sql, args });

async function publishDay(id: string, sequence: number, createdAt: string, voters: string[]): Promise<void> {
  await exec("INSERT INTO phases (id,game_id,sequence,kind,status,opens_at,closes_at,slots,divisor_snapshot,created_at,updated_at,published_at) VALUES (?,'game',?,'DAY','PUBLISHED',?,?,1,30,?,?,?)", [id, sequence, createdAt, createdAt, createdAt, createdAt, createdAt]);
  for (const voter of voters) {
    await exec("INSERT INTO action_submissions (id,phase_id,actor_seat_id,kind,target_ids_json,version,submitted_at) VALUES (?,?,?,'DAY_VOTE','[\"s2\"]',1,?)", [`${id}-${voter}`, id, voter, createdAt]);
  }
  await exec("INSERT INTO game_events (id,game_id,event_type,phase_id,payload_json,created_at) VALUES (?,'game','PHASE_PUBLISHED',?,?,?)", [`published-${id}`, id, JSON.stringify({ kind: 'DAY', eliminations: [], winner: null }), createdAt]);
}

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  await exec("INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','x','[]','2026-01-01','2026-01-01')");
  await exec("INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Dashboard','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')");
  for (const seat of ['s1', 's2', 's3']) {
    await exec("INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,created_at,updated_at) VALUES (?,'game',?,?,'CLAIMED',?,'2026-01-01','2026-01-01')", [seat, `Player ${seat}`, `${seat}@pilot.test`, `claim-${seat}`]);
  }
});

afterEach(() => {
  shared.db = null;
  client.close();
});

describe('loadDashboard', () => {
  test('shows only the events after the latest reset, plus same-instant events that are not the reset', async () => {
    await publishDay('before', 1, '2026-01-02T10:00:00.000Z', ['s1']);
    await exec("INSERT INTO game_events (id,game_id,event_type,payload_json,created_at) VALUES ('reset','game','GAME_RESET','{}','2026-01-03T00:00:00.000Z')");
    await exec("INSERT INTO game_events (id,game_id,event_type,payload_json,created_at) VALUES ('same-instant','game','ANNOUNCEMENT','{\"title\":\"Welcome back\",\"body\":\"New run\"}','2026-01-03T00:00:00.000Z')");
    await publishDay('after', 2, '2026-01-04T10:00:00.000Z', ['s1', 's3']);

    const dashboard = await loadDashboard('s1');
    expect(dashboard?.timeline.map((event) => event.id)).toEqual(['published-after', 'same-instant']);
    const published = dashboard?.timeline[0].payload as { votes?: Array<{ actorName: string; targetNames: string[] }> };
    expect(published.votes).toEqual([
      { actorName: 'Player s1', targetNames: ['Player s2'] },
      { actorName: 'Player s3', targetNames: ['Player s2'] },
    ]);
  });

  test('returns votes only for Days in the timeline it returns', async () => {
    await publishDay('old-day', 1, '2026-01-02T10:00:00.000Z', ['s1', 's3']);
    // 100 newer announcements push the old Day out of the returned timeline.
    for (let index = 0; index < 100; index += 1) {
      await exec("INSERT INTO game_events (id,game_id,event_type,payload_json,created_at) VALUES (?,'game','ANNOUNCEMENT','{\"title\":\"Note\",\"body\":\"x\"}',?)", [`note-${index}`, `2026-02-01T00:${String(index % 60).padStart(2, '0')}:${String(Math.floor(index / 60)).padStart(2, '0')}.000Z`]);
    }
    const prepare = vi.spyOn(shared.db!, 'prepare');
    const dashboard = await loadDashboard('s1');
    expect(dashboard?.timeline).toHaveLength(100);
    expect(dashboard?.timelineHasMore).toBe(true);
    expect(dashboard?.timeline.some((event) => event.id === 'published-old-day')).toBe(false);
    // Run the vote query again to see what it read: nothing, although the old Day has two votes.
    const voteCall = prepare.mock.calls.findIndex(([sql]) => sql.includes("a.kind = 'DAY_VOTE'"));
    const voteQuery = prepare.mock.results[voteCall].value as { all: () => Promise<{ results: unknown[] }> };
    expect((await voteQuery.all()).results).toEqual([]);
  });

  test('returns null for a seat that does not exist', async () => {
    expect(await loadDashboard('missing')).toBeNull();
  });
});
