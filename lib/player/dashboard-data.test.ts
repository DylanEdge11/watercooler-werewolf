import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../../db/libsql';
import { loadMigrations, runMigrations } from '../../scripts/db-migration-runner.mjs';

const shared = vi.hoisted(() => ({ db: null as LibsqlDatabase | null }));
vi.mock('../../db', () => ({ getDb: () => shared.db }));

import { loadBallotVotes, loadDashboard, loadSpectatorDashboard } from './dashboard-data';

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
    // Run both vote queries (the newest ballot's votes and the counts) again to see
    // what they read: nothing, although the old Day has two votes.
    const voteCalls = prepare.mock.calls.flatMap(([sql], index) => sql.includes("a.kind = 'DAY_VOTE'") ? [index] : []);
    expect(voteCalls).toHaveLength(2);
    for (const call of voteCalls) {
      const voteQuery = prepare.mock.results[call].value as { all: () => Promise<{ results: unknown[] }> };
      expect((await voteQuery.all()).results).toEqual([]);
    }
  });

  test('sends who voted for whom for the newest ballot only, and a vote count for every ballot', async () => {
    await publishDay('day-1', 1, '2026-01-02T10:00:00.000Z', ['s1', 's3']);
    await publishDay('day-2', 2, '2026-01-03T10:00:00.000Z', ['s1']);
    const dashboard = await loadDashboard('s1');
    const byId = new Map(dashboard?.timeline.map((event) => [event.id, event.payload as { votes?: unknown[]; voteCount?: number }]));
    expect(byId.get('published-day-2')).toMatchObject({ voteCount: 1, votes: [{ actorName: 'Player s1', targetNames: ['Player s2'] }] });
    expect(byId.get('published-day-1')?.voteCount).toBe(2);
    expect(byId.get('published-day-1')?.votes).toBeUndefined();
  });

  test('returns null for a seat that does not exist', async () => {
    expect(await loadDashboard('missing')).toBeNull();
  });
});

describe('loadBallotVotes', () => {
  test('returns an older published ballot of the game', async () => {
    await publishDay('day-1', 1, '2026-01-02T10:00:00.000Z', ['s3', 's1']);
    expect(await loadBallotVotes('game', 'day-1')).toEqual([
      { actorName: 'Player s1', targetNames: ['Player s2'] },
      { actorName: 'Player s3', targetNames: ['Player s2'] },
    ]);
  });

  test('refuses another game, an unpublished phase, a Night, or a ballot from before a reset', async () => {
    await publishDay('day-1', 1, '2026-01-02T10:00:00.000Z', ['s1']);
    expect(await loadBallotVotes('other-game', 'day-1')).toBeNull();
    await exec("INSERT INTO phases (id,game_id,sequence,kind,status,opens_at,closes_at,slots,divisor_snapshot,created_at,updated_at) VALUES ('open-day','game',2,'DAY','OPEN','2026-01-03','2099-01-01',1,30,'2026-01-03','2026-01-03')");
    expect(await loadBallotVotes('game', 'open-day')).toBeNull();
    await exec("INSERT INTO phases (id,game_id,sequence,kind,status,opens_at,closes_at,slots,divisor_snapshot,created_at,updated_at,published_at) VALUES ('night','game',3,'NIGHT','PUBLISHED','2026-01-03','2026-01-03',1,30,'2026-01-03','2026-01-03','2026-01-03')");
    expect(await loadBallotVotes('game', 'night')).toBeNull();
    await exec("INSERT INTO game_events (id,game_id,event_type,payload_json,created_at) VALUES ('reset','game','GAME_RESET','{}','2026-01-05T00:00:00.000Z')");
    expect(await loadBallotVotes('game', 'day-1')).toBeNull();
  });
});

