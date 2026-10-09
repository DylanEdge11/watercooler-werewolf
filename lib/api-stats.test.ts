import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { keysOf } from './test-support/keys-of';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';
import { FORBIDDEN_PLAYER_KEYS } from '../e2e/readiness/browser-fixture';
import { ROLE_KEYS } from './game/types';
import type { GameStats } from './game/game-stats';

const shared = vi.hoisted(() => ({
  db: null as LibsqlDatabase | null,
  currentPlayer: null as { seatId: string; gameId: string; displayName: string; alive: boolean } | null,
  currentSpectator: null as { spectatorId: string; gameId: string; displayName: string } | null,
  moderatorError: null as { status: number; message: string } | null,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/auth/authorization', async () => {
  const { HttpError } = await import('../lib/http/errors');
  return {
    requireGameModerator: async () => {
      if (shared.moderatorError) throw new HttpError(shared.moderatorError.status, shared.moderatorError.message);
      return { id: 'mod' };
    },
  };
});
vi.mock('../lib/auth/session', () => ({
  getCurrentPlayer: async () => shared.currentPlayer,
  getCurrentSpectator: async () => shared.currentSpectator,
}));
vi.mock('../lib/http/rate-limit', async (importOriginal) => ({
  ...await importOriginal<typeof import('./http/rate-limit')>(),
  enforceRateLimit: async () => {},
}));

import { POST as actionPost } from '../app/api/phases/[phaseId]/actions/route';
import { POST as phasePost } from '../app/api/games/[gameId]/phases/route';
import { GET as statsGet } from '../app/api/stats/route';
import { GET as moderatorStatsGet } from '../app/api/games/[gameId]/stats/route';
import { ensureGameRooms } from './chat/rooms';

let client: Client;

const gameContext = { params: Promise.resolve({ gameId: 'game' }) };
const phaseContext = { params: Promise.resolve({ phaseId: 'day1' }) };

function post(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

function asPlayer(seatId: string, gameId = 'game') {
  shared.currentSpectator = null;
  shared.currentPlayer = { seatId, gameId, displayName: seatId, alive: true };
}

function asSpectator() {
  shared.currentPlayer = null;
  shared.currentSpectator = { spectatorId: 'watcher', gameId: 'game', displayName: 'Riley Watcher' };
}

async function vote(seatId: string, targetIds: string[]) {
  asPlayer(seatId);
  const response = await actionPost(post('/api/phases/day1/actions', { actionKind: 'DAY_VOTE', targetIds }), phaseContext);
  expect(response.status).toBe(200);
}

async function phaseAction(action: string) {
  const response = await phasePost(post('/api/games/game/phases', { phaseId: 'day1', action }), gameContext);
  expect(response.status).toBe(200);
}

async function playerStats(): Promise<{ status: number; stats: GameStats; raw: string }> {
  const response = await statsGet(new Request('http://localhost:3000/api/stats'));
  const raw = await response.text();
  const body = raw ? JSON.parse(raw) as { stats: GameStats } : { stats: undefined as unknown as GameStats };
  return { status: response.status, stats: body.stats, raw };
}

const exec = (sql: string, args: Array<string | number | null> = []) => client.execute({ sql, args });

/** Eight fictional players on an open first Day. p4, p5, and p7 are Werewolves and p3 is the Seer. */
beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  shared.currentPlayer = null;
  shared.currentSpectator = null;
  shared.moderatorError = null;
  await client.batch([
    { sql: "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','x','[]','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Stats test','ACTIVE','America/New_York','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01')", args: [] },
    { sql: "INSERT INTO assignment_batches (id,game_id,revision,assignments_json,random_evidence_hash,created_by_moderator_id,created_at) VALUES ('batch','game',1,'[]','hash','mod','2026-01-01')", args: [] },
    { sql: "INSERT INTO phases (id,game_id,sequence,kind,status,opens_at,closes_at,slots,divisor_snapshot,created_at,updated_at) VALUES ('day1','game',1,'DAY','OPEN','2026-01-01','2099-01-01',1,30,'2026-01-01','2026-01-01')", args: [] },
  ], 'write');
  const roles = ['VILLAGER', 'VILLAGER', 'VILLAGER', 'SEER', 'WEREWOLF', 'WEREWOLF', 'VILLAGER', 'WEREWOLF'];
  for (const [index, role] of roles.entries()) {
    await client.batch([
      { sql: "INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,alive,created_at,updated_at) VALUES (?, 'game', ?, ?, 'CLAIMED', ?, 1, '2026-01-01', '2026-01-01')", args: [`p${index}`, `Player ${index}`, `p${index}@pilot.test`, `hash-${index}`] },
      { sql: "INSERT INTO role_assignments (game_id,seat_id,role_key,assignment_batch_id) VALUES ('game', ?, ?, 'batch')", args: [`p${index}`, role] },
    ], 'write');
  }
  await ensureGameRooms('game');
});

