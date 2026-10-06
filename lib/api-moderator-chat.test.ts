import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';
import { FORBIDDEN_PLAYER_KEYS } from '../e2e/readiness/browser-fixture';

const shared = vi.hoisted(() => ({
  db: null as LibsqlDatabase | null,
  moderatorId: 'mod' as string | null,
  currentPlayer: null as { seatId: string; gameId: string; displayName: string; alive: boolean } | null,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/auth/authorization', async () => {
  const { HttpError } = await import('./http/errors');
  return {
    requireGameModerator: async () => {
      if (!shared.moderatorId) throw new HttpError(403, 'You are not a moderator for this game.');
      return { id: shared.moderatorId };
    },
  };
});
vi.mock('../lib/auth/session', () => ({
  getCurrentPlayer: async () => shared.currentPlayer,
  getCurrentSpectator: async () => null,
}));
vi.mock('../lib/http/rate-limit', async (importOriginal) => ({
  ...await importOriginal<typeof import('./http/rate-limit')>(),
  enforceRateLimit: async () => {},
}));

import { GET as historyGet, POST as historyPost } from '../app/api/games/[gameId]/rooms/[roomId]/messages/route';
import { GET as playerRoomGet } from '../app/api/rooms/[roomId]/messages/route';
import { GET as roomsGet, POST as roomsPost } from '../app/api/games/[gameId]/rooms/route';
import { collectGameBackup } from './backup/snapshot';
import { ensureGameRooms } from './chat/rooms';

let client: Client;
let rooms: Record<'WEREWOLF' | 'MASON' | 'DEAD', string>;

function post(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

function get(path: string): Request {
  return new Request(`http://localhost:3000${path}`);
}

async function history(roomId: string, before?: string) {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  const response = await historyGet(get(`/api/games/game/rooms/${roomId}/messages${query}`), { params: Promise.resolve({ gameId: 'game', roomId }) });
  return { status: response.status, body: await response.json() as {
    room: { status: string; postBlockedReason: string | null };
    messages: Array<{ id: string; authorName: string; authorKind: string; body: string | null; createdAt: string }>;
    earlierCursor: string | null;
    error?: string;
  } };
}

async function moderatorPost(roomId: string, body: unknown, gameId = 'game') {
  const response = await historyPost(post(`/api/games/${gameId}/rooms/${roomId}/messages`, { body }), { params: Promise.resolve({ gameId, roomId }) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function playerView(seatId: string, roomId: string, alive = true) {
  shared.currentPlayer = { seatId, gameId: 'game', displayName: seatId, alive };
  const response = await playerRoomGet(get(`/api/rooms/${roomId}/messages`), { params: Promise.resolve({ roomId }) });
  return { status: response.status, body: await response.json() as { messages: Array<Record<string, unknown>> } };
}

function keysOf(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, keys));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      keysOf(child, keys);
    }
  }
  return keys;
}

/** Six fictional players on an open Day: two Werewolves, two Masons, a Villager, and an eliminated Villager. */
beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  shared.moderatorId = 'mod';
  shared.currentPlayer = null;
  await client.batch([
    { sql: "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','x','[]','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Moderator chat test','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('other','Other game','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01')", args: [] },
    { sql: "INSERT INTO assignment_batches (id,game_id,revision,assignments_json,random_evidence_hash,created_by_moderator_id,created_at) VALUES ('batch','game',1,'[]','hash','mod','2026-01-01')", args: [] },
  ], 'write');
  const roles = ['WEREWOLF', 'WEREWOLF', 'MASON', 'MASON', 'VILLAGER', 'VILLAGER'];
  for (const [index, role] of roles.entries()) {
    await client.batch([
      { sql: "INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,alive,created_at,updated_at) VALUES (?, 'game', ?, ?, 'CLAIMED', ?, ?, '2026-01-01', '2026-01-01')", args: [`p${index}`, `Player ${index}`, `p${index}@pilot.test`, `hash-${index}`, index === 5 ? 0 : 1] },
      { sql: "INSERT INTO role_assignments (game_id,seat_id,role_key,assignment_batch_id) VALUES ('game', ?, ?, 'batch')", args: [`p${index}`, role] },
    ], 'write');
  }
  await ensureGameRooms('game');
  await ensureGameRooms('other');
  const roomRows = (await client.execute("SELECT id, type FROM chat_rooms WHERE game_id = 'game'")).rows;
  rooms = Object.fromEntries(roomRows.map((row) => [String(row.type), String(row.id)])) as typeof rooms;
});

afterEach(() => {
  shared.db = null;
  client.close();
});

