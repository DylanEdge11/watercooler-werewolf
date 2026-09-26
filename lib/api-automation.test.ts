import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';

const shared = vi.hoisted(() => ({
  db: null as LibsqlDatabase | null,
  currentPlayer: null as { seatId: string; gameId: string } | null,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/auth/authorization', () => ({ requireGameModerator: async () => ({ id: 'mod' }) }));
vi.mock('../lib/auth/session', () => ({ getCurrentPlayer: async () => shared.currentPlayer }));

import { GET as phaseGet, POST as phasePost } from '../app/api/games/[gameId]/phases/route';
import { POST as automationPost } from '../app/api/games/[gameId]/automation/route';
import { GET as playerGet } from '../app/api/player/route';
import { GET as schedulerGet } from '../app/api/scheduler/deadlines/route';
import { advanceGame, advanceGameSafely } from './game/automation-sweep';

let client: Client;
const context = { params: Promise.resolve({ gameId: 'game' }) };

function post(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

async function exec(sql: string, args: Array<string | number | null> = []): Promise<void> {
  await client.execute({ sql, args });
}

async function rows<T>(sql: string): Promise<T[]> {
  return (await client.execute(sql)).rows as unknown as T[];
}

/** An automatic game with 20 fictional players, three of them Werewolves, and a Day past its deadline. */
async function seed(options: { mode?: 'AUTOMATIC' | 'REVIEW'; windowMinutes?: number; paused?: boolean } = {}): Promise<void> {
  await exec("INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','fake','[]','2026-01-01','2026-01-01')");
  await exec(
    `INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at,publication_mode,review_window_minutes,automation_paused_at)
     VALUES ('game','Automation test','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01',?,?,?)`,
    [options.mode ?? 'AUTOMATIC', options.windowMinutes ?? 60, options.paused ? '2026-01-02T00:00:00.000Z' : null],
  );
  await exec("INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01')");
  await exec("INSERT INTO assignment_batches (id,game_id,revision,assignments_json,random_evidence_hash,created_by_moderator_id,created_at) VALUES ('batch','game',1,'[]','hash','mod','2026-01-01')");
  await exec("INSERT INTO phases (id,game_id,sequence,kind,status,opens_at,closes_at,slots,divisor_snapshot,created_at,updated_at) VALUES ('phase','game',1,'DAY','OPEN','2026-01-01','2026-01-02T00:00:00.000Z',1,30,'2026-01-01','2026-01-01')");
  for (let index = 0; index < 20; index += 1) {
    await exec("INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,created_at,updated_at) VALUES (?,?,?,?,'CLAIMED',?,'2026-01-01','2026-01-01')", [`p${index}`, 'game', `Player ${index}`, `p${index}@pilot.test`, `hash-${index}`]);
    await exec("INSERT INTO role_assignments (game_id,seat_id,role_key,assignment_batch_id) VALUES ('game',?,?,'batch')", [`p${index}`, index > 16 ? 'WEREWOLF' : 'VILLAGER']);
  }
  // Everyone votes out Player 1.
  await exec("INSERT INTO action_submissions (id,phase_id,actor_seat_id,kind,target_ids_json,version,submitted_at) SELECT 'v' || id, 'phase', id, 'DAY_VOTE', '[\"p1\"]', 1, '2026-01-01' FROM seats WHERE id != 'p1'");
}

async function phaseStatus(): Promise<string> {
  return (await rows<{ status: string }>("SELECT status FROM phases WHERE id = 'phase'"))[0].status;
}

async function publications(): Promise<Array<{ actor: string | null; payload: string }>> {
  return rows("SELECT actor_moderator_id AS actor, payload_json AS payload FROM game_events WHERE event_type = 'PHASE_PUBLISHED'");
}

async function playerVisit(seatId = 'p5') {
  shared.currentPlayer = { seatId, gameId: 'game' };
  const response = await playerGet(new Request('http://localhost:3000/api/player'));
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    game: { automationPaused: boolean };
    phase: null | { status: string; autoPublishAt: string | null };
    timeline: Array<{ eventType: string; payload: Record<string, unknown> }>;
  }>;
}

/** Pretend the calculated result has been waiting for review for two hours. */
async function ageReview(): Promise<void> {
  await exec("UPDATE phases SET updated_at = ? WHERE id = 'phase' AND status = 'PENDING_APPROVAL'", [new Date(Date.now() - 2 * 60 * 60_000).toISOString()]);
}

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  shared.currentPlayer = null;
});

afterEach(() => {
  shared.db = null;
  client.close();
});

describe('automatic publication', () => {
  test('a player visit after the deadline locks and calculates; a visit after the review window publishes with no moderator', async () => {
    await seed();
    const waiting = await playerVisit();
    expect(await phaseStatus()).toBe('PENDING_APPROVAL');
    expect(await publications()).toHaveLength(0);
    // Players are told when results will publish.
    expect(waiting.phase?.status).toBe('PENDING_APPROVAL');
    expect(new Date(waiting.phase?.autoPublishAt ?? 0).valueOf()).toBeGreaterThan(Date.now() + 59 * 60_000);

    await ageReview();
    const published = await playerVisit();
    expect(await phaseStatus()).toBe('PUBLISHED');
    const [event] = await publications();
    expect(event.actor).toBeNull();
    expect(JSON.parse(event.payload)).toMatchObject({ source: 'SCHEDULER', overrideReason: null });
    expect((await rows<{ reviewer: string | null; status: string }>("SELECT reviewed_by_moderator_id AS reviewer, status FROM resolution_proposals"))[0]).toEqual({ reviewer: null, status: 'APPROVED' });
    expect((await rows<{ alive: number }>("SELECT alive FROM seats WHERE id = 'p1'"))[0].alive).toBe(0);
    // Room access changes in the same publication: the eliminated player is in the Afterlife.
    expect(await rows(`SELECT m.seat_id AS seatId, r.type, m.access FROM chat_room_members m JOIN chat_rooms r ON r.id = m.room_id
      WHERE m.seat_id IN ('p1', 'p17') ORDER BY m.seat_id, r.type`)).toEqual([
      { seatId: 'p1', type: 'DEAD', access: 'WRITE' },
      { seatId: 'p17', type: 'WEREWOLF', access: 'WRITE' },
    ]);
    const timelineEntry = published.timeline.find((entry) => entry.eventType === 'PHASE_PUBLISHED');
    expect(timelineEntry?.payload.publishedAutomatically).toBe(true);
  });

  test('a step that keeps failing logs one warning an hour, not one per visit', async () => {
    await seed();
    await playerVisit();
    expect(await phaseStatus()).toBe('PENDING_APPROVAL');
    await ageReview();
    // A corrupt stored override makes every automatic publish attempt throw.
    await exec("UPDATE resolution_proposals SET override_json = 'not json'");
    for (let visit = 0; visit < 5; visit += 1) await advanceGameSafely('game');
    expect(await phaseStatus()).toBe('PENDING_APPROVAL');
    const warnings = await rows<{ details: string }>("SELECT details_json AS details FROM operational_events WHERE source = 'AUTOMATION'");
    expect(warnings).toHaveLength(1);
    expect(JSON.parse(warnings[0].details)).toMatchObject({ phaseId: 'phase' });
  });

  test('a zero-minute window publishes on the same visit that calculates', async () => {
    await seed({ windowMinutes: 0 });
    await playerVisit();
    expect(await phaseStatus()).toBe('PUBLISHED');
  });

  test('review mode never locks, calculates, or publishes on its own', async () => {
    await seed({ mode: 'REVIEW' });
    await playerVisit();
    expect(await phaseStatus()).toBe('OPEN');
    await phasePost(post('/api/games/game/phases', { action: 'LOCK_AND_PROPOSE', phaseId: 'phase' }), context);
    await ageReview();
    const visit = await playerVisit();
    expect(visit.phase?.autoPublishAt).toBeNull();
    expect((await advanceGame('game'))).toEqual([]);
    expect(await phaseStatus()).toBe('PENDING_APPROVAL');
    expect(await publications()).toHaveLength(0);
  });

  test('pausing stops every automatic step until the moderator resumes', async () => {
    await seed({ paused: true });
    const paused = await playerVisit();
    expect(paused.game.automationPaused).toBe(true);
    expect(await phaseStatus()).toBe('OPEN');

    const resumed = await automationPost(post('/api/games/game/automation', { action: 'RESUME' }), context);
    expect(resumed.status).toBe(200);
    await playerVisit();
    expect(await phaseStatus()).toBe('PENDING_APPROVAL');

    expect((await automationPost(post('/api/games/game/automation', { action: 'PAUSE' }), context)).status).toBe(200);
    await ageReview();
    await playerVisit();
    expect(await phaseStatus()).toBe('PENDING_APPROVAL');
    const audit = await rows<{ type: string; actor: string }>("SELECT event_type AS type, actor_moderator_id AS actor FROM game_events WHERE event_type LIKE 'AUTOMATION_%' ORDER BY created_at");
    expect(audit).toEqual([{ type: 'AUTOMATION_RESUMED', actor: 'mod' }, { type: 'AUTOMATION_PAUSED', actor: 'mod' }]);
  });

  test('a moderator publishing at the same moment as the sweep produces one publication', async () => {
    await seed();
    await advanceGame('game');
    await ageReview();
    const [moderator] = await Promise.all([
      phasePost(post('/api/games/game/phases', { action: 'PUBLISH', phaseId: 'phase' }), context),
      advanceGame('game'),
    ]);
    expect([200, 409]).toContain(moderator.status);
    expect(await publications()).toHaveLength(1);
    expect((await rows<{ count: number }>("SELECT COUNT(*) AS count FROM seats WHERE alive = 0"))[0].count).toBe(1);
  });

  test('two sweeps at once calculate once and publish once', async () => {
    await seed({ windowMinutes: 0 });
    await Promise.all([advanceGame('game'), advanceGame('game'), playerVisit('p6'), playerVisit('p7')]);
    expect(await phaseStatus()).toBe('PUBLISHED');
    expect(await publications()).toHaveLength(1);
    expect((await rows<{ count: number }>('SELECT COUNT(*) AS count FROM resolution_proposals'))[0].count).toBe(1);
  });

  test('a moderator override before the window ends wins, and the sweep does not publish again', async () => {
    await seed();
    await advanceGame('game');
    const override = await phasePost(post('/api/games/game/phases', { action: 'PUBLISH', phaseId: 'phase', overrideEliminationIds: ['p2'], overrideReason: 'Correcting a vote cast by email.' }), context);
    expect(override.status).toBe(200);
    await ageReview();
    expect(await advanceGame('game')).toEqual([]);
    const [event] = await publications();
    expect(event.actor).toBe('mod');
    expect(JSON.parse(event.payload)).toMatchObject({ source: 'MODERATOR' });
  });

  test('a Hunter follow-up finishes once the shot is saved, then publishes after the window', async () => {
    await seed({ windowMinutes: 0 });
    await exec("UPDATE role_assignments SET role_key = 'HUNTER' WHERE seat_id = 'p1'");
    expect(await advanceGame('game')).toEqual(['LOCK_AND_PROPOSE']);
    expect(await phaseStatus()).toBe('PENDING_HUNTER');
    expect(await advanceGame('game')).toEqual([]);

    await exec("INSERT INTO action_submissions (id,phase_id,actor_seat_id,kind,target_ids_json,version,submitted_at) VALUES ('shot','phase','p1','HUNTER_SHOT','[\"p2\"]',1,'2026-01-03')");
    expect(await advanceGame('game')).toEqual(['FINALIZE_HUNTER', 'PUBLISH']);
    const dead = await rows<{ id: string }>("SELECT id FROM seats WHERE alive = 0 ORDER BY id");
    expect(dead.map((seat) => seat.id)).toEqual(['p1', 'p2']);
  });

  test('a Hunter who never shoots is skipped once their window closes', async () => {
    await seed({ windowMinutes: 0 });
    await exec("UPDATE role_assignments SET role_key = 'HUNTER' WHERE seat_id = 'p1'");
    await advanceGame('game');
    await exec("UPDATE phases SET hunter_deadline_at = '2026-01-03T00:00:00.000Z' WHERE id = 'phase'");
    expect(await advanceGame('game')).toEqual(['FINALIZE_HUNTER', 'PUBLISH']);
    expect((await rows<{ id: string }>("SELECT id FROM seats WHERE alive = 0")).map((seat) => seat.id)).toEqual(['p1']);
  });

  test('the moderator console refresh also moves the game on', async () => {
    await seed({ windowMinutes: 0 });
    const response = await phaseGet(new Request('http://localhost:3000/api/games/game/phases'), context);
    expect(response.status).toBe(200);
    const body = await response.json() as { phases: Array<{ status: string; publishedAutomatically?: boolean }> };
    expect(body.phases[0]).toMatchObject({ status: 'PUBLISHED', publishedAutomatically: true });
  });

  test('the scheduler route sweeps automatic games', async () => {
    await seed({ windowMinutes: 0 });
    vi.stubEnv('CRON_SECRET', 'fictional-cron-secret');
    try {
      const response = await schedulerGet(new Request('http://localhost:3000/api/scheduler/deadlines', { headers: { authorization: 'Bearer fictional-cron-secret' } }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ automation: [{ gameId: 'game', steps: ['LOCK_AND_PROPOSE', 'PUBLISH'] }] });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await phaseStatus()).toBe('PUBLISHED');
  });
});

describe('automation settings route', () => {
  test('changes the mode and window mid-game with an audit event', async () => {
    await seed({ mode: 'REVIEW' });
    const response = await automationPost(post('/api/games/game/automation', { action: 'SETTINGS', publicationMode: 'AUTOMATIC', reviewWindowMinutes: 15 }), context);
    expect(response.status).toBe(200);
    expect((await rows<{ mode: string; window: number }>("SELECT publication_mode AS mode, review_window_minutes AS window FROM games"))[0]).toEqual({ mode: 'AUTOMATIC', window: 15 });
    const [event] = await rows<{ payload: string }>("SELECT payload_json AS payload FROM game_events WHERE event_type = 'AUTOMATION_SETTINGS_UPDATED'");
    expect(JSON.parse(event.payload)).toEqual({ publicationMode: 'AUTOMATIC', reviewWindowMinutes: 15, previousPublicationMode: 'REVIEW', previousReviewWindowMinutes: 60 });
  });

  test('rejects bad settings, and anything on a finished game', async () => {
    await seed();
    expect((await automationPost(post('/api/games/game/automation', { action: 'SETTINGS', reviewWindowMinutes: -5 }), context)).status).toBe(400);
    expect((await automationPost(post('/api/games/game/automation', { action: 'LAUNCH' }), context)).status).toBe(400);
    await exec("UPDATE games SET status = 'COMPLETED'");
    for (const action of ['PAUSE', 'RESUME', 'SETTINGS']) {
      expect((await automationPost(post('/api/games/game/automation', { action, publicationMode: 'REVIEW' }), context)).status).toBe(409);
    }
  });

  test('pausing twice is harmless', async () => {
    await seed();
    expect((await automationPost(post('/api/games/game/automation', { action: 'PAUSE' }), context)).status).toBe(200);
    const again = await automationPost(post('/api/games/game/automation', { action: 'PAUSE' }), context);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ idempotent: true });
    expect(await rows("SELECT 1 FROM game_events WHERE event_type = 'AUTOMATION_PAUSED'")).toHaveLength(1);
  });
});
