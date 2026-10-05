import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';

const shared = vi.hoisted(() => ({
  db: null as LibsqlDatabase | null,
  moderator: null as { id: string; email: string } | null,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('./auth/session', () => ({
  getCurrentModerator: async () => shared.moderator,
  createModeratorSession: async () => {},
  preparePlayerSession: async (seatId: string, version: number) => ({
    values: [crypto.randomUUID(), seatId, `token-${seatId}`, version, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    setCookie: async () => {},
  }),
}));

import { GET as signupsGet } from '../app/api/games/[gameId]/signups/route';
import { POST as reviewPost } from '../app/api/games/[gameId]/signups/review/route';
import { POST as rosterPost } from '../app/api/games/[gameId]/roster/route';
import { POST as seatsPost } from '../app/api/games/[gameId]/seats/route';
import { DELETE as seatDelete } from '../app/api/games/[gameId]/seats/[seatId]/route';
import { POST as claimPost } from '../app/api/seats/claim/[code]/route';
import { validateComposition } from './game/balance';
import { MAX_PLAYERS, MIN_PLAYERS } from './game/player-count';
import { ROLE_KEYS, type RoleComposition } from './game/types';

/*
 * Random sequences of every way the roster changes: people signing up, accepted, declined and put back; a list
 * added or replacing the roster; one player added or removed; a seat claimed; and two of these at the same
 * moment. After every step the roster, the role counts, and the sign-ups must still agree with each other.
 * The sequences are seeded, so a failure names the seed and the steps that led to it.
 */

let client: Client;
const ORIGIN = 'http://localhost:3000';
const gameCtx = { params: Promise.resolve({ gameId: 'game' }) };

function request(method: string, body?: unknown): Request {
  return new Request(`${ORIGIN}/api/test`, {
    method,
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

interface Reply { status: number; body: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
async function read(response: Response): Promise<Reply> {
  return { status: response.status, body: await response.json() as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function rows(sql: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  return (await client.execute({ sql, args })).rows as unknown as Array<Record<string, unknown>>;
}

/** Small seeded generator (mulberry32), so every run of a seed makes the same choices. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (low: number, high: number) => low + Math.floor(next() * (high - low + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (probability: number) => next() < probability,
  };
}

const POOL = 45;
const emailOf = (n: number) => `u${n}@pilot.test`;

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  await client.batch([
    { sql: "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('owner','owner@pilot.test','x','[]','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Random Campaign','REGISTRATION','UTC','2026-01-01','2027-01-01','[1]','{}','2026-12-01','owner','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','owner','OWNER','2026-01-01')", args: [] },
  ], 'write');
  shared.moderator = { id: 'owner', email: 'owner@pilot.test' };
});

afterEach(() => {
  shared.db = null;
  shared.moderator = null;
  client.close();
});

async function checkInvariants(context: string): Promise<void> {
  const seats = await rows("SELECT id, email, status, claim_code_hash AS hash FROM seats WHERE game_id = 'game' AND status != 'REMOVED'");
  const emails = seats.map((seat) => String(seat.email).toLowerCase());
  expect(new Set(emails).size, `${context}: one seat per email`).toBe(emails.length);
  expect(new Set(seats.map((seat) => seat.hash)).size, `${context}: every seat has its own link`).toBe(seats.length);
  expect(seats.length, `${context}: at most ${MAX_PLAYERS} players`).toBeLessThanOrEqual(MAX_PLAYERS);

  const counts = Object.fromEntries(ROLE_KEYS.map((role) => [role, 0])) as RoleComposition;
  for (const row of await rows("SELECT role_key AS roleKey, count FROM game_role_counts WHERE game_id = 'game'")) counts[String(row.roleKey) as keyof RoleComposition] = Number(row.count);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (seats.length >= MIN_PLAYERS) {
    expect(total, `${context}: role counts cover every seat`).toBe(seats.length);
    expect(validateComposition(counts, seats.length).valid, `${context}: role counts are a legal composition`).toBe(true);
  } else {
    expect(total, `${context}: a roster below the minimum has no role counts`).toBe(0);
  }

  const seatById = new Map(seats.map((seat) => [String(seat.id), String(seat.email).toLowerCase()]));
  for (const signup of await rows("SELECT email, status, seat_id AS seatId FROM signups WHERE game_id = 'game' AND status = 'ACCEPTED'")) {
    expect(signup.seatId, `${context}: an accepted sign-up points at a seat`).not.toBeNull();
    expect(seatById.get(String(signup.seatId)), `${context}: ... that is on the roster under the same email`).toBe(String(signup.email).toLowerCase());
  }

  const summary = await signupsGet(request('GET'), gameCtx);
  const listed = (await read(summary)).body.counts as { pending: number; accepted: number; declined: number };
  for (const status of ['PENDING', 'ACCEPTED', 'DECLINED'] as const) {
    const stored = Number((await rows("SELECT COUNT(*) AS count FROM signups WHERE game_id = 'game' AND status = ?", [status]))[0].count);
    expect(listed[status.toLowerCase() as 'pending'], `${context}: the console's ${status} count matches`).toBe(stored);
  }
}

describe('random roster, sign-up, and list changes keep everything in agreement', () => {
  const seeds = Array.from({ length: 14 }, (_, index) => 1000 + index * 37);

  test.each(seeds)('seed %i', async (seed) => {
    const random = generator(seed);
    const log: string[] = [];
    let lastRevision = 1;
    const tally: Record<string, number> = {};
    const note = (name: string, reply: Reply | null) => { if (reply) tally[`${name}:${reply.status}`] = (tally[`${name}:${reply.status}`] ?? 0) + 1; };

    const csvOf = (people: Array<{ name: string; email: string }>) => ['display_name,email', ...people.map((person) => `${person.name},${person.email}`)].join('\n');
    const someone = () => {
      const n = random.int(0, POOL - 1);
      // The same person can be typed with different capitals.
      return { name: `Person ${n}`, email: random.chance(0.25) ? emailOf(n).toUpperCase() : emailOf(n) };
    };
    const people = (low: number, high: number) => {
      const chosen = new Map<string, { name: string; email: string }>();
      for (let index = random.int(low, high); index > 0; index -= 1) {
        const person = someone();
        chosen.set(person.email.toLowerCase(), person);
      }
      return [...chosen.values()];
    };
    const idsWhere = async (sql: string) => (await rows(sql)).map((row) => String(row.id));

    const operations: Record<string, () => Promise<Reply | null>> = {
      async visitors() {
        for (let index = random.int(1, 4); index > 0; index -= 1) {
          const n = random.int(0, POOL - 1);
          await client.execute({ sql: "INSERT OR IGNORE INTO signups (id,game_id,display_name,email,status,created_at) VALUES (?, 'game', ?, ?, 'PENDING', ?)", args: [`s-${seed}-${log.length}-${index}`, `Visitor ${n}`, emailOf(n), '2026-02-01T00:00:00.000Z'] });
        }
        return null;
      },
      async accept() {
        const pending = await idsWhere("SELECT id FROM signups WHERE game_id = 'game' AND status = 'PENDING'");
        if (!pending.length) return null;
        const chosen = pending.filter(() => random.chance(0.6));
        return read(await reviewPost(request('POST', { decision: 'ACCEPT', signupIds: chosen.length ? chosen : [pending[0]] }), gameCtx));
      },
      async decline() {
        const pending = await idsWhere("SELECT id FROM signups WHERE game_id = 'game' AND status IN ('PENDING', 'ACCEPTED')");
        if (!pending.length) return null;
        return read(await reviewPost(request('POST', { decision: 'DECLINE', signupIds: [random.pick(pending)] }), gameCtx));
      },
      async restore() {
        const declined = await idsWhere("SELECT id FROM signups WHERE game_id = 'game' AND status = 'DECLINED'");
        if (!declined.length) return null;
        return read(await reviewPost(request('POST', { decision: 'RESTORE', signupIds: [random.pick(declined)] }), gameCtx));
      },
      async addList() {
        return read(await rosterPost(request('POST', { csv: csvOf(people(1, 5)), mode: 'ADD' }), gameCtx));
      },
      async replace() {
        return read(await rosterPost(request('POST', { csv: csvOf(people(MIN_PLAYERS, 9)), mode: random.chance(0.5) ? 'REPLACE' : undefined }), gameCtx));
      },
      async addSeat() {
        const person = someone();
        return read(await seatsPost(request('POST', { displayName: person.name, email: person.email }), gameCtx));
      },
      async removeSeat() {
        const invited = await idsWhere("SELECT id FROM seats WHERE game_id = 'game' AND status = 'INVITED'");
        if (!invited.length) return null;
        return read(await seatDelete(request('DELETE'), { params: Promise.resolve({ gameId: 'game', seatId: random.pick(invited) }) }));
      },
      async claim() {
        const invited = await idsWhere("SELECT id FROM seats WHERE game_id = 'game' AND status = 'INVITED'");
        if (!invited.length) return null;
        // A claim needs the real link code, which is only ever shown once, so a seat is claimed by giving it one.
        const code = `code-${seed}-${log.length}`;
        const { sha256 } = await import('./auth/crypto');
        await client.execute({ sql: 'UPDATE seats SET claim_code_hash = ? WHERE id = ?', args: [await sha256(code), random.pick(invited)] });
        return read(await claimPost(request('POST', { pin: String(100000 + random.int(0, 899999)) }), { params: Promise.resolve({ code }) }));
      },
    };
    const names = Object.keys(operations);
    const weights: Record<string, number> = { visitors: 4, accept: 5, decline: 2, restore: 1, addList: 5, replace: 1, addSeat: 3, removeSeat: 3, claim: 1 };
    const weighted = names.flatMap((name) => Array.from({ length: weights[name] }, () => name));
    const racing = ['accept', 'addList', 'addSeat', 'removeSeat', 'decline'];

    for (let step = 0; step < 60; step += 1) {
      const context = `seed ${seed}, step ${step} after [${log.slice(-6).join(' > ')}]`;
      if (random.chance(0.15)) {
        // Two changes at the same moment.
        const [a, b] = [random.pick(racing), random.pick(racing)];
        log.push(`${a}+${b}`);
        const replies = await Promise.all([operations[a](), operations[b]()]);
        replies.forEach((reply) => note('race', reply));
        for (const reply of replies) if (reply) expect(reply.status, `${context}: ${a}+${b} answered ${reply.status} ${JSON.stringify(reply.body).slice(0, 160)}`).toBeLessThan(500);
      } else {
        const name = random.pick(weighted);
        log.push(name);
        const reply = await operations[name]();
        note(name, reply);
        if (reply) expect(reply.status, `${context}: ${name} answered ${reply.status} ${JSON.stringify(reply.body).slice(0, 160)}`).toBeLessThan(500);
        // A change that reports success is the roster it says it is.
        if (reply?.status === 200 && typeof reply.body.playerCount === 'number') {
          const seatTotal = Number((await rows("SELECT COUNT(*) AS count FROM seats WHERE game_id = 'game' AND status != 'REMOVED'"))[0].count);
          expect(reply.body.playerCount, `${context}: ${name} reported the roster size`).toBe(seatTotal);
        }
      }
      const revision = Number((await rows("SELECT setup_revision AS revision FROM games WHERE id = 'game'"))[0].revision);
      expect(revision, `${context}: the setup revision never goes backwards`).toBeGreaterThanOrEqual(lastRevision);
      lastRevision = revision;
      await checkInvariants(context);
    }
    // The run did real work: roster changes went through, and some were refused.
    const changes = Object.entries(tally).filter(([key]) => /^(accept|addList|replace|addSeat|removeSeat):200$/u.test(key)).reduce((sum, [, value]) => sum + value, 0);
    expect(changes, `seed ${seed} made roster changes ${JSON.stringify(tally)}`).toBeGreaterThanOrEqual(5);
    if (process.env.RANDOM_TALLY) process.stdout.write(`TALLY seed ${seed} ${JSON.stringify(tally)}\n`);
  }, 60_000);
});