describe('moderator room history', () => {
  test('pages through a room’s whole history, oldest first, with no gaps or repeats', async () => {
    for (let index = 0; index < 130; index += 1) {
      const createdAt = new Date(Date.UTC(2026, 9, 1, 9, 0, index)).toISOString();
      await client.execute({
        sql: 'INSERT INTO chat_messages (id, room_id, author_seat_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
        args: [`m${String(index).padStart(3, '0')}`, rooms.WEREWOLF, index % 2 ? 'p1' : 'p0', `Message ${index}`, createdAt],
      });
    }
    const newest = await history(rooms.WEREWOLF);
    expect(newest.status).toBe(200);
    expect(newest.body.messages).toHaveLength(100);
    expect(newest.body.messages[0].body).toBe('Message 30');
    expect(newest.body.messages.at(-1)?.body).toBe('Message 129');
    expect(newest.body.messages[0]).toMatchObject({ authorName: 'Player 0', authorKind: 'PLAYER' });
    expect(newest.body.earlierCursor).toBeTruthy();

    const earlier = await history(rooms.WEREWOLF, newest.body.earlierCursor ?? undefined);
    expect(earlier.status).toBe(200);
    expect(earlier.body.messages.map((message) => message.body)).toEqual(Array.from({ length: 30 }, (_, index) => `Message ${index}`));
    expect(earlier.body.earlierCursor).toBeNull();
  });

  test('reads a room the moderator is not a member of, but only for their own game', async () => {
    const otherRoom = (await client.execute("SELECT id FROM chat_rooms WHERE game_id = 'other' AND type = 'MASON'")).rows[0]?.id as string;
    const response = await historyGet(get(`/api/games/game/rooms/${otherRoom}/messages`), { params: Promise.resolve({ gameId: 'game', roomId: otherRoom }) });
    expect(response.status).toBe(404);
    shared.moderatorId = null;
    expect((await history(rooms.MASON)).status).toBe(403);
  });

  test('rejects a malformed page cursor', async () => {
    expect((await history(rooms.MASON, 'yesterday')).status).toBe(400);
  });
});

