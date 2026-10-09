import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { providerDatabase, type TestDatabase, type ReadGate } from './test-support/provider-database';
import { readFileSync } from 'node:fs';

const shared = vi.hoisted(() => ({
  db: null as TestDatabase | null,
  gate: null as ReadGate | null,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/auth/session', () => ({
  getCurrentPlayer: async () => ({ seatId: 'wolf', gameId: 'game', alive: true, displayName: 'Wolf' }),
}));
vi.mock('../lib/http/rate-limit', () => ({
  enforceRateLimit: async () => {},
  requestRateLimitKey: () => 'chat-race-test',
  RateLimitError: class RateLimitError extends Error {
    retryAfterSeconds = 1;
  },
}));

import { POST as messagePost } from '../app/api/rooms/[roomId]/messages/route';

let sqlite: DatabaseSync;

function request(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/test', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function sendMessage(): Promise<Response> {
  return messagePost(request({ body: 'A message that must cross the write boundary safely.' }), { params: Promise.resolve({ roomId: 'wolf-room' }) });
}

function gateRoomRead() {
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { entered = resolve; });
  shared.gate = async (sql, kind) => {
    if (kind !== 'first' || !sql.includes('FROM chat_rooms cr')) return;
    shared.gate = null;
    entered();
    await blocked;
  };
  return { reached, release };
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  for (const file of ['0000_dashing_smiling_tiger.sql', '0001_bodyguard_and_lifecycle.sql', '0002_pilot_hardening.sql', '0003_reviewed_outcome.sql', '0004_operator_bootstrap.sql']) {
    sqlite.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  }
  sqlite.exec("INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','review@pilot.test','fake','[]','2026-01-01','2026-01-01');");
  sqlite.exec("INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Review','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01');");
  sqlite.exec("INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,alive,created_at,updated_at) VALUES ('wolf','game','Wolf','wolf@pilot.test','CLAIMED','wolf-hash',1,'2026-01-01','2026-01-01');");
  sqlite.exec("INSERT INTO assignment_batches (id,game_id,revision,assignments_json,random_evidence_hash,created_by_moderator_id,created_at) VALUES ('batch','game',1,'[]','hash','mod','2026-01-01');");
  sqlite.exec("INSERT INTO role_assignments (game_id,seat_id,role_key,assignment_batch_id) VALUES ('game','wolf','WEREWOLF','batch');");
  sqlite.exec("INSERT INTO chat_rooms (id,game_id,type,status,created_at) VALUES ('wolf-room','game','WEREWOLF','OPEN','2026-01-01');");
  sqlite.exec("INSERT INTO chat_room_members (room_id,seat_id,access,granted_at) VALUES ('wolf-room','wolf','WRITE','2026-01-01');");
  shared.gate = null;
  shared.db = providerDatabase(sqlite, shared);
});

afterEach(() => sqlite.close());

describe('chat write authorization races', () => {
  test('saves an authorized message and its audit event together', async () => {
    const response = await sendMessage();
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM chat_messages').get() as { count: number }).count).toBe(1);
    expect((sqlite.prepare("SELECT COUNT(*) AS count FROM game_events WHERE event_type = 'CHAT_MESSAGE_SENT'").get() as { count: number }).count).toBe(1);
  });

  test.each([
    ['room lock', "UPDATE chat_rooms SET status = 'READ_ONLY'"],
    ['game stop', "UPDATE games SET status = 'STOPPED'"],
    ['faction elimination', "UPDATE seats SET alive = 0 WHERE id = 'wolf'"],
  ])('rejects an in-flight message after %s', async (_label, change) => {
    const gate = gateRoomRead();
    const pending = sendMessage();
    await gate.reached;
    sqlite.exec(change);
    gate.release();

    const response = await pending;
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(409);
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM chat_messages').get() as { count: number }).count).toBe(0);
    expect((sqlite.prepare("SELECT COUNT(*) AS count FROM game_events WHERE event_type = 'CHAT_MESSAGE_SENT'").get() as { count: number }).count).toBe(0);
  });
});
