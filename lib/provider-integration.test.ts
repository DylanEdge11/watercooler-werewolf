import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';
import { bootstrapPrimaryModerator } from './auth/bootstrap';
import { authenticateModerator, redeemModeratorRecoveryCode } from './auth/moderators';
import { sha256 } from './auth/crypto';

const shared = vi.hoisted(() => ({
  db: null as LibsqlDatabase | null,
  currentPlayer: null as { seatId: string } | null,
  ensureGameRooms: null as ((gameId: string) => Promise<void>) | null,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/auth/authorization', () => ({ requireGameModerator: async () => ({ id: 'mod' }) }));
vi.mock('../lib/auth/session', () => ({
  createPlayerSession: async () => {},
  getCurrentPlayer: async () => shared.currentPlayer,
}));
vi.mock('../lib/chat/rooms', () => ({
  ensureGameRooms: async (gameId: string) => {
    await shared.ensureGameRooms?.(gameId);
  },
}));
vi.mock('../lib/http/rate-limit', () => {
  class TestRateLimitError extends Error {
    readonly retryAfterSeconds = 1;
  }
  return {
    enforceRateLimit: async () => {},
    requestRateLimitKey: () => 'provider-test',
    RateLimitError: TestRateLimitError,
  };
});

import { POST as claimPost } from '../app/api/seats/claim/[code]/route';
import { POST as phasePost } from '../app/api/games/[gameId]/phases/route';
import { GET as roomsGet } from '../app/api/games/[gameId]/rooms/route';
import { POST as roomsPost } from '../app/api/games/[gameId]/rooms/route';
import { GET as operationsGet } from '../app/api/games/[gameId]/operations/route';
import { GET as playerGet } from '../app/api/player/route';

let client: Client;
let db: LibsqlDatabase;

function request(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    body: JSON.stringify(body),
  });
}

type ProviderValue = string | number | bigint | boolean | null | Uint8Array | ArrayBuffer;

async function executeBatch(statements: Array<{ sql: string; args?: ProviderValue[] }>): Promise<void> {
  await client.batch(statements.map((statement) => ({ sql: statement.sql, args: statement.args ?? [] })), 'write');
}

async function seedClaim(): Promise<void> {
  const claimHash = await sha256('fictional-claim-code');
  await executeBatch([
    {
      sql: "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','fake','[]','2026-01-01','2026-01-01')",
    },
    {
      sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('claim-game','Claim test','REGISTRATION','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')",
    },
    {
      sql: 'INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      args: ['claim-seat', 'claim-game', 'Claimed Player', 'player@pilot.test', 'INVITED', claimHash, '2026-01-01', '2026-01-01'],
    },
  ]);
}

async function seedActiveGame(): Promise<void> {
  await executeBatch([
    {
      sql: "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','fake','[]','2026-01-01','2026-01-01')",
    },
    {
      sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Provider race test','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')",
    },
    {
      sql: "INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01')",
    },
    {
      sql: "INSERT INTO assignment_batches (id,game_id,revision,assignments_json,random_evidence_hash,created_by_moderator_id,created_at) VALUES ('batch','game',1,'[]','hash','mod','2026-01-01')",
    },
    {
      sql: "INSERT INTO phases (id,game_id,sequence,kind,status,opens_at,closes_at,slots,divisor_snapshot,created_at,updated_at) VALUES ('phase','game',1,'DAY','OPEN','2026-01-01','2099-01-01',1,30,'2026-01-01','2026-01-01')",
    },
  ]);

  for (let index = 0; index < 20; index += 1) {
    await executeBatch([
      {
        sql: "INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        args: [`p${index}`, 'game', `Player ${index}`, `p${index}@pilot.test`, 'CLAIMED', `hash-${index}`, '2026-01-01', '2026-01-01'],
      },
      {
        sql: "INSERT INTO role_assignments (game_id,seat_id,role_key,assignment_batch_id) VALUES ('game',?,?, 'batch')",
        args: [`p${index}`, index > 16 ? 'WEREWOLF' : 'VILLAGER'],
      },
    ]);
  }
}

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  db = new LibsqlDatabase(client as unknown as LibsqlClient);
  shared.db = db;
  shared.currentPlayer = null;
  shared.ensureGameRooms = null;
});

