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
import { openPhase } from './game/phase-open';

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
async function seed(options: { mode?: 'AUTOMATIC' | 'REVIEW'; windowMinutes?: number; paused?: boolean; autoOpen?: boolean } = {}): Promise<void> {
  await exec("INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','fake','[]','2026-01-01','2026-01-01')");
  await exec(
    `INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at,publication_mode,review_window_minutes,automation_paused_at)
     VALUES ('game','Automation test','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01',?,?,?)`,
    [options.mode ?? 'AUTOMATIC', options.windowMinutes ?? 60, options.paused ? '2026-01-02T00:00:00.000Z' : null],
  );
  if (options.autoOpen) {
    // Played every day, with the Day closing at 17:00 and the Night at 08:00 (UTC).
    await exec("UPDATE games SET auto_open_next_phase = 1, active_weekdays_json = '[0,1,2,3,4,5,6]', schedule_json = '{\"dayCloses\":\"17:00\",\"nightCloses\":\"08:00\"}'");
  }
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
      { seatId: 'p1', type: 'TOWN_HALL', access: 'READ_ONLY' },
      { seatId: 'p17', type: 'TOWN_HALL', access: 'WRITE' },
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

  test('the console gets full results for the newest phase and a summary of older ones', async () => {
    await seed({ windowMinutes: 0 });
    type Phases = { phases: Array<{ id: string; status: string; publishedAutomatically?: boolean; proposal: { outcome: { eliminations: unknown[] } } | null }> };
    const load = async () => await (await phaseGet(new Request('http://localhost:3000/api/games/game/phases'), context)).json() as Phases;
    // While it is the newest phase, the published Day carries its result.
    const first = await load();
    expect(first.phases[0]).toMatchObject({ id: 'phase', status: 'PUBLISHED', publishedAutomatically: true });
    expect(first.phases[0].proposal?.outcome.eliminations).toHaveLength(1);
    // Once a newer phase opens, the Day is a summary that still says how it was published.
    await exec("INSERT INTO phases (id,game_id,sequence,kind,status,opens_at,closes_at,slots,divisor_snapshot,created_at,updated_at) VALUES ('night','game',2,'NIGHT','OPEN','2026-01-02','2099-01-01T00:00:00.000Z',1,30,'2026-01-02','2026-01-02')");
    const later = await load();
    expect(later.phases.map((phase) => phase.id)).toEqual(['night', 'phase']);
    expect(later.phases[1]).toMatchObject({ id: 'phase', publishedAutomatically: true, proposal: null });
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
    expect(JSON.parse(event.payload)).toEqual({ publicationMode: 'AUTOMATIC', reviewWindowMinutes: 15, autoOpenNextPhase: false, previousPublicationMode: 'REVIEW', previousReviewWindowMinutes: 60, previousAutoOpenNextPhase: false });
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

describe('unchanged refreshes', () => {
  test('a player refresh with nothing new is an empty 304, and any change sends the dashboard again', async () => {
    await seed({ mode: 'REVIEW' });
    shared.currentPlayer = { seatId: 'p5', gameId: 'game' };
    const load = (etag?: string | null) => playerGet(new Request('http://localhost:3000/api/player', { headers: etag ? { 'if-none-match': etag } : {} }));
    // The seed has no rooms: the first visit creates them while it reads, so it is the second that lists them.
    await load();
    const first = await load();
    const etag = first.headers.get('etag');
    expect(first.status).toBe(200);
    expect(etag).toMatch(/^"[\w-]+"$/u);
    const unchanged = await load(etag);
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe('');
    await exec("UPDATE seats SET display_name = 'Player Five' WHERE id = 'p5'");
    const changed = await load(etag);
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
  });

  test('the console phases refresh answers 304 until a phase changes', async () => {
    await seed({ mode: 'REVIEW' });
    const load = (etag?: string | null) => phaseGet(new Request('http://localhost:3000/api/games/game/phases', { headers: etag ? { 'if-none-match': etag } : {} }), context);
    const etag = (await load()).headers.get('etag');
    expect((await load(etag)).status).toBe(304);
    await exec("UPDATE phases SET closes_at = '2099-01-03T00:00:00.000Z' WHERE id = 'phase'");
    expect((await load(etag)).status).toBe(200);
  });
});

describe('opening the next phase automatically', () => {
  async function phaseList(): Promise<Array<{ sequence: number; kind: string; status: string; closesAt: string }>> {
    return rows("SELECT sequence, kind, status, closes_at AS closesAt FROM phases ORDER BY sequence");
  }

  test('after a result publishes, the next phase opens with the game\'s next close time and tells the timeline who opened it', async () => {
    await seed({ windowMinutes: 0, autoOpen: true });
    expect(await advanceGame('game')).toEqual(['LOCK_AND_PROPOSE', 'PUBLISH', 'OPEN_NEXT']);
    const [first, second] = await phaseList();
    expect(first).toMatchObject({ sequence: 1, kind: 'DAY', status: 'PUBLISHED' });
    expect(second).toMatchObject({ sequence: 2, kind: 'NIGHT', status: 'OPEN' });
    // The Night closes at 08:00 UTC, in the future and on the minute.
    expect(new Date(second.closesAt).valueOf()).toBeGreaterThan(Date.now());
    expect(second.closesAt).toMatch(/T08:00:00\.000Z$/u);
    const [opened] = await rows<{ actor: string | null; payload: string }>("SELECT actor_moderator_id AS actor, payload_json AS payload FROM game_events WHERE event_type = 'PHASE_OPENED'");
    expect(opened.actor).toBeNull();
    expect(JSON.parse(opened.payload)).toMatchObject({ kind: 'NIGHT', source: 'SCHEDULER' });
    // Nothing more to do until that Night ends.
    expect(await advanceGame('game')).toEqual([]);
  });

  test('a player visit does it too, so nobody waits for the moderator', async () => {
    await seed({ windowMinutes: 0, autoOpen: true });
    const visit = await playerVisit();
    expect(visit.phase?.status).toBe('OPEN');
    expect(await phaseList()).toHaveLength(2);
  });

  test('is off unless turned on', async () => {
    await seed({ windowMinutes: 0 });
    expect(await advanceGame('game')).toEqual(['LOCK_AND_PROPOSE', 'PUBLISH']);
    expect(await phaseList()).toHaveLength(1);
  });

  test('opens the next phase after the moderator publishes a result by hand, too', async () => {
    await seed({ autoOpen: true });
    await advanceGame('game');
    expect(await phaseStatus()).toBe('PENDING_APPROVAL');
    expect((await phasePost(post('/api/games/game/phases', { action: 'PUBLISH', phaseId: 'phase' }), context)).status).toBe(200);
    expect(await phaseList()).toHaveLength(1);
    expect(await advanceGame('game')).toEqual(['OPEN_NEXT']);
    expect((await phaseList())[1]).toMatchObject({ kind: 'NIGHT', status: 'OPEN' });
  });

  test('waits while paused and in review mode, and opens once automation is running again', async () => {
    await seed({ windowMinutes: 0, autoOpen: true });
    // Publish the first result with the option off, then turn it on while the game is paused.
    await exec('UPDATE games SET auto_open_next_phase = 0');
    expect(await advanceGame('game')).toEqual(['LOCK_AND_PROPOSE', 'PUBLISH']);
    await exec("UPDATE games SET auto_open_next_phase = 1, automation_paused_at = '2026-01-02T00:00:00.000Z'");
    expect(await advanceGame('game')).toEqual([]);
    await exec("UPDATE games SET automation_paused_at = NULL, publication_mode = 'REVIEW'");
    expect(await advanceGame('game')).toEqual([]);
    expect(await phaseList()).toHaveLength(1);
    await exec("UPDATE games SET publication_mode = 'AUTOMATIC'");
    expect(await advanceGame('game')).toEqual(['OPEN_NEXT']);
  });

  test('stops at the final cutoff and leaves final showdown to the moderator', async () => {
    await seed({ windowMinutes: 0, autoOpen: true });
    // The cutoff falls before the Night would close.
    await exec("UPDATE games SET final_cutoff_at = ?", [new Date(Date.now() + 60_000).toISOString()]);
    expect(await advanceGame('game')).toEqual(['LOCK_AND_PROPOSE', 'PUBLISH']);
    expect(await phaseList()).toHaveLength(1);
    expect((await rows<{ status: string }>('SELECT status FROM games'))[0].status).toBe('ACTIVE');
  });

  test('does not open a phase when a winner has ended the game', async () => {
    await seed({ windowMinutes: 0, autoOpen: true });
    // Only the Werewolves are left standing after this vote.
    await exec("UPDATE role_assignments SET role_key = 'WEREWOLF' WHERE seat_id IN ('p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12', 'p13', 'p14', 'p15', 'p16')");
    await exec("UPDATE seats SET alive = 0 WHERE id IN ('p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12', 'p13', 'p14', 'p15', 'p16')");
    expect(await advanceGame('game')).toEqual(['LOCK_AND_PROPOSE', 'PUBLISH']);
    expect((await rows<{ status: string }>('SELECT status FROM games'))[0].status).toBe('COMPLETED');
    expect(await phaseList()).toHaveLength(1);
  });

  test('two sweeps and a player visit at once open one phase', async () => {
    await seed({ windowMinutes: 0, autoOpen: true });
    await Promise.all([advanceGame('game'), advanceGame('game'), playerVisit('p6'), playerVisit('p7')]);
    expect(await phaseList()).toHaveLength(2);
    expect(await rows("SELECT 1 FROM game_events WHERE event_type = 'PHASE_OPENED'")).toHaveLength(1);
  });

  test('a moderator opening the same phase first leaves one phase and no warning', async () => {
    await seed({ autoOpen: true });
    await advanceGame('game');
    await phasePost(post('/api/games/game/phases', { action: 'PUBLISH', phaseId: 'phase' }), context);
    const closesAt = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    expect((await phasePost(post('/api/games/game/phases', { action: 'OPEN', kind: 'NIGHT', closesAt }), context)).status).toBe(200);
    expect(await advanceGame('game')).toEqual([]);
    expect(await phaseList()).toHaveLength(2);
    expect(await rows("SELECT 1 FROM operational_events WHERE source = 'AUTOMATION'")).toHaveLength(0);
  });

  describe('the opening re-checks the moderator\'s settings inside its write', () => {
    const scheduler = { moderatorId: null, source: 'SCHEDULER' } as const;
    const inThreeHours = () => new Date(Date.now() + 3 * 60 * 60_000);

    /** The first Day is published with the option off, then the option is turned on: the state just before an automatic opening. */
    async function readyToOpen(): Promise<void> {
      await seed({ windowMinutes: 0, autoOpen: true });
      await exec('UPDATE games SET auto_open_next_phase = 0');
      expect(await advanceGame('game')).toEqual(['LOCK_AND_PROPOSE', 'PUBLISH']);
      await exec('UPDATE games SET auto_open_next_phase = 1');
    }

    test.each([
      ['paused', "UPDATE games SET automation_paused_at = '2026-01-02T00:00:00.000Z'"],
      ['switched to review mode', "UPDATE games SET publication_mode = 'REVIEW'"],
      ['unticked the option', 'UPDATE games SET auto_open_next_phase = 0'],
    ])('an automatic opening that lost a race with the moderator having %s opens nothing', async (_what, change) => {
      await readyToOpen();
      await exec(change);
      const result = await openPhase('game', scheduler, 'NIGHT', inThreeHours());
      expect(result.status).toBe(409);
      expect(await phaseList()).toHaveLength(1);
      expect(await rows("SELECT 1 FROM game_events WHERE event_type = 'PHASE_OPENED'")).toHaveLength(0);
    });

    test('the moderator\'s own Open button works in all of those states', async () => {
      await readyToOpen();
      await exec("UPDATE games SET publication_mode = 'REVIEW', auto_open_next_phase = 0, automation_paused_at = '2026-01-02T00:00:00.000Z'");
      const response = await phasePost(post('/api/games/game/phases', { action: 'OPEN', kind: 'NIGHT', closesAt: inThreeHours().toISOString() }), context);
      expect(response.status).toBe(200);
      expect((await phaseList())[1]).toMatchObject({ kind: 'NIGHT', status: 'OPEN' });
      const [opened] = await rows<{ actor: string | null; payload: string }>("SELECT actor_moderator_id AS actor, payload_json AS payload FROM game_events WHERE event_type = 'PHASE_OPENED'");
      expect(opened.actor).toBe('mod');
      expect(JSON.parse(opened.payload)).toMatchObject({ source: 'MODERATOR' });
    });
  });
});

describe('opening the next phase: settings route', () => {
  test('turns it on and off with an audit event, and leaves it alone when a request does not mention it', async () => {
    await seed();
    const enabled = () => rows<{ enabled: number }>('SELECT auto_open_next_phase AS enabled FROM games').then((result) => result[0].enabled);
    expect(await enabled()).toBe(0);
    expect((await automationPost(post('/api/games/game/automation', { action: 'SETTINGS', autoOpenNextPhase: true }), context)).status).toBe(200);
    expect(await enabled()).toBe(1);
    expect((await automationPost(post('/api/games/game/automation', { action: 'SETTINGS', reviewWindowMinutes: 30 }), context)).status).toBe(200);
    expect(await enabled()).toBe(1);
    expect((await automationPost(post('/api/games/game/automation', { action: 'SETTINGS', autoOpenNextPhase: false }), context)).status).toBe(200);
    expect(await enabled()).toBe(0);
    const events = await rows<{ payload: string }>("SELECT payload_json AS payload FROM game_events WHERE event_type = 'AUTOMATION_SETTINGS_UPDATED' ORDER BY created_at, rowid");
    expect(JSON.parse(events[0].payload)).toMatchObject({ autoOpenNextPhase: true, previousAutoOpenNextPhase: false });
    expect(JSON.parse(events[2].payload)).toMatchObject({ autoOpenNextPhase: false, previousAutoOpenNextPhase: true });
  });

  test('rejects a value that is not true or false, and shows the setting to the console', async () => {
    await seed();
    expect((await automationPost(post('/api/games/game/automation', { action: 'SETTINGS', autoOpenNextPhase: 'maybe' }), context)).status).toBe(400);
    await automationPost(post('/api/games/game/automation', { action: 'SETTINGS', autoOpenNextPhase: true }), context);
    const body = await (await phaseGet(new Request('http://localhost:3000/api/games/game/phases'), context)).json() as { game: { autoOpenNextPhase: boolean } };
    expect(body.game.autoOpenNextPhase).toBe(true);
  });
});
