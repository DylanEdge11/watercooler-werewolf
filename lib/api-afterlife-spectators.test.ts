import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';
import { FORBIDDEN_PLAYER_KEYS } from '../e2e/readiness/browser-fixture';

const shared = vi.hoisted(() => ({
  db: null as LibsqlDatabase | null,
  currentPlayer: null as { seatId: string; gameId: string; displayName: string; alive: boolean } | null,
  currentSpectator: null as { spectatorId: string; gameId: string; displayName: string } | null,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/auth/authorization', () => ({ requireGameModerator: async () => ({ id: 'mod' }) }));
vi.mock('../lib/auth/session', () => ({
  getCurrentPlayer: async () => shared.currentPlayer,
  getCurrentSpectator: async () => shared.currentSpectator,
  createPlayerSession: async () => {},
  prepareSpectatorSession: async (spectatorId: string, sessionVersion: number) => ({
    values: [crypto.randomUUID(), spectatorId, `token-${crypto.randomUUID()}`, sessionVersion, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    setCookie: async () => {},
  }),
}));
vi.mock('../lib/http/rate-limit', async (importOriginal) => ({
  ...await importOriginal<typeof import('./http/rate-limit')>(),
  enforceRateLimit: async () => {},
}));

import { POST as actionPost } from '../app/api/phases/[phaseId]/actions/route';
import { POST as phasePost } from '../app/api/games/[gameId]/phases/route';
import { GET as playerGet } from '../app/api/player/route';
import { GET as messagesGet, POST as messagesPost } from '../app/api/rooms/[roomId]/messages/route';
import { GET as spectatorsGet, POST as spectatorsPost } from '../app/api/games/[gameId]/spectators/route';
import { DELETE as spectatorDelete } from '../app/api/games/[gameId]/spectators/[spectatorId]/route';
import { POST as spectatePost } from '../app/api/spectate/[code]/route';
import { POST as loginPost } from '../app/api/seats/login/route';
import { hashSecret } from './auth/crypto';
import { GET as votesGet } from '../app/api/phases/[phaseId]/votes/route';
import { GET as roomsGet, POST as roomsPost } from '../app/api/games/[gameId]/rooms/route';
import { ensureGameRooms } from './chat/rooms';

let client: Client;

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

const gameContext = { params: Promise.resolve({ gameId: 'game' }) };
const phaseContext = { params: Promise.resolve({ phaseId: 'phase' }) };

function asPlayer(seatId: string, alive = true) {
  shared.currentSpectator = null;
  shared.currentPlayer = { seatId, gameId: 'game', displayName: seatId, alive };
}

function asSpectator(spectatorId: string) {
  shared.currentPlayer = null;
  shared.currentSpectator = { spectatorId, gameId: 'game', displayName: 'Riley Watcher' };
}

async function vote(seatId: string, actionKind: string, targetIds: string[]) {
  asPlayer(seatId);
  const response = await actionPost(post('/api/phases/phase/actions', { actionKind, targetIds }), phaseContext);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function phaseAction(body: Record<string, unknown>) {
  const response = await phasePost(post('/api/games/game/phases', { phaseId: 'phase', ...body }), gameContext);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function dashboard() {
  const response = await playerGet(get('/api/player'));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
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

function expectNoPrivateKeys(payload: unknown) {
  const leaked = [...keysOf(payload)].filter((key) => FORBIDDEN_PLAYER_KEYS.has(key));
  expect(leaked).toEqual([]);
}

/**
 * Eight fictional players on an open Day. P6 and P7 were eliminated earlier
 * (a Villager and a Werewolf), so they make up the Afterlife.
 */
beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  shared.currentPlayer = null;
  shared.currentSpectator = null;
  await client.batch([
    { sql: "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','x','[]','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Afterlife test','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01')", args: [] },
    { sql: "INSERT INTO assignment_batches (id,game_id,revision,assignments_json,random_evidence_hash,created_by_moderator_id,created_at) VALUES ('batch','game',1,'[]','hash','mod','2026-01-01')", args: [] },
    { sql: "INSERT INTO phases (id,game_id,sequence,kind,status,opens_at,closes_at,slots,divisor_snapshot,created_at,updated_at) VALUES ('phase','game',3,'DAY','OPEN','2026-01-01','2099-01-01',1,30,'2026-01-01','2026-01-01')", args: [] },
  ], 'write');
  const roles = ['VILLAGER', 'VILLAGER', 'VILLAGER', 'SEER', 'WEREWOLF', 'WEREWOLF', 'VILLAGER', 'WEREWOLF'];
  for (const [index, role] of roles.entries()) {
    await client.batch([
      { sql: "INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,alive,created_at,updated_at) VALUES (?, 'game', ?, ?, 'CLAIMED', ?, ?, '2026-01-01', '2026-01-01')", args: [`p${index}`, `Player ${index}`, `p${index}@pilot.test`, `hash-${index}`, index >= 6 ? 0 : 1] },
      { sql: "INSERT INTO role_assignments (game_id,seat_id,role_key,assignment_batch_id) VALUES ('game', ?, ?, 'batch')", args: [`p${index}`, role] },
    ], 'write');
  }
  await ensureGameRooms('game');
});

afterEach(() => {
  shared.db = null;
  client.close();
});

describe('Afterlife tiebreak vote', () => {
  test('eliminated players cast an optional vote that breaks a tie in the living vote', async () => {
    // The Afterlife may use only its own ballot; the living may not use it.
    const deadDayVote = await vote('p6', 'DAY_VOTE', ['p0']);
    expect(deadDayVote).toEqual({ status: 400, body: { ok: false, error: 'Eliminated players cannot submit this action.' } });
    expect((await vote('p0', 'AFTERLIFE_VOTE', ['p1'])).status).toBe(400);
    expect((await vote('p6', 'AFTERLIFE_VOTE', ['p7'])).status).toBe(400);

    asPlayer('p6', false);
    const deadView = await dashboard();
    expect(deadView.body.permission).toMatchObject({ actionKind: 'AFTERLIFE_VOTE', maxTargets: 1 });
    expect(deadView.body.participation).toEqual({ submitted: 0, eligible: 2 });

    // The living vote ties 3–3 between P4 and P0.
    for (const voter of ['p0', 'p1', 'p2']) expect((await vote(voter, 'DAY_VOTE', ['p4'])).status).toBe(200);
    for (const voter of ['p3', 'p4', 'p5']) expect((await vote(voter, 'DAY_VOTE', ['p0'])).status).toBe(200);
    expect((await vote('p6', 'AFTERLIFE_VOTE', ['p4'])).status).toBe(200);

    asPlayer('p6', false);
    expect((await dashboard()).body.participation).toEqual({ submitted: 1, eligible: 2 });

    const locked = await phaseAction({ action: 'LOCK_AND_PROPOSE' });
    expect(locked.status).toBe(200);
    const outcome = locked.body.outcome as { eliminations: Array<{ playerId: string }>; randomDraws: unknown[]; afterlifeTally: unknown; afterlifeTiebreak: { decided: boolean } };
    expect(outcome.eliminations.map((item) => item.playerId)).toEqual(['p4']);
    expect(outcome.randomDraws).toEqual([]);
    expect(outcome.afterlifeTally).toEqual([{ playerId: 'p4', votes: 1 }]);
    expect(outcome.afterlifeTiebreak.decided).toBe(true);
    expect((await phaseAction({ action: 'PUBLISH' })).status).toBe(200);

    // Players learn only that the Afterlife broke the tie; its votes stay out of the public ballot.
    asPlayer('p1');
    const view = await dashboard();
    expectNoPrivateKeys(view.body);
    const published = (view.body.timeline as Array<{ eventType: string; payload: Record<string, unknown> }>).find((event) => event.eventType === 'PHASE_PUBLISHED');
    expect(published?.payload).toMatchObject({ afterlifeBrokeTie: true, voteCount: 6 });
    expect((published?.payload.votes as unknown[]).length).toBe(6);
  });

  test('without a tie the Afterlife changes nothing and the result carries no tiebreak note', async () => {
    for (const voter of ['p0', 'p1', 'p2', 'p3']) await vote(voter, 'DAY_VOTE', ['p4']);
    await vote('p5', 'DAY_VOTE', ['p0']);
    await vote('p6', 'AFTERLIFE_VOTE', ['p0']);
    await vote('p7', 'AFTERLIFE_VOTE', ['p0']);
    const locked = await phaseAction({ action: 'LOCK_AND_PROPOSE' });
    expect((locked.body.outcome as { eliminations: Array<{ playerId: string }> }).eliminations.map((item) => item.playerId)).toEqual(['p4']);
    expect((await phaseAction({ action: 'PUBLISH' })).status).toBe(200);
    asPlayer('p1');
    const published = ((await dashboard()).body.timeline as Array<{ eventType: string; payload: Record<string, unknown> }>).find((event) => event.eventType === 'PHASE_PUBLISHED');
    expect(published?.payload).not.toHaveProperty('afterlifeBrokeTie');
  });

  test('a tie the Afterlife settles only in part goes to a draw and gets no public note', async () => {
    await client.execute("UPDATE phases SET slots = 2");
    // P1, P2, and P3 tie with one vote each for two slots; the Afterlife backs only P1.
    await vote('p0', 'DAY_VOTE', ['p1']);
    await vote('p1', 'DAY_VOTE', ['p2']);
    await vote('p2', 'DAY_VOTE', ['p3']);
    await vote('p6', 'AFTERLIFE_VOTE', ['p1']);
    const locked = await phaseAction({ action: 'LOCK_AND_PROPOSE' });
    const outcome = locked.body.outcome as { selectedTargets: string[]; randomDraws: Array<{ candidates: string[] }>; afterlifeTiebreak: { selected: string[]; decided: boolean } };
    expect(outcome.selectedTargets[0]).toBe('p1');
    expect(outcome.afterlifeTiebreak).toMatchObject({ selected: ['p1'], decided: false });
    expect(outcome.randomDraws[0].candidates).toEqual(['p2', 'p3']);
    expect((await phaseAction({ action: 'PUBLISH' })).status).toBe(200);
    asPlayer('p0');
    const published = ((await dashboard()).body.timeline as Array<{ eventType: string; payload: Record<string, unknown> }>).find((event) => event.eventType === 'PHASE_PUBLISHED');
    expect(published?.payload).not.toHaveProperty('afterlifeBrokeTie');
  });

  test('a Night has no Afterlife ballot', async () => {
    await client.execute("UPDATE phases SET kind = 'NIGHT'");
    expect((await vote('p6', 'AFTERLIFE_VOTE', ['p0'])).status).toBe(400);
    asPlayer('p6', false);
    expect((await dashboard()).body.permission).toMatchObject({ actionKind: null, label: 'Spectating the village' });
  });
});

describe('spectators', () => {
  async function addSpectator(displayName: string, email: string) {
    const response = await spectatorsPost(post('/api/games/game/spectators', { displayName, email }), gameContext);
    return { status: response.status, body: await response.json() as { spectator?: { id: string }; spectateUrl?: string; error?: string } };
  }

  async function openLink(url: string, pin: string) {
    const code = decodeURIComponent(url.split('/spectate/')[1]);
    const response = await spectatePost(post(`/api/spectate/${code}`, { pin }), { params: Promise.resolve({ code }) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  async function afterlifeRoomId(): Promise<string> {
    return String((await client.execute("SELECT id FROM chat_rooms WHERE game_id = 'game' AND type = 'DEAD'")).rows[0]?.id);
  }

  test('a moderator adds a spectator to a running game, never with a player\'s email', async () => {
    expect((await addSpectator('Player Zero', 'P0@pilot.test')).status).toBe(409);
    const added = await addSpectator('Riley Watcher', 'riley@pilot.test');
    expect(added.status).toBe(200);
    expect(added.body.spectateUrl).toMatch(/\/spectate\//u);
    expect((await addSpectator('Riley Again', 'riley@pilot.test')).status).toBe(409);
    const list = await (await spectatorsGet(get('/api/games/game/spectators'), gameContext)).json() as { spectators: Array<{ displayName: string; status: string }> };
    expect(list.spectators).toEqual([expect.objectContaining({ displayName: 'Riley Watcher', status: 'INVITED' })]);

    await client.execute("UPDATE games SET status = 'COMPLETED'");
    expect((await addSpectator('Late Arrival', 'late@pilot.test')).status).toBe(409);
  });

  test('the spectator link sets a PIN once, then signs in only with that PIN', async () => {
    const added = await addSpectator('Riley Watcher', 'riley@pilot.test');
    expect((await openLink(added.body.spectateUrl!, '123456')).body).toMatchObject({ ok: true, claimed: true });
    expect((await openLink(added.body.spectateUrl!, '999999')).status).toBe(401);
    expect((await openLink(added.body.spectateUrl!, '123456')).body).toMatchObject({ ok: true, claimed: false });
    const sessions = await client.execute('SELECT COUNT(*) AS count FROM spectator_sessions');
    expect(Number(sessions.rows[0]?.count)).toBe(2);

    expect((await spectatorDelete(new Request('http://localhost:3000/api/games/game/spectators/x', { method: 'DELETE', headers: { origin: 'http://localhost:3000' } }), { params: Promise.resolve({ gameId: 'game', spectatorId: added.body.spectator!.id }) })).status).toBe(200);
    expect((await openLink(added.body.spectateUrl!, '123456')).status).toBe(404);
    expect(Number((await client.execute('SELECT COUNT(*) AS count FROM spectator_sessions')).rows[0]?.count)).toBe(0);
  });

  async function homePageSignIn(identifier: string, pin: string) {
    const response = await loginPost(post('/api/seats/login', { identifier, pin }));
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  test('a spectator signs back in from the home page with the email the moderator added and their PIN', async () => {
    const added = await addSpectator('Riley Watcher', 'riley@pilot.test');
    // Before they open their link there is no PIN yet, so the email alone gets nowhere.
    expect((await homePageSignIn('riley@pilot.test', '123456')).status).toBe(401);
    await openLink(added.body.spectateUrl!, '123456');
    const before = Number((await client.execute('SELECT COUNT(*) AS count FROM spectator_sessions')).rows[0]?.count);

    expect((await homePageSignIn('Riley@Pilot.Test', '999999')).status).toBe(401);
    expect(await homePageSignIn('Riley@Pilot.Test', '123456')).toEqual({ status: 200, body: { ok: true, seat: { displayName: 'Riley Watcher', gameId: 'game' } } });
    expect(Number((await client.execute('SELECT COUNT(*) AS count FROM spectator_sessions')).rows[0]?.count)).toBe(before + 1);
  });

  test('wrong PINs from the home page and from the link count together toward one lockout', async () => {
    const added = await addSpectator('Riley Watcher', 'riley@pilot.test');
    await openLink(added.body.spectateUrl!, '123456');
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await homePageSignIn('riley@pilot.test', '000000')).status).toBe(401);
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await openLink(added.body.spectateUrl!, '000000')).status).toBe(401);
    // Even the right PIN is refused now, in either place, with the spectator's way back.
    const locked = await homePageSignIn('riley@pilot.test', '123456');
    expect(locked.status).toBe(423);
    expect(locked.body.error).toEqual(expect.stringContaining('remove you and add you again'));
    expect((await openLink(added.body.spectateUrl!, '123456')).status).toBe(423);
  });

  test('a removed spectator cannot sign in from the home page, and can be added again', async () => {
    const added = await addSpectator('Riley Watcher', 'riley@pilot.test');
    await openLink(added.body.spectateUrl!, '123456');
    await spectatorDelete(new Request('http://localhost:3000/api/games/game/spectators/x', { method: 'DELETE', headers: { origin: 'http://localhost:3000' } }), { params: Promise.resolve({ gameId: 'game', spectatorId: added.body.spectator!.id }) });
    expect((await homePageSignIn('riley@pilot.test', '123456')).status).toBe(401);

    const again = await addSpectator('Riley Watcher', 'riley@pilot.test');
    await openLink(again.body.spectateUrl!, '654321');
    expect((await homePageSignIn('riley@pilot.test', '123456')).status).toBe(401);
    expect((await homePageSignIn('riley@pilot.test', '654321')).status).toBe(200);
  });

  test('an email and PIN that match a spectator and a player in different games ask for the link or seat code', async () => {
    const added = await addSpectator('Riley Watcher', 'riley@pilot.test');
    await openLink(added.body.spectateUrl!, '123456');
    await client.batch([
      { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('other','Other game','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')", args: [] },
      { sql: "INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,pin_hash,created_at,updated_at) VALUES ('riley-seat','other','Riley','riley@pilot.test','CLAIMED','riley-claim',?,'2026-01-01','2026-01-01')", args: [await hashSecret('123456')] },
    ], 'write');
    const result = await homePageSignIn('riley@pilot.test', '123456');
    expect(result.status).toBe(409);
    expect(result.body.error).toEqual(expect.stringContaining('more than one game'));
    // Their private link still opens this game.
    expect((await openLink(added.body.spectateUrl!, '123456')).status).toBe(200);
  });

  async function playerInAnotherGame(email: string, pin: string, gameStatus = 'ACTIVE') {
    await client.batch([
      { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('other','Other game',?,'UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')", args: [gameStatus] },
      { sql: "INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,pin_hash,created_at,updated_at) VALUES ('riley-seat','other','Riley','riley@pilot.test','CLAIMED','riley-claim',?,'2026-01-01','2026-01-01')", args: [await hashSecret(pin)] },
    ], 'write');
    return email;
  }

  test('a spectator of a finished game does not stop the same person signing in to the game they are playing', async () => {
    const added = await addSpectator('Riley Watcher', 'riley@pilot.test');
    await openLink(added.body.spectateUrl!, '123456');
    await playerInAnotherGame('riley@pilot.test', '123456');
    await client.execute("UPDATE games SET status = 'COMPLETED' WHERE id = 'game'");
    expect(await homePageSignIn('riley@pilot.test', '123456')).toEqual({ status: 200, body: { ok: true, seat: { displayName: 'Riley', gameId: 'other' } } });
  });

  test('a spectator of a finished game can still sign in by email when nothing else matches', async () => {
    const added = await addSpectator('Riley Watcher', 'riley@pilot.test');
    await openLink(added.body.spectateUrl!, '123456');
    await client.execute("UPDATE games SET status = 'COMPLETED' WHERE id = 'game'");
    expect(await homePageSignIn('riley@pilot.test', '123456')).toEqual({ status: 200, body: { ok: true, seat: { displayName: 'Riley Watcher', gameId: 'game' } } });
  });

  test('a player in one finished game and a spectator in another finished game still sign in as the player', async () => {
    const added = await addSpectator('Riley Watcher', 'riley@pilot.test');
    await openLink(added.body.spectateUrl!, '123456');
    await playerInAnotherGame('riley@pilot.test', '123456', 'COMPLETED');
    await client.execute("UPDATE games SET status = 'COMPLETED' WHERE id = 'game'");
    expect((await homePageSignIn('riley@pilot.test', '123456')).body).toMatchObject({ ok: true, seat: { gameId: 'other' } });
  });

  test('a spectator sees the public game and the Afterlife, but no roles, votes in progress, or private rooms', async () => {
    const added = await addSpectator('Riley Watcher', 'riley@pilot.test');
    await openLink(added.body.spectateUrl!, '123456');
    const spectatorId = added.body.spectator!.id;
    await vote('p0', 'DAY_VOTE', ['p4']);

    asSpectator(spectatorId);
    const view = await dashboard();
    expect(view.status).toBe(200);
    expectNoPrivateKeys(view.body);
    expect(view.body).toMatchObject({
      viewer: 'SPECTATOR',
      player: { id: spectatorId, role: null, roleDefinition: null, teammates: [] },
      permission: { actionKind: null },
      candidates: [],
      notifications: [],
      participation: { submitted: 1, eligible: 6 },
    });
    const game = view.body.game as { livingPlayers: Array<Record<string, unknown>>; eliminatedPlayers: Array<{ role: string }> };
    // Living players carry no role; eliminated players show the role everyone already sees.
    expect(game.livingPlayers.every((player) => Object.keys(player).sort().join() === 'displayName,id')).toBe(true);
    expect(game.eliminatedPlayers.map((player) => player.role).sort()).toEqual(['VILLAGER', 'WEREWOLF']);
    const rooms = view.body.rooms as Array<{ id: string; type: string; access: string }>;
    expect(rooms).toEqual([
      expect.objectContaining({ type: 'DEAD', access: 'WRITE' }),
      expect.objectContaining({ type: 'TOWN_HALL', access: 'READ_ONLY' }),
    ]);

    // The spectator cannot act, and cannot open the pack's room.
    const action = await actionPost(post('/api/phases/phase/actions', { actionKind: 'DAY_VOTE', targetIds: ['p0'] }), phaseContext);
    expect(action.status).toBe(401);
    const packRoom = String((await client.execute("SELECT id FROM chat_rooms WHERE type = 'WEREWOLF'")).rows[0]?.id);
    expect((await messagesGet(get(`/api/rooms/${packRoom}/messages`), { params: Promise.resolve({ roomId: packRoom }) })).status).toBe(403);
    // Unpublished ballots are not public to spectators either.
    expect((await votesGet(get('/api/phases/phase/votes'), phaseContext)).status).toBe(404);
  });

  test('spectators and eliminated players share the Afterlife chat', async () => {
    const added = await addSpectator('Riley Watcher', 'riley@pilot.test');
    await openLink(added.body.spectateUrl!, '123456');
    const roomId = await afterlifeRoomId();
    const roomContext = { params: Promise.resolve({ roomId }) };

    asSpectator(added.body.spectator!.id);
    expect((await messagesPost(post(`/api/rooms/${roomId}/messages`, { body: 'Watching from the gallery.' }), roomContext)).status).toBe(201);
    // Messages are ordered by time; keep the two apart by a few milliseconds.
    await new Promise((resolve) => setTimeout(resolve, 5));
    asPlayer('p6', false);
    expect((await messagesPost(post(`/api/rooms/${roomId}/messages`, { body: 'Welcome to the Afterlife.' }), roomContext)).status).toBe(201);

    for (const viewer of [() => asSpectator(added.body.spectator!.id), () => asPlayer('p7', false)]) {
      viewer();
      const messages = await (await messagesGet(get(`/api/rooms/${roomId}/messages`), roomContext)).json() as { messages: Array<{ authorName: string; body: string }> };
      expect(messages.messages.map((message) => `${message.authorName}: ${message.body}`)).toEqual([
        'Riley Watcher (spectator): Watching from the gallery.',
        'Player 6: Welcome to the Afterlife.',
      ]);
    }

    // A living player still can't read the Afterlife.
    asPlayer('p0');
    expect((await messagesGet(get(`/api/rooms/${roomId}/messages`), roomContext)).status).toBe(403);

    // Moderators see and can remove a spectator's message like any other.
    const moderation = await (await roomsGet(get('/api/games/game/rooms'), gameContext)).json() as {
      rooms: Array<{ type: string; messageCount: number }>;
      recentMessages: Array<{ id: string; authorName: string; roomType: string }>;
    };
    expect(moderation.rooms.find((room) => room.type === 'DEAD')?.messageCount).toBe(2);
    const spectatorMessage = moderation.recentMessages.find((message) => message.authorName === 'Riley Watcher (spectator)');
    expect(spectatorMessage?.roomType).toBe('DEAD');
    expect((await roomsPost(post('/api/games/game/rooms', { action: 'DELETE_MESSAGE', messageId: spectatorMessage?.id, reason: 'Testing moderation' }), gameContext)).status).toBe(200);
    expect((await client.execute('SELECT body, deleted_at FROM spectator_messages')).rows[0]).toMatchObject({ body: null });

    // A removed spectator can no longer post, even from a device that kept its session.
    await client.execute("UPDATE spectators SET status = 'REMOVED'");
    asSpectator(added.body.spectator!.id);
    expect((await messagesPost(post(`/api/rooms/${roomId}/messages`, { body: 'Still here?' }), roomContext)).status).toBe(409);
  });
});

describe('Town Hall', () => {
  async function townHallId(): Promise<string> {
    return String((await client.execute("SELECT id FROM chat_rooms WHERE game_id = 'game' AND type = 'TOWN_HALL'")).rows[0]?.id);
  }

  async function roomsOf(): Promise<Array<{ type: string; access: string }>> {
    const view = await dashboard();
    return (view.body.rooms as Array<{ type: string; access: string }>).map(({ type, access }) => ({ type, access }));
  }

  test('every player and spectator reads it; only living players post', async () => {
    const roomId = await townHallId();
    const roomContext = { params: Promise.resolve({ roomId }) };

    // A living Werewolf posts for the whole village.
    asPlayer('p4');
    expect(await roomsOf()).toEqual([{ type: 'TOWN_HALL', access: 'WRITE' }, { type: 'WEREWOLF', access: 'WRITE' }]);
    expect((await messagesPost(post(`/api/rooms/${roomId}/messages`, { body: 'I trust Player 0.' }), roomContext)).status).toBe(201);

    // An eliminated player and a spectator read it, but cannot post.
    asPlayer('p6', false);
    expect(await roomsOf()).toEqual([{ type: 'DEAD', access: 'WRITE' }, { type: 'TOWN_HALL', access: 'READ_ONLY' }]);
    expect((await messagesPost(post(`/api/rooms/${roomId}/messages`, { body: 'From beyond.' }), roomContext)).status).toBe(400);

    const added = await spectatorsPost(post('/api/games/game/spectators', { displayName: 'Riley Watcher', email: 'riley@pilot.test' }), gameContext);
    const spectatorId = (await added.json() as { spectator: { id: string } }).spectator.id;
    asSpectator(spectatorId);
    expect((await messagesPost(post(`/api/rooms/${roomId}/messages`, { body: 'Hello village.' }), roomContext)).status).toBe(400);

    for (const viewer of [() => asPlayer('p0'), () => asPlayer('p6', false), () => asSpectator(spectatorId)]) {
      viewer();
      const response = await messagesGet(get(`/api/rooms/${roomId}/messages`), roomContext);
      expect(response.status).toBe(200);
      const body = await response.json() as { messages: Array<{ authorName: string; body: string }> };
      expectNoPrivateKeys(body);
      expect(body.messages.map((message) => `${message.authorName}: ${message.body}`)).toEqual(['Player 4: I trust Player 0.']);
    }
    expect(Number((await client.execute('SELECT COUNT(*) AS count FROM chat_messages')).rows[0]?.count)).toBe(1);
    expect(Number((await client.execute('SELECT COUNT(*) AS count FROM spectator_messages')).rows[0]?.count)).toBe(0);
  });

  test('a player eliminated after their last read cannot post, and the room locks with the game', async () => {
    const roomId = await townHallId();
    const roomContext = { params: Promise.resolve({ roomId }) };
    // Eliminated, but membership not yet synced: the insert itself re-checks that the author is alive.
    await client.execute("UPDATE seats SET alive = 0 WHERE id = 'p0'");
    asPlayer('p0');
    expect((await messagesPost(post(`/api/rooms/${roomId}/messages`, { body: 'Still here?' }), roomContext)).status).toBe(409);

    await client.execute("UPDATE games SET status = 'COMPLETED'");
    asPlayer('p1');
    expect((await messagesPost(post(`/api/rooms/${roomId}/messages`, { body: 'Good game.' }), roomContext)).status).toBe(409);
  });
});