afterEach(() => {
  shared.db = null;
  client.close();
});

describe('Village stats', () => {
  test('an open ballot adds nothing: votes count only once the result is published', async () => {
    await vote('p0', ['p4']);
    await vote('p1', ['p4']);
    asPlayer('p2');
    const { status, stats } = await playerStats();
    expect(status).toBe(200);
    expect(stats.ballots).toEqual([]);
    expect(stats.mostVoted).toBeNull();
    expect(stats.summary).toMatchObject({ players: 8, living: 8, ballots: 0, votesCast: 0 });
    expect(stats.voteMatrix.cells).toEqual([]);
  });

  test('a published Day shows who got the votes, who left, and only revealed roles', async () => {
    for (const voter of ['p0', 'p1', 'p2', 'p3']) await vote(voter, ['p4']);
    await vote('p4', ['p0']);
    await vote('p5', ['p0']);
    await vote('p6', ['p3']);
    await phaseAction('LOCK_AND_PROPOSE');
    await phaseAction('PUBLISH');

    asPlayer('p6');
    const { status, stats, raw } = await playerStats();
    expect(status).toBe(200);
    expect(stats.ballots).toHaveLength(1);
    expect(stats.ballots[0]).toMatchObject({
      label: 'Day 1', living: 8, voters: 7, leaders: ['Player 4'], topVotes: 4, margin: 2, tiedAtTop: false, votedOut: ['Player 4'],
    });
    expect(stats.ballots[0].votesReceived.map((entry) => [entry.displayName, entry.count])).toEqual([['Player 4', 4], ['Player 0', 2], ['Player 3', 1]]);
    expect(stats.mostVoted).toEqual({ players: [{ playerId: 'p4', displayName: 'Player 4' }], votes: 4 });
    expect(stats.summary).toMatchObject({ players: 8, living: 7, eliminated: 1, werewolvesLiving: 2, ballots: 1, votesCast: 7 });
    // Player 4's role was revealed by the result, so two werewolves are left of the three that started.
    expect(stats.story.start).toEqual({ living: 8, werewolves: 3 });
    expect(stats.story.steps).toMatchObject([{ label: 'Day 1', living: 7, werewolves: 2, eliminations: [{ displayName: 'Player 4', role: 'WEREWOLF', cause: 'DAY_VOTE' }] }]);

    // Players get no private result: no forbidden key, and the only roles in the payload are the eliminated player's.
    expect([...keysOf(stats)].filter((key) => FORBIDDEN_PLAYER_KEYS.has(key))).toEqual([]);
    const rolesShown = ROLE_KEYS.filter((role) => raw.includes(`"${role}"`));
    expect(rolesShown).toEqual(['WEREWOLF']);
    expect(raw).not.toContain('SEER');
    expect(raw).not.toMatch(/@pilot\.test/);
  });

  test('a spectator and a moderator read the same stats as a player', async () => {
    for (const voter of ['p0', 'p1', 'p2']) await vote(voter, ['p6']);
    await phaseAction('LOCK_AND_PROPOSE');
    await phaseAction('PUBLISH');

    asPlayer('p0');
    const asPlayerStats = (await playerStats()).stats;
    asSpectator();
    const asSpectatorStats = await playerStats();
    expect(asSpectatorStats.status).toBe(200);
    expect(asSpectatorStats.stats).toEqual(asPlayerStats);

    shared.currentSpectator = null;
    const moderatorResponse = await moderatorStatsGet(new Request('http://localhost:3000/api/games/game/stats'), gameContext);
    expect(moderatorResponse.status).toBe(200);
    expect((await moderatorResponse.json() as { stats: GameStats }).stats).toEqual(asPlayerStats);
  });

  test('answers 304 when nothing changed since the tag the page already holds', async () => {
    asPlayer('p0');
    const first = await statsGet(new Request('http://localhost:3000/api/stats'));
    const tag = first.headers.get('etag');
    expect(tag).toBeTruthy();
    const again = await statsGet(new Request('http://localhost:3000/api/stats', { headers: { 'if-none-match': tag ?? '' } }));
    expect(again.status).toBe(304);
  });

  test('requires a signed-in player or spectator, and a moderator of this game for the console route', async () => {
    expect((await statsGet(new Request('http://localhost:3000/api/stats'))).status).toBe(401);
    shared.moderatorError = { status: 401, message: 'Moderator authentication required.' };
    expect((await moderatorStatsGet(new Request('http://localhost:3000/api/games/game/stats'), gameContext)).status).toBe(401);
    shared.moderatorError = { status: 403, message: 'You are not a moderator for this game.' };
    expect((await moderatorStatsGet(new Request('http://localhost:3000/api/games/game/stats'), gameContext)).status).toBe(403);
  });

  test('never includes another game', async () => {
    await exec("INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('other','Other game','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')");
    await exec("INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,alive,created_at,updated_at) VALUES ('o1','other','Other One','o1@pilot.test','CLAIMED','h-o1',1,'2026-01-01','2026-01-01')");
    await exec("INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,alive,created_at,updated_at) VALUES ('o2','other','Other Two','o2@pilot.test','CLAIMED','h-o2',1,'2026-01-01','2026-01-01')");
    await exec("INSERT INTO phases (id,game_id,sequence,kind,status,opens_at,closes_at,slots,divisor_snapshot,created_at,updated_at,published_at) VALUES ('oday','other',1,'DAY','PUBLISHED','2026-01-02','2026-01-02',1,30,'2026-01-02','2026-01-02','2026-01-02')");
    await exec("INSERT INTO action_submissions (id,phase_id,actor_seat_id,kind,target_ids_json,version,submitted_at) VALUES ('ov','oday','o1','DAY_VOTE','[\"o2\"]',1,'2026-01-02')");
    await exec("INSERT INTO game_events (id,game_id,event_type,phase_id,payload_json,created_at) VALUES ('oe','other','PHASE_PUBLISHED','oday','{\"kind\":\"DAY\",\"eliminations\":[]}','2026-01-02')");

    asPlayer('p0');
    const { stats, raw } = await playerStats();
    expect(stats.ballots).toEqual([]);
    expect(stats.summary.players).toBe(8);
    expect(raw).not.toContain('Other One');
  });

  test('starts again after a reset: the previous run is not counted', async () => {
    for (const voter of ['p0', 'p1', 'p2']) await vote(voter, ['p6']);
    await phaseAction('LOCK_AND_PROPOSE');
    await phaseAction('PUBLISH');
    asPlayer('p0');
    expect((await playerStats()).stats.ballots).toHaveLength(1);

    // What Reset does to the run: phases and votes are deleted, the audit events stay with no phase, and a boundary event is written.
    await exec('DELETE FROM action_submissions');
    await exec('UPDATE game_events SET phase_id = NULL WHERE phase_id IS NOT NULL');
    await exec('DELETE FROM phases');
    await exec("INSERT INTO game_events (id,game_id,event_type,payload_json,created_at) VALUES ('reset','game','GAME_RESET','{}','2099-01-01T00:00:00.000Z')");
    expect((await playerStats()).stats).toMatchObject({ ballots: [], mostVoted: null, summary: { ballots: 0, votesCast: 0 } });
  });

  describe('chat', () => {
    async function room(type: string): Promise<string> {
      const row = await client.execute({ sql: 'SELECT id FROM chat_rooms WHERE game_id = ? AND type = ?', args: ['game', type] });
      return String(row.rows[0].id);
    }
    const message = (id: string, roomId: string, seatId: string, createdAt: string, extra = '') =>
      exec(`INSERT INTO chat_messages (id,room_id,author_seat_id,body,created_at${extra ? ',deleted_at' : ''}) VALUES (?,?,?,'hello',?${extra ? ',?' : ''})`, extra ? [id, roomId, seatId, createdAt, extra] : [id, roomId, seatId, createdAt]);

    test('the total counts every room and removed messages, while breakdowns use the Town Hall only', async () => {
      const townHall = await room('TOWN_HALL');
      const pack = await room('WEREWOLF');
      const afterlife = await room('DEAD');
      // The game is in New York (UTC-5 in January): 02:30 UTC on the 5th is 21:30 on the 4th.
      await message('t1', townHall, 'p0', '2026-01-05T02:30:00.000Z');
      await message('t2', townHall, 'p0', '2026-01-05T02:40:00.000Z');
      await message('t3', townHall, 'p1', '2026-01-05T15:05:00.000Z');
      await message('t4', townHall, 'p0', '2026-01-05T15:06:00.000Z', '2026-01-05T16:00:00.000Z');
      for (let index = 0; index < 5; index += 1) await message(`w${index}`, pack, 'p4', `2026-01-05T04:0${index}:00.000Z`);
      await exec("INSERT INTO moderator_messages (id,room_id,moderator_id,body,created_at) VALUES ('m1',?,'mod','Welcome','2026-01-05T15:10:00.000Z')", [townHall]);
      await exec("INSERT INTO spectators (id,game_id,display_name,email,status,claim_code_hash,created_at,updated_at) VALUES ('watcher','game','Riley Watcher','riley@pilot.test','ACTIVE','h-w','2026-01-01','2026-01-01')");
      await exec("INSERT INTO spectator_messages (id,room_id,spectator_id,body,created_at) VALUES ('s1',?,'watcher','boo','2026-01-05T16:00:00.000Z')", [afterlife]);

      asPlayer('p2');
      const { stats } = await playerStats();
      // 4 player + 1 moderator in the Town Hall, 5 in the Pack room, 1 spectator in the Afterlife.
      expect(stats.summary.chatMessages).toBe(11);
      expect(stats.chat.perDay).toEqual([{ date: '2026-01-04', count: 2 }, { date: '2026-01-05', count: 3 }]);
      expect(stats.chat.perHour[21]).toBe(2);
      expect(stats.chat.perHour[10]).toBe(3);
      expect(stats.chat.perHour.reduce((sum, count) => sum + count, 0)).toBe(5);
      expect(stats.chat.topChatters.map((chatter) => [chatter.displayName, chatter.count])).toEqual([['Player 0', 3], ['Player 1', 1]]);
      // The werewolves' chatter appears nowhere except in the total.
      expect(JSON.stringify(stats.chat)).not.toContain('Player 4');
    });

    test('a game with no messages has an empty rhythm', async () => {
      asPlayer('p2');
      const { stats } = await playerStats();
      expect(stats.summary.chatMessages).toBe(0);
      expect(stats.chat.perDay).toEqual([]);
      expect(stats.chat.topChatters).toEqual([]);
    });
  });
});