afterEach(() => {
  shared.db = null;
  shared.currentPlayer = null;
  shared.ensureGameRooms = null;
  client.close();
});

describe('real libSQL provider integration', () => {
  test('keeps membership timestamps stable across repeated player polling while reconciling elimination', async () => {
    await seedActiveGame();
    const { ensureGameRooms } = await vi.importActual<typeof import('./chat/rooms')>('./chat/rooms');
    shared.ensureGameRooms = ensureGameRooms;
    shared.currentPlayer = { seatId: 'p17' };
    const firstRead = await playerGet(new Request('http://localhost:3000/api/player'));
    expect(firstRead.status).toBe(200);

    await client.execute("UPDATE chat_room_members SET granted_at = '2026-01-01' WHERE seat_id = 'p17'");
    await client.execute("UPDATE seats SET alive = 0 WHERE id IN ('p17', 'p18')");
    const eliminationRead = await playerGet(new Request('http://localhost:3000/api/player'));
    expect(eliminationRead.status).toBe(200);

    const membershipsBeforePolling = await client.execute(`SELECT m.seat_id AS seatId, r.type, m.access,
      m.granted_at AS grantedAt, m.revoked_at AS revokedAt
      FROM chat_room_members m JOIN chat_rooms r ON r.id = m.room_id
      WHERE m.seat_id IN ('p17', 'p18', 'p19') ORDER BY m.seat_id, r.type`);
    const repeatedRead = await playerGet(new Request('http://localhost:3000/api/player'));
    expect(repeatedRead.status).toBe(200);
    const membershipsAfterPolling = await client.execute(`SELECT m.seat_id AS seatId, r.type, m.access,
      m.granted_at AS grantedAt, m.revoked_at AS revokedAt
      FROM chat_room_members m JOIN chat_rooms r ON r.id = m.room_id
      WHERE m.seat_id IN ('p17', 'p18', 'p19') ORDER BY m.seat_id, r.type`);
    expect(membershipsAfterPolling.rows).toEqual(membershipsBeforePolling.rows);

    const membership = await client.execute(`SELECT r.type, m.access, m.granted_at AS grantedAt, m.revoked_at AS revokedAt
      FROM chat_room_members m JOIN chat_rooms r ON r.id = m.room_id
      WHERE m.seat_id = 'p17' ORDER BY r.type`);
    expect(membership.rows).toEqual([
      { type: 'DEAD', access: 'WRITE', grantedAt: expect.any(String), revokedAt: null },
      { type: 'WEREWOLF', access: 'READ_ONLY', grantedAt: '2026-01-01', revokedAt: expect.any(String) },
    ]);
    const secondEliminated = await client.execute(`SELECT r.type, m.access FROM chat_room_members m
      JOIN chat_rooms r ON r.id = m.room_id WHERE m.seat_id = 'p18' ORDER BY r.type`);
    expect(secondEliminated.rows).toEqual([
      { type: 'DEAD', access: 'WRITE' },
      { type: 'WEREWOLF', access: 'READ_ONLY' },
    ]);
    const living = await client.execute("SELECT access, revoked_at AS revokedAt FROM chat_room_members WHERE seat_id = 'p19'");
    expect(living.rows).toEqual([{ access: 'WRITE', revokedAt: null }]);
  });

  test('accepts only valid room statuses and reports when no room was updated', async () => {
    await seedActiveGame();
    await client.execute("INSERT INTO chat_rooms (id, game_id, type, status, created_at) VALUES ('wolf-room', 'game', 'WEREWOLF', 'OPEN', '2026-01-01')");
    const context = { params: Promise.resolve({ gameId: 'game' }) };

    for (const status of ['PURGED', 'CLOSED']) {
      const invalid = await roomsPost(request('/api/games/game/rooms', {
        action: 'SET_ROOM_STATUS', roomId: 'wolf-room', status,
      }), context);
      expect(invalid.status).toBe(400);
    }

    const unknownRoom = await roomsPost(request('/api/games/game/rooms', {
      action: 'SET_ROOM_STATUS', roomId: 'missing-room', status: 'READ_ONLY',
    }), context);
    expect(unknownRoom.status).toBe(400);
    const unchanged = await client.execute("SELECT status FROM chat_rooms WHERE id = 'wolf-room'");
    expect(unchanged.rows).toEqual([{ status: 'OPEN' }]);

    const readOnly = await roomsPost(request('/api/games/game/rooms', {
      action: 'SET_ROOM_STATUS', roomId: 'wolf-room', status: 'READ_ONLY',
    }), context);
    expect(readOnly.status).toBe(200);
    const open = await roomsPost(request('/api/games/game/rooms', {
      action: 'SET_ROOM_STATUS', roomId: 'wolf-room', status: 'OPEN',
    }), context);
    expect(open.status).toBe(200);
    const toggled = await client.execute("SELECT status FROM chat_rooms WHERE id = 'wolf-room'");
    expect(toggled.rows).toEqual([{ status: 'OPEN' }]);
  });

  test('counts room members and messages independently, including empty rooms', async () => {
    await seedActiveGame();
    await client.execute(`INSERT INTO chat_rooms (id, game_id, type, status, created_at) VALUES
      ('wolf-room', 'game', 'WEREWOLF', 'OPEN', '2026-01-01'),
      ('mason-room', 'game', 'MASON', 'OPEN', '2026-01-01'),
      ('dead-room', 'game', 'DEAD', 'OPEN', '2026-01-01')`);
    await client.execute(`INSERT INTO chat_room_members (room_id, seat_id, access, granted_at) VALUES
      ('wolf-room', 'p0', 'WRITE', '2026-01-01'),
      ('wolf-room', 'p1', 'READ_ONLY', '2026-01-01'),
      ('wolf-room', 'p2', 'REVOKED', '2026-01-01'),
      ('mason-room', 'p3', 'WRITE', '2026-01-01')`);
    await client.execute(`INSERT INTO chat_messages (id, room_id, author_seat_id, body, deleted_at, purged_at, created_at) VALUES
      ('message-1', 'wolf-room', 'p0', 'Hello', NULL, NULL, '2026-01-01'),
      ('message-2', 'wolf-room', 'p1', NULL, '2026-01-02', NULL, '2026-01-01'),
      ('message-3', 'wolf-room', 'p2', NULL, NULL, '2026-01-02', '2026-01-01')`);

    const response = await roomsGet(new Request('http://localhost:3000/api/games/game/rooms'), { params: Promise.resolve({ gameId: 'game' }) });
    expect(response.status).toBe(200);
    const data = await response.json() as { rooms: Array<{ type: string; memberCount: number; messageCount: number }> };
    expect(data.rooms.map(({ type, memberCount, messageCount }) => ({ type, memberCount, messageCount }))).toEqual([
      { type: 'DEAD', memberCount: 0, messageCount: 0 },
      { type: 'MASON', memberCount: 1, messageCount: 0 },
      { type: 'WEREWOLF', memberCount: 2, messageCount: 3 },
    ]);
  });

  test('preserves the latest-backup response with and without stored exports', async () => {
    await seedActiveGame();
    const context = { params: Promise.resolve({ gameId: 'game' }) };
    const url = 'http://localhost:3000/api/games/game/operations';
    const empty = await operationsGet(new Request(url), context);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ lastBackup: null, backups: [] });

    await client.execute(`INSERT INTO backup_exports (id, game_id, moderator_id, schema_version, checksum, exported_at) VALUES
      ('old', 'game', 'mod', 2, 'old-checksum', '2026-01-01'),
      ('new', 'game', 'mod', 2, 'new-checksum', '2026-01-02')`);
    const response = await operationsGet(new Request(url), context);
    expect(response.status).toBe(200);
    const data = await response.json() as { lastBackup: unknown; backups: Array<{ id: string }> };
    expect(data.lastBackup).toEqual({ exportedAt: '2026-01-02', checksum: 'new-checksum' });
    expect(data.backups.map((backup) => backup.id)).toEqual(['new', 'old']);
  });

  test('allows only one concurrent claim for a one-time invite', async () => {
    await seedClaim();
    const context = { params: Promise.resolve({ code: 'fictional-claim-code' }) };
    const responses = await Promise.all([
      claimPost(request('/api/seats/claim/fictional-claim-code', { pin: '111111' }), context),
      claimPost(request('/api/seats/claim/fictional-claim-code', { pin: '222222' }), context),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const seat = await client.execute("SELECT status, pin_hash AS pinHash FROM seats WHERE id = 'claim-seat'");
    expect(seat.rows[0]?.status).toBe('CLAIMED');
    expect(String(seat.rows[0]?.pinHash)).not.toContain('111111');
    expect(String(seat.rows[0]?.pinHash)).not.toContain('222222');
    const events = await client.execute("SELECT COUNT(*) AS count FROM game_events WHERE event_type = 'SEAT_CLAIMED'");
    expect(Number(events.rows[0]?.count)).toBe(1);
  });

  test('increments a persistent rate-limit bucket and returns Retry-After semantics', async () => {
    const rateLimit = await vi.importActual<typeof import('./http/rate-limit')>('./http/rate-limit');
    await rateLimit.enforceRateLimit('provider-rate-limit', 2, 60 * 60_000, db);
    await rateLimit.enforceRateLimit('provider-rate-limit', 2, 60 * 60_000, db);
    await expect(rateLimit.enforceRateLimit('provider-rate-limit', 2, 60 * 60_000, db)).rejects.toBeInstanceOf(rateLimit.RateLimitError);
    const bucket = await client.execute("SELECT attempts FROM rate_limit_buckets WHERE bucket_key = 'provider-rate-limit'");
    expect(Number(bucket.rows[0]?.attempts)).toBe(3);
  });

  test('redeems one recovery code once under concurrent requests', async () => {
    const created = await bootstrapPrimaryModerator(db, 'Owner@pilot.test', 'fictional-owner-password');
    const results = await Promise.all([
      redeemModeratorRecoveryCode('owner@pilot.test', created.recoveryCodes[0], 'fictional-new-password'),
      redeemModeratorRecoveryCode('owner@pilot.test', created.recoveryCodes[0], 'fictional-other-password'),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const newPasswordAuth = await authenticateModerator('owner@pilot.test', 'fictional-new-password');
    const otherPasswordAuth = await authenticateModerator('owner@pilot.test', 'fictional-other-password');
    expect([Boolean(newPasswordAuth), Boolean(otherPasswordAuth)].filter(Boolean)).toHaveLength(1);
    const account = await client.execute('SELECT recovery_codes_json AS recoveryCodes FROM moderator_accounts');
    expect(JSON.parse(String(account.rows[0]?.recoveryCodes))).toHaveLength(7);
  });

  test('competing phase publications commit one authoritative outcome', async () => {
    await seedActiveGame();
    const phaseContext = { params: Promise.resolve({ gameId: 'game' }) };
    const proposed = await phasePost(request('/api/games/game/phases', { action: 'LOCK_AND_PROPOSE', phaseId: 'phase' }), phaseContext);
    expect(proposed.status).toBe(200);

    const responses = await Promise.all([
      phasePost(request('/api/games/game/phases', {
        action: 'PUBLISH',
        phaseId: 'phase',
        overrideReason: 'Provider first correction',
        overrideEliminationIds: ['p1'],
      }), phaseContext),
      phasePost(request('/api/games/game/phases', {
        action: 'PUBLISH',
        phaseId: 'phase',
        overrideReason: 'Provider second correction',
        overrideEliminationIds: ['p2'],
      }), phaseContext),
    ]);

    expect(responses.every((response) => response.status === 200 || response.status === 409)).toBe(true);
    const eliminated = await client.execute("SELECT id FROM seats WHERE game_id = 'game' AND alive = 0");
    expect(eliminated.rows).toHaveLength(1);
    const events = await client.execute("SELECT COUNT(*) AS count FROM game_events WHERE event_type = 'PHASE_PUBLISHED'");
    expect(Number(events.rows[0]?.count)).toBe(1);
    const phase = await client.execute("SELECT status FROM phases WHERE id = 'phase'");
    expect(phase.rows[0]?.status).toBe('PUBLISHED');
  });
});