describe('posting as Moderator', () => {
  test('members see the message as "Moderator", never the moderator’s email', async () => {
    const sent = await moderatorPost(rooms.WEREWOLF, '  Pack, please vote before noon.  ');
    expect(sent.status).toBe(201);
    expect(sent.body.message).toMatchObject({ authorName: 'Moderator', authorKind: 'MODERATOR', body: 'Pack, please vote before noon.' });

    const wolf = await playerView('p0', rooms.WEREWOLF);
    expect(wolf.status).toBe(200);
    expect(wolf.body.messages).toEqual([expect.objectContaining({ authorName: 'Moderator', byModerator: true, authorSeatId: null, body: 'Pack, please vote before noon.' })]);
    expect(JSON.stringify(wolf.body)).not.toContain('owner@pilot.test');
    expect([...keysOf(wolf.body)].filter((key) => FORBIDDEN_PLAYER_KEYS.has(key))).toEqual([]);
    // Players who aren't in the room still can't read it.
    expect((await playerView('p2', rooms.WEREWOLF)).status).toBe(403);

    const audit = (await client.execute("SELECT actor_moderator_id AS moderatorId FROM game_events WHERE event_type = 'MODERATOR_CHAT_MESSAGE_SENT'")).rows;
    expect(audit).toEqual([expect.objectContaining({ moderatorId: 'mod' })]);

    const roomsResponse = await roomsGet(get('/api/games/game/rooms'), { params: Promise.resolve({ gameId: 'game' }) });
    const roomsBody = await roomsResponse.json() as { rooms: Array<{ id: string; messageCount: number }>; recentMessages: Array<{ authorName: string; roomType: string }> };
    expect(roomsBody.rooms.find((room) => room.id === rooms.WEREWOLF)?.messageCount).toBe(1);
    expect(roomsBody.recentMessages).toEqual([expect.objectContaining({ authorName: 'Moderator', roomType: 'WEREWOLF' })]);

    const moderatorView = await history(rooms.WEREWOLF);
    expect(moderatorView.body.messages).toEqual([expect.objectContaining({ authorName: 'Moderator', authorKind: 'MODERATOR' })]);
  });

  test('posts in all three rooms, mixed in order with player messages', async () => {
    await client.execute({ sql: "INSERT INTO chat_messages (id, room_id, author_seat_id, body, created_at) VALUES ('early', ?, 'p5', 'First!', '2026-01-01T00:00:00.000Z')", args: [rooms.DEAD] });
    for (const roomId of Object.values(rooms)) expect((await moderatorPost(roomId, 'Hello from the moderator')).status).toBe(201);
    const ghost = await playerView('p5', rooms.DEAD, false);
    expect(ghost.body.messages.map((message) => message.authorName)).toEqual(['Player 5', 'Moderator']);
    expect((await playerView('p2', rooms.MASON)).body.messages).toHaveLength(1);
  });

  test('is refused while a room is read-only or the game is not running', async () => {
    await client.execute({ sql: "UPDATE chat_rooms SET status = 'READ_ONLY' WHERE id = ?", args: [rooms.MASON] });
    const readOnly = await moderatorPost(rooms.MASON, 'Anyone here?');
    expect(readOnly).toEqual({ status: 409, body: { ok: false, error: 'This room is read-only. Reopen it to post.' } });
    expect((await history(rooms.MASON)).body.room.postBlockedReason).toBe('This room is read-only. Reopen it to post.');

    await client.execute("UPDATE games SET status = 'COMPLETED' WHERE id = 'game'");
    const ended = await moderatorPost(rooms.DEAD, 'Good game, everyone.');
    expect(ended).toEqual({ status: 409, body: { ok: false, error: 'Posting is open only while the game is running.' } });
    expect((await client.execute('SELECT COUNT(*) AS count FROM moderator_messages')).rows[0]?.count).toBe(0);
  });

  test('rejects an empty message, another game’s room, and a non-moderator', async () => {
    expect((await moderatorPost(rooms.DEAD, '   ')).status).toBe(400);
    const otherRoom = (await client.execute("SELECT id FROM chat_rooms WHERE game_id = 'other' AND type = 'DEAD'")).rows[0]?.id as string;
    expect((await moderatorPost(otherRoom, 'Wrong game')).status).toBe(404);
    shared.moderatorId = null;
    expect((await moderatorPost(rooms.DEAD, 'Hi')).status).toBe(403);
    expect((await client.execute('SELECT COUNT(*) AS count FROM moderator_messages')).rows[0]?.count).toBe(0);
  });

  test('a cross-site request is refused before anything is written', async () => {
    const response = await historyPost(new Request(`http://localhost:3000/api/games/game/rooms/${rooms.DEAD}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.test' },
      body: JSON.stringify({ body: 'Hi' }),
    }), { params: Promise.resolve({ gameId: 'game', roomId: rooms.DEAD }) });
    expect(response.status).toBe(403);
  });

  test('a purge leaves a message a moderator already removed labelled as removed, not expired', async () => {
    const sent = await moderatorPost(rooms.DEAD, 'Remove me first');
    const messageId = (sent.body.message as { id: string }).id;
    await roomsPost(post('/api/games/game/rooms', { action: 'DELETE_MESSAGE', messageId, reason: 'Posted by mistake' }), { params: Promise.resolve({ gameId: 'game' }) });
    await client.execute({ sql: "UPDATE moderator_messages SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?", args: [messageId] });
    const purged = await roomsPost(post('/api/games/game/rooms', { action: 'PURGE_RETENTION' }), { params: Promise.resolve({ gameId: 'game' }) });
    expect(await purged.json()).toMatchObject({ purged: 0 });
    expect((await client.execute({ sql: 'SELECT deleted_at AS deletedAt, purged_at AS purgedAt FROM moderator_messages WHERE id = ?', args: [messageId] })).rows[0]).toMatchObject({ purgedAt: null });
  });

  test('can be removed and purged like any other message, and is kept in backups', async () => {
    const sent = await moderatorPost(rooms.DEAD, 'Remove me');
    const messageId = (sent.body.message as { id: string }).id;
    const removed = await roomsPost(post('/api/games/game/rooms', { action: 'DELETE_MESSAGE', messageId, reason: 'Posted by mistake' }), { params: Promise.resolve({ gameId: 'game' }) });
    expect(removed.status).toBe(200);
    expect((await playerView('p5', rooms.DEAD, false)).body.messages).toEqual([expect.objectContaining({ body: null, byModerator: true })]);

    await client.execute({ sql: "INSERT INTO moderator_messages (id, room_id, moderator_id, body, created_at) VALUES ('old', ?, 'mod', 'Old note', '2026-01-01T00:00:00.000Z')", args: [rooms.MASON] });
    const backup = await collectGameBackup('game');
    expect(backup.moderatorMessages).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'old', body: 'Old note' })]));
    const purged = await roomsPost(post('/api/games/game/rooms', { action: 'PURGE_RETENTION' }), { params: Promise.resolve({ gameId: 'game' }) });
    expect(await purged.json()).toMatchObject({ purged: 1 });
    expect((await client.execute("SELECT body FROM moderator_messages WHERE id = 'old'")).rows[0]?.body).toBeNull();
  });
});