describe('the reads behind one refresh', () => {
  beforeEach(async () => {
    await exec("INSERT INTO assignment_batches (id,game_id,revision,setup_revision,roster_fingerprint,composition_fingerprint,assignments_json,random_evidence_hash,created_by_moderator_id,created_at) VALUES ('batch','game',1,1,'roster','composition','[]','hash','mod','2026-01-01')");
    for (const [seat, role] of [['s1', 'CUPID'], ['s2', 'VILLAGER'], ['s3', 'SEER']]) {
      await exec("INSERT INTO role_assignments (game_id,seat_id,role_key,assignment_batch_id) VALUES ('game',?,?,'batch')", [seat, role]);
    }
    await exec("INSERT INTO phases (id,game_id,sequence,kind,status,opens_at,closes_at,slots,divisor_snapshot,created_at,updated_at) VALUES ('night','game',1,'NIGHT','OPEN','2026-02-01','2099-01-01',1,30,'2026-02-01','2026-02-01')");
    // The first refresh of a game with roles creates its chat rooms; later ones only read.
    await loadDashboard('s2', { gameId: 'game' });
  });

  test('a refresh is two read batches and eight statements for a player with nothing to answer, with no lover-pair read', async () => {
    const batch = vi.spyOn(shared.db!, 'batch');
    const prepare = vi.spyOn(shared.db!, 'prepare');
    const view = await loadDashboard('s2', { gameId: 'game' });
    expect(view?.permission.actionKind).toBeNull();
    // Seat, phase, roster, the three timeline reads, rooms; then notifications. Each batch is one request and one snapshot.
    expect(batch.mock.calls.map(([statements, mode]) => [statements.length, mode])).toEqual([[7, 'read'], [1, 'read']]);
    expect(prepare).toHaveBeenCalledTimes(8);
    expect(prepare.mock.calls.some(([sql]) => sql.includes('CUPID_PAIR_SET'))).toBe(false);
  });

  test('a Cupid still reads the pair, which decides whether they have a choice to make', async () => {
    const withoutPair = await loadDashboard('s1', { gameId: 'game' });
    expect(withoutPair?.permission.actionKind).toBe('CUPID_PAIR');
    await exec("INSERT INTO game_events (id,game_id,event_type,payload_json,created_at) VALUES ('pair','game','CUPID_PAIR_SET','{\"cupidId\":\"s1\",\"playerIds\":[\"s2\",\"s3\"]}','2026-02-01T10:00:00.000Z')");
    const prepare = vi.spyOn(shared.db!, 'prepare');
    const withPair = await loadDashboard('s1', { gameId: 'game' });
    expect(withPair?.permission.actionKind).toBeNull();
    expect(prepare.mock.calls.filter(([sql]) => sql.includes('CUPID_PAIR_SET'))).toHaveLength(1);
  });

  test('missing rooms are repaired before the rooms are read, so the first answer already has them', async () => {
    await exec('DELETE FROM chat_rooms WHERE game_id = ?', ['game']);
    const view = await loadDashboard('s2', { gameId: 'game' });
    expect(view?.rooms.map((room) => room.type)).toEqual(['TOWN_HALL']);
  });

  test('a seat is never answered with another game’s data, and asking without the game id gives the same answer', async () => {
    expect(await loadDashboard('s2', { gameId: 'some-other-game' })).toBeNull();
    expect(await loadDashboard('missing-seat', { gameId: 'game' })).toBeNull();
    expect(await loadDashboard('s2')).toEqual(await loadDashboard('s2', { gameId: 'game' }));
  });

  test('a spectator’s public view is read in one batch', async () => {
    await exec("INSERT INTO spectators (id,game_id,display_name,email,status,claim_code_hash,created_at,updated_at) VALUES ('w1','game','Watcher','w1@pilot.test','ACTIVE','w-hash','2026-01-01','2026-01-01')");
    const batch = vi.spyOn(shared.db!, 'batch');
    const view = await loadSpectatorDashboard('w1');
    expect(view?.viewer).toBe('SPECTATOR');
    expect(view?.game.counts.total).toBe(3);
    expect(batch.mock.calls.map(([statements, mode]) => [statements.length, mode])).toEqual([[6, 'read']]);
  });
});
