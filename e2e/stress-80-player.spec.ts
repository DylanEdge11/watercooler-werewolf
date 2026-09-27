import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Browser, type ConsoleMessage, type Page, type Request, type Response as PageResponse } from '@playwright/test';
import { GameHarness, requireOk, type Bot, type Dashboard, type Outcome } from './bot-farm';
import { FORBIDDEN_PLAYER_KEYS, getSharedModerator } from './readiness/browser-fixture';
import { newBrowserContext } from './transport';
import type { ActionKind, RoleComposition, RoleKey } from '../lib/game/types';

/*
 * Load test: a 20-player baseline game on its own, then two 80-player games
 * played at the same time against the same server. Every game ends in a
 * Werewolf win and uses every role. Each request is timed so the 80-player
 * numbers can be compared with the baseline.
 */

// ---------------------------------------------------------------- metrics

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

interface MetricRow { game: string; label: string; count: number; p50: number; p95: number; max: number; mean: number }

class Metrics {
  private readonly samples = new Map<string, number[]>();

  constructor(readonly game: string) {}

  record(label: string, milliseconds: number): void {
    const values = this.samples.get(label) ?? [];
    values.push(milliseconds);
    this.samples.set(label, values);
  }

  async time<T>(label: string, run: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await run();
    } finally {
      this.record(label, performance.now() - started);
    }
  }

  rows(): MetricRow[] {
    return [...this.samples].map(([label, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const round = (value: number) => Math.round(value);
      return {
        game: this.game,
        label,
        count: values.length,
        p50: round(percentile(sorted, 50)),
        p95: round(percentile(sorted, 95)),
        max: round(sorted[sorted.length - 1]),
        mean: round(values.reduce((total, value) => total + value, 0) / values.length),
      };
    });
  }
}

interface PhaseRecord {
  game: string;
  sequence: number;
  kind: string;
  living: number;
  slots: number;
  submissions: number;
  voteWallMs: number;
  sweepWallMs: number;
  sweepP95Ms: number;
  lockMs: number;
  publishMs: number;
  eliminated: number;
}

interface BrowserRecord { game: string; page: string; loadMs: number; problems: string[] }

const report = {
  startedAt: new Date().toISOString(),
  metrics: [] as MetricRow[],
  phases: [] as PhaseRecord[],
  browser: [] as BrowserRecord[],
  games: [] as Array<{ game: string; players: number; phases: number; winner: string | null; wallSeconds: number; roles: Record<string, number> }>,
};

function writeReport(): void {
  const directory = resolve(process.cwd(), 'work', 'stress');
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, `stress-${process.env.E2E_RUN_ID ?? 'local'}.json`), JSON.stringify(report, null, 2));
}

// ---------------------------------------------------------------- plans

function composition(counts: Partial<RoleComposition>): RoleComposition {
  return { VILLAGER: 0, WEREWOLF: 0, SEER: 0, BODYGUARD: 0, HUNTER: 0, MASON: 0, APPRENTICE_SEER: 0, MAYOR: 0, CUPID: 0, ...counts };
}

interface GamePlan {
  label: string;
  playerCount: number;
  composition: RoleComposition;
  dayDivisor: number;
  nightDivisor: number;
  /** Day Hunter and Cupid pairing two Villagers, or Night Hunter and Cupid pairing themself with a Werewolf. */
  variant: 'day-hunter' | 'night-hunter';
  /** Enter final showdown once this few players are alive; otherwise play Days and Nights to the end. */
  finalShowdownAtLiving?: number;
}

const BASELINE: GamePlan = {
  label: 'baseline-20',
  playerCount: 20,
  composition: composition({ VILLAGER: 8, WEREWOLF: 3, SEER: 1, BODYGUARD: 1, HUNTER: 1, MASON: 3, APPRENTICE_SEER: 1, MAYOR: 1, CUPID: 1 }),
  dayDivisor: 30,
  nightDivisor: 30,
  variant: 'day-hunter',
};

const GAME_A: GamePlan = {
  label: 'game-A-80',
  playerCount: 80,
  composition: composition({ VILLAGER: 57, WEREWOLF: 13, SEER: 1, BODYGUARD: 1, HUNTER: 1, MASON: 4, APPRENTICE_SEER: 1, MAYOR: 1, CUPID: 1 }),
  dayDivisor: 30,
  nightDivisor: 30,
  variant: 'day-hunter',
};

const GAME_B: GamePlan = {
  label: 'game-B-80',
  playerCount: 80,
  composition: composition({ VILLAGER: 56, WEREWOLF: 13, SEER: 1, BODYGUARD: 1, HUNTER: 1, MASON: 5, APPRENTICE_SEER: 1, MAYOR: 1, CUPID: 1 }),
  dayDivisor: 10,
  nightDivisor: 20,
  variant: 'night-hunter',
  finalShowdownAtLiving: 50,
};

// Village roles are sacrificed in this order, so the special roles live long
// enough to act before the Village runs out of plain Villagers.
const VICTIM_ORDER: RoleKey[] = ['VILLAGER', 'MASON', 'CUPID', 'MAYOR', 'HUNTER', 'APPRENTICE_SEER', 'SEER', 'BODYGUARD'];

// ---------------------------------------------------------------- game driver

interface BallotPlan {
  targets: Bot[];
  mayorTargets?: Bot[];
}

interface NightPlan {
  wolfTargets: Bot[];
  protect?: Bot;
  investigate?: Bot;
  cupidPair?: [Bot, Bot];
}

class StressGame {
  farm!: GameHarness;
  readonly metrics: Metrics;
  loverPair: [string, string] | null = null;
  private readonly investigated = new Set<string>();
  private readonly startedAt = performance.now();

  constructor(readonly plan: GamePlan) {
    this.metrics = new Metrics(plan.label);
  }

  get label(): string {
    return this.plan.label;
  }

  async setup(): Promise<void> {
    this.farm = await GameHarness.create({
      name: `Stress ${this.plan.label} ${Date.now()}`,
      playerCount: this.plan.playerCount,
      composition: this.plan.composition,
      settings: { dayDivisor: this.plan.dayDivisor, nightDivisor: this.plan.nightDivisor },
      onStep: (step, milliseconds) => this.metrics.record(`setup: ${step}`, milliseconds),
    });
    expect(this.farm.bots).toHaveLength(this.plan.playerCount);
    for (const [role, count] of Object.entries(this.plan.composition)) {
      expect(this.farm.byRole(role as RoleKey), `${this.label} ${role} count`).toHaveLength(count);
    }
  }

  one(role: RoleKey): Bot {
    const [bot] = this.farm.byRole(role);
    if (!bot) throw new Error(`${this.label} has no ${role}.`);
    return bot;
  }

  livingWolves(): Bot[] {
    return this.farm.byRole('WEREWOLF').filter((bot) => bot.alive);
  }

  /** Living non-Werewolves in sacrifice order, skipping the excluded seats. */
  villageVictims(count: number, exclude: Iterable<Bot | undefined> = []): Bot[] {
    const skipped = new Set([...exclude].filter(Boolean).map((bot) => bot!.seatId));
    const pool = VICTIM_ORDER.flatMap((role) => this.farm.byRole(role).filter((bot) => bot.alive && !skipped.has(bot.seatId)));
    if (pool.length < count) throw new Error(`${this.label}: only ${pool.length} village victims for ${count} slots.`);
    return pool.slice(0, count);
  }

  expectedSlots(kind: 'DAY' | 'NIGHT' | 'FINAL_BALLOT', living: number): number {
    const divisor = kind === 'NIGHT' ? this.plan.nightDivisor : this.plan.dayDivisor;
    return Math.max(1, Math.ceil(living / divisor));
  }

  /** Every player loads their dashboard at once, as if all 80 were polling. Checks privacy on each. */
  async sweep(label: string): Promise<{ dashboards: Map<string, Dashboard>; wallMs: number; p95: number }> {
    const started = performance.now();
    const timings: number[] = [];
    const results = await Promise.all(this.farm.bots.map(async (bot) => {
      const begun = performance.now();
      const dashboard = await this.farm.dashboard(bot);
      const elapsed = performance.now() - begun;
      timings.push(elapsed);
      this.metrics.record('player dashboard GET', elapsed);
      return [bot.seatId, dashboard] as const;
    }));
    const wallMs = performance.now() - started;
    this.metrics.record(`dashboard sweep (all ${this.farm.bots.length}) wall`, wallMs);
    const dashboards = new Map(results);
    for (const bot of this.farm.bots) this.assertPrivate(bot, dashboards.get(bot.seatId)!, label);
    return { dashboards, wallMs, p95: percentile(timings.sort((a, b) => a - b), 95) };
  }

  assertPrivate(viewer: Bot, dashboard: Dashboard, label: string): void {
    expect(dashboard.player.id, `${this.label} ${label}: dashboard identity`).toBe(viewer.seatId);
    expect(dashboard.player.role).toBe(viewer.role);
    expect(dashboard.player.alive, `${this.label} ${label}: ${viewer.displayName} alive flag`).toBe(viewer.alive);
    const allowed = new Set([viewer.seatId, ...this.farm.bots.filter((bot) => !bot.alive).map((bot) => bot.seatId)]);
    const found: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if ('role' in record && typeof record.id === 'string' && !allowed.has(record.id) && this.farm.bots.some((bot) => bot.seatId === record.id)) {
        found.push(`${path}.role of a living player`);
      }
      for (const [key, child] of Object.entries(record)) {
        if (FORBIDDEN_PLAYER_KEYS.has(key)) found.push(`${path}.${key}`);
        walk(child, `${path}.${key}`);
      }
    };
    walk(dashboard, 'dashboard');
    expect(found, `${this.label} ${label}: private data reached ${viewer.displayName} (${viewer.role})`).toEqual([]);

    const expectedTeammates = viewer.role === 'WEREWOLF' || viewer.role === 'MASON'
      ? this.farm.byRole(viewer.role).filter((bot) => bot.seatId !== viewer.seatId).map((bot) => bot.seatId).sort()
      : [];
    expect(dashboard.player.teammates.map((mate) => mate.id).sort(), `${this.label} ${label}: ${viewer.role} teammates`).toEqual(expectedTeammates);
  }

  async moderatorPhases() {
    return this.metrics.time('moderator phases GET', () => this.farm.phases());
  }

  private async submit(bot: Bot, phaseId: string, actionKind: ActionKind, targetIds: string[]) {
    return this.metrics.time(`submit ${actionKind}`, () => this.farm.submitToPhase(phaseId, { bot, actionKind, targetIds }));
  }

  /** Expected eliminations: the selected targets less any protection, plus the Hunter's shot and the lover bond. */
  private expectEliminations(outcome: Outcome, base: string[], hunterShot: string | null, label: string): void {
    const expected = new Set(base);
    if (hunterShot) expected.add(hunterShot);
    let bonded: string | null = null;
    if (this.loverPair) {
      const [first, second] = this.loverPair;
      const alive = (id: string) => this.farm.botBySeatId(id).alive;
      if (expected.has(first) && !expected.has(second) && alive(second)) bonded = second;
      if (expected.has(second) && !expected.has(first) && alive(first)) bonded = first;
      if (bonded) expected.add(bonded);
    }
    expect(outcome.eliminations.map((item) => item.playerId).sort(), `${this.label} ${label}: eliminations`).toEqual([...expected].sort());
    if (bonded) expect(outcome.eliminations.find((item) => item.playerId === bonded)?.cause).toBe('LOVER_BOND');
    if (hunterShot) expect(outcome.eliminations.find((item) => item.playerId === hunterShot)?.cause).toBe('HUNTER_SHOT');
  }

  private async resolveHunter(phaseId: string, outcome: Outcome, label: string): Promise<{ outcome: Outcome; shot: string | null }> {
    if (!outcome.hunterRequiredIds.length) return { outcome, shot: null };
    const hunter = this.farm.botBySeatId(outcome.hunterRequiredIds[0]);
    const eliminated = outcome.eliminations.map((item) => this.farm.botBySeatId(item.playerId));
    // Game B's Hunter, killed at night, shoots a Werewolf; otherwise the Hunter shoots a Villager.
    const target = this.plan.variant === 'night-hunter' && label.includes('Night 1')
      ? this.livingWolves().find((wolf) => !this.loverPair?.includes(wolf.seatId))!
      : this.villageVictims(1, [hunter, ...eliminated])[0];
    const hunterDashboard = await this.farm.dashboard(hunter);
    expect(hunterDashboard.permission.actionKind, `${this.label} ${label}: Hunter may shoot`).toBe('HUNTER_SHOT');
    const bystander = this.farm.livingBots().find((bot) => !eliminated.includes(bot))!;
    expect((await this.farm.dashboard(bystander)).permission.actionKind, `${this.label} ${label}: others wait for the Hunter`).toBeNull();
    await this.submit(hunter, phaseId, 'HUNTER_SHOT', [target.seatId]);
    const finalized = await this.metrics.time('finalize Hunter', () => this.farm.finalizeHunter(phaseId));
    return { outcome: finalized.outcome, shot: target.seatId };
  }

  private async publish(phaseId: string, label: string) {
    const published = await this.metrics.time('publish', () => this.farm.publish(phaseId));
    this.farm.updateAlive(published.outcome);
    expect(published.winner, `${this.label} ${label}: winner`).toBe(this.farm.expectedWinner());
    return published;
  }

  /** A Day or final ballot. Every living player votes; a few revise their ballot first. */
  async ballot(kind: 'DAY' | 'FINAL_BALLOT', label: string, choose: (slots: number) => BallotPlan) {
    const living = this.farm.livingBots();
    const opened = await this.metrics.time(`open ${kind}`, () => this.farm.open(kind));
    expect(opened.slots, `${this.label} ${label}: slots`).toBe(this.expectedSlots(kind, living.length));
    const plan = choose(opened.slots);
    expect(plan.targets).toHaveLength(opened.slots);
    const targetIds = plan.targets.map((bot) => bot.seatId);

    const ballots = new Map<string, string[]>();
    for (const bot of living) {
      const ballot = bot.role === 'MAYOR' && plan.mayorTargets
        ? plan.mayorTargets.map((target) => target.seatId)
        : targetIds.filter((id) => id !== bot.seatId);
      if (ballot.length) ballots.set(bot.seatId, ballot);
    }

    const voteStarted = performance.now();
    await Promise.all(living.filter((bot) => ballots.has(bot.seatId)).map(async (bot, index) => {
      const ballot = ballots.get(bot.seatId)!;
      if (index % 9 === 4) {
        const decoy = living.find((other) => other.seatId !== bot.seatId && !ballot.includes(other.seatId));
        if (decoy) await this.submit(bot, opened.phaseId, 'DAY_VOTE', [decoy.seatId]);
      }
      await this.submit(bot, opened.phaseId, 'DAY_VOTE', ballot);
    }));
    const voteWallMs = performance.now() - voteStarted;
    this.metrics.record(`${kind} vote burst wall`, voteWallMs);

    const phases = await this.moderatorPhases();
    expect(phases.phases.find((phase) => phase.id === opened.phaseId)?.currentSubmissions, `${this.label} ${label}: submissions`).toBe(ballots.size);

    const sweep = await this.sweep(label);
    for (const bot of this.farm.bots) {
      const dashboard = sweep.dashboards.get(bot.seatId)!;
      if (!bot.alive) {
        expect(dashboard.permission.actionKind).toBeNull();
        continue;
      }
      expect(dashboard.phase?.id).toBe(opened.phaseId);
      expect(dashboard.permission.actionKind).toBe('DAY_VOTE');
      expect(dashboard.permission.maxTargets).toBe(opened.slots);
      if (ballots.has(bot.seatId)) expect(dashboard.currentAction?.targetIds.sort()).toEqual([...ballots.get(bot.seatId)!].sort());
    }

    const lockStarted = performance.now();
    const proposed = await this.metrics.time('lock and propose', () => this.farm.lockAndPropose(opened.phaseId));
    const lockMs = performance.now() - lockStarted;

    const expectedTally = new Map<string, number>();
    for (const [actorId, ballot] of ballots) {
      const weight = this.farm.botBySeatId(actorId).role === 'MAYOR' ? 2 : 1;
      for (const id of ballot) expectedTally.set(id, (expectedTally.get(id) ?? 0) + weight);
    }
    expect(Object.fromEntries(proposed.outcome.tally.map((entry) => [entry.playerId, entry.votes])), `${this.label} ${label}: tally (Mayor counts twice)`)
      .toEqual(Object.fromEntries(expectedTally));
    expect(proposed.outcome.selectedTargets.sort()).toEqual([...targetIds].sort());

    const { outcome, shot } = await this.resolveHunter(opened.phaseId, proposed.outcome, label);
    this.expectEliminations(outcome, targetIds, shot, label);
    const publishStarted = performance.now();
    const published = await this.publish(opened.phaseId, label);
    this.recordPhase(opened.phaseId, kind, living.length, opened.slots, ballots.size, voteWallMs, sweep, lockMs, performance.now() - publishStarted, published.outcome.eliminations.length);
    return published;
  }

  async night(label: string, choose: (slots: number) => NightPlan, options: { negativeChecks?: boolean } = {}) {
    const living = this.farm.livingBots();
    const opened = await this.metrics.time('open NIGHT', () => this.farm.open('NIGHT'));
    expect(opened.slots, `${this.label} ${label}: slots`).toBe(this.expectedSlots('NIGHT', living.length));
    const plan = choose(opened.slots);
    expect(plan.wolfTargets).toHaveLength(opened.slots);

    const seerAlive = this.farm.byRole('SEER').some((bot) => bot.alive);
    const expectedAction = (bot: Bot): ActionKind | null => {
      if (!bot.alive) return null;
      switch (bot.role) {
        case 'WEREWOLF': return 'WOLF_VOTE';
        case 'SEER': return 'INVESTIGATE';
        case 'APPRENTICE_SEER': return seerAlive ? null : 'INVESTIGATE';
        case 'BODYGUARD': return 'PROTECT';
        case 'CUPID': return this.loverPair ? null : 'CUPID_PAIR';
        default: return null;
      }
    };
    const before = await this.sweep(`${label} permissions`);
    for (const bot of this.farm.bots) {
      expect(before.dashboards.get(bot.seatId)!.permission.actionKind, `${this.label} ${label}: ${bot.role} night action`).toBe(expectedAction(bot));
    }

    const wolves = this.livingWolves();
    if (options.negativeChecks) {
      const villager = living.find((bot) => bot.role === 'VILLAGER')!;
      const wrongRole = await villager.context.post(`/api/phases/${opened.phaseId}/actions`, { data: { actionKind: 'WOLF_VOTE', targetIds: [plan.wolfTargets[0].seatId] } });
      expect(wrongRole.status(), 'a Villager cannot vote with the pack').toBeGreaterThanOrEqual(400);
      expect(wrongRole.status()).toBeLessThan(500);
      if (wolves.length > 1) {
        const packTarget = await wolves[0].context.post(`/api/phases/${opened.phaseId}/actions`, { data: { actionKind: 'WOLF_VOTE', targetIds: [wolves[1].seatId] } });
        expect(packTarget.status(), 'a Werewolf cannot target the pack').toBe(400);
      }
      const dead = this.farm.bots.find((bot) => !bot.alive);
      if (dead) {
        const deadAction = await dead.context.post(`/api/phases/${opened.phaseId}/actions`, { data: { actionKind: 'WOLF_VOTE', targetIds: [plan.wolfTargets[0].seatId] } });
        expect(deadAction.status(), 'an eliminated player cannot act').toBe(400);
      }
    }

    const wolfTargetIds = plan.wolfTargets.map((bot) => bot.seatId);
    const voteStarted = performance.now();
    const jobs: Array<Promise<unknown>> = wolves.map(async (wolf, index) => {
      if (index % 2 === 1) {
        const decoy = this.villageVictims(1, [...plan.wolfTargets, plan.protect])[0];
        await this.submit(wolf, opened.phaseId, 'WOLF_VOTE', [decoy.seatId]);
      }
      await this.submit(wolf, opened.phaseId, 'WOLF_VOTE', wolfTargetIds);
    });
    let submissions = wolves.length;
    const bodyguard = this.farm.byRole('BODYGUARD').find((bot) => bot.alive);
    if (bodyguard && plan.protect) {
      jobs.push(this.submit(bodyguard, opened.phaseId, 'PROTECT', [plan.protect.seatId]));
      submissions += 1;
    }
    const investigator = this.farm.byRole('SEER').find((bot) => bot.alive) ?? this.farm.byRole('APPRENTICE_SEER').find((bot) => bot.alive);
    if (investigator && plan.investigate) {
      jobs.push(this.submit(investigator, opened.phaseId, 'INVESTIGATE', [plan.investigate.seatId]));
      submissions += 1;
    }
    const cupid = this.one('CUPID');
    if (plan.cupidPair) {
      jobs.push(this.submit(cupid, opened.phaseId, 'CUPID_PAIR', plan.cupidPair.map((bot) => bot.seatId)));
      submissions += 1;
    }
    await Promise.all(jobs);
    const voteWallMs = performance.now() - voteStarted;
    this.metrics.record('NIGHT action burst wall', voteWallMs);

    const phases = await this.moderatorPhases();
    expect(phases.phases.find((phase) => phase.id === opened.phaseId)?.currentSubmissions, `${this.label} ${label}: submissions`).toBe(submissions);
    const sweep = await this.sweep(label);

    const lockStarted = performance.now();
    const proposed = await this.metrics.time('lock and propose', () => this.farm.lockAndPropose(opened.phaseId));
    const lockMs = performance.now() - lockStarted;
    expect(proposed.outcome.selectedTargets.sort(), `${this.label} ${label}: pack targets`).toEqual([...wolfTargetIds].sort());
    expect(Object.fromEntries(proposed.outcome.tally.map((entry) => [entry.playerId, entry.votes])))
      .toEqual(Object.fromEntries(wolfTargetIds.map((id) => [id, wolves.length])));
    expect(proposed.outcome.protectedPlayerIds).toEqual(bodyguard && plan.protect ? [plan.protect.seatId] : []);
    expect(proposed.outcome.investigations).toEqual(investigator && plan.investigate
      ? [{ seerId: investigator.seatId, targetId: plan.investigate.seatId, role: plan.investigate.role }]
      : []);
    if (plan.cupidPair) {
      expect(proposed.outcome.loverPair).toEqual({ cupidId: cupid.seatId, playerIds: plan.cupidPair.map((bot) => bot.seatId) });
      this.loverPair = [plan.cupidPair[0].seatId, plan.cupidPair[1].seatId];
    }

    const { outcome, shot } = await this.resolveHunter(opened.phaseId, proposed.outcome, label);
    this.expectEliminations(outcome, wolfTargetIds.filter((id) => id !== plan.protect?.seatId), shot, label);
    const publishStarted = performance.now();
    const published = await this.publish(opened.phaseId, label);
    this.recordPhase(opened.phaseId, 'NIGHT', living.length, opened.slots, submissions, voteWallMs, sweep, lockMs, performance.now() - publishStarted, published.outcome.eliminations.length);

    if (investigator && plan.investigate) {
      this.investigated.add(plan.investigate.seatId);
      const notifications = (await this.farm.dashboard(investigator)).notifications;
      expect(notifications.some((note) => note.type === 'INVESTIGATION_RESULT' && note.body.startsWith(`${plan.investigate!.displayName} is`)),
        `${this.label} ${label}: ${investigator.role} got the result`).toBe(true);
    }
    return published;
  }

  private recordPhase(phaseId: string, kind: string, living: number, slots: number, submissions: number, voteWallMs: number,
    sweep: { wallMs: number; p95: number }, lockMs: number, publishMs: number, eliminated: number): void {
    report.phases.push({
      game: this.label,
      sequence: report.phases.filter((phase) => phase.game === this.label).length + 1,
      kind, living, slots, submissions,
      voteWallMs: Math.round(voteWallMs),
      sweepWallMs: Math.round(sweep.wallMs),
      sweepP95Ms: Math.round(sweep.p95),
      lockMs: Math.round(lockMs),
      publishMs: Math.round(publishMs),
      eliminated,
    });
    void phaseId;
  }

  nextInvestigation(investigator: Bot | undefined): Bot | undefined {
    if (!investigator) return undefined;
    return this.farm.livingBots().find((bot) => bot.seatId !== investigator.seatId && !this.investigated.has(bot.seatId));
  }

  protectOther(exclude: Bot[]): Bot | undefined {
    const bodyguard = this.farm.byRole('BODYGUARD').find((bot) => bot.alive);
    if (!bodyguard) return undefined;
    const skipped = new Set([bodyguard, ...exclude].map((bot) => bot.seatId));
    return this.farm.livingBots().find((bot) => !skipped.has(bot.seatId) && bot.role === 'VILLAGER');
  }

  /** Posts in the Werewolf, Mason, and dead rooms, and checks outsiders are refused. */
  async checkRooms(): Promise<void> {
    const readRoom = async (bot: Bot, roomId: string) => this.metrics.time('room messages GET', () => bot.context.get(`/api/rooms/${roomId}/messages`));
    for (const [type, members] of [
      ['WEREWOLF', this.livingWolves()],
      ['MASON', this.farm.byRole('MASON').filter((bot) => bot.alive)],
      ['DEAD', this.farm.bots.filter((bot) => !bot.alive)],
    ] as const) {
      expect(members.length, `${this.label}: ${type} room needs two members`).toBeGreaterThanOrEqual(2);
      const roomId = (await this.farm.dashboard(members[0])).rooms.find((room) => room.type === type)?.id;
      expect(roomId, `${this.label}: ${type} room is listed`).toBeTruthy();
      const text = `${this.label} ${type} stress message ${Date.now()}`;
      await this.metrics.time('room message POST', async () => requireOk(await members[0].context.post(`/api/rooms/${roomId}/messages`, { data: { body: text } }), `${type} message`));
      const readers = await Promise.all(members.map((bot) => readRoom(bot, roomId!)));
      for (const response of readers) {
        expect(response.status()).toBe(200);
        const data = await response.json() as { messages: Array<{ body: string }> };
        expect(data.messages.some((message) => message.body === text)).toBe(true);
      }
      const outsider = this.farm.livingBots().find((bot) => bot.role === 'VILLAGER' && !members.includes(bot))!;
      expect((await readRoom(outsider, roomId!)).status(), `${this.label}: a Villager cannot read the ${type} room`).toBe(403);
    }
  }

  async opening(): Promise<void> {
    const hunter = this.one('HUNTER');
    const seer = this.one('SEER');
    const apprentice = this.one('APPRENTICE_SEER');
    const cupid = this.one('CUPID');
    const mayor = this.one('MAYOR');
    const wolves = this.farm.byRole('WEREWOLF');
    const masons = this.farm.byRole('MASON');

    if (this.plan.variant === 'day-hunter') {
      const [loverA, loverB, mayorPick] = this.villageVictims(3).reverse();
      // Day 1: the Village eliminates the Hunter, who shoots a Villager; the Mayor votes alone and counts twice.
      await this.ballot('DAY', 'Day 1', (slots) => ({
        targets: [hunter, ...this.villageVictims(slots - 1, [hunter, loverA, loverB, mayorPick])],
        mayorTargets: [mayorPick],
      }));
      expect(hunter.alive).toBe(false);
      // Night 1: Cupid links two Villagers; the Bodyguard saves one pack target; the Seer finds a Werewolf.
      await this.night('Night 1', (slots) => {
        const saved = this.villageVictims(1, [loverA, loverB])[0];
        return {
          wolfTargets: [saved, ...this.villageVictims(slots - 1, [saved, loverA, loverB])],
          protect: saved,
          investigate: wolves[0],
          cupidPair: [loverA, loverB],
        };
      }, { negativeChecks: true });
      await this.checkRooms();
      // Day 2: one lover is voted out and the other follows.
      await this.ballot('DAY', 'Day 2', (slots) => ({ targets: [loverA, ...this.villageVictims(slots - 1, [loverA, loverB])] }));
      expect(loverB.alive).toBe(false);
      // Night 2: the pack kills the Seer, who first learns a Mason's role.
      await this.night('Night 2', (slots) => ({
        wolfTargets: [seer, ...this.villageVictims(slots - 1, [seer, masons[0]])],
        protect: masons[0],
        investigate: masons[0],
      }));
      expect(seer.alive).toBe(false);
    } else {
      const wolfLover = wolves[wolves.length - 1];
      // Day 1: everyone, the Mayor included, votes with the crowd.
      await this.ballot('DAY', 'Day 1', (slots) => ({ targets: this.villageVictims(slots, [cupid]) }));
      // Night 1: Cupid links themself with a Werewolf; the pack kills the Hunter, who shoots another Werewolf.
      await this.night('Night 1', (slots) => ({
        wolfTargets: [hunter, ...this.villageVictims(slots - 1, [hunter, cupid])],
        protect: this.protectOther([hunter, ...this.villageVictims(slots - 1, [hunter, cupid])]),
        investigate: this.one('BODYGUARD'),
        cupidPair: [cupid, wolfLover],
      }), { negativeChecks: true });
      expect(hunter.alive).toBe(false);
      expect(wolves.filter((wolf) => !wolf.alive)).toHaveLength(1);
      await this.checkRooms();
      // Day 2: Cupid is voted out and the Werewolf lover follows.
      await this.ballot('DAY', 'Day 2', (slots) => ({ targets: [cupid, ...this.villageVictims(slots - 1, [cupid])] }));
      expect(wolfLover.alive).toBe(false);
      // Night 2: the pack kills the Seer, who first finds a Werewolf.
      await this.night('Night 2', (slots) => ({
        wolfTargets: [seer, ...this.villageVictims(slots - 1, [seer])],
        protect: this.protectOther([seer, ...this.villageVictims(slots - 1, [seer])]),
        investigate: this.livingWolves()[0],
      }));
      expect(seer.alive).toBe(false);
    }
    void mayor;

    // Day 3, then Night 3: the Apprentice Seer inherits the Seer's results and investigates.
    await this.ballot('DAY', 'Day 3', (slots) => ({ targets: this.villageVictims(slots) }));
    const target = this.nextInvestigation(apprentice)!;
    await this.night('Night 3', (slots) => {
      const victims = this.villageVictims(slots, [apprentice]);
      return { wolfTargets: victims, protect: this.protectOther(victims), investigate: target };
    });
    const notes = (await this.farm.dashboard(apprentice)).notifications.filter((note) => note.type === 'INVESTIGATION_RESULT');
    expect(notes.length, `${this.label}: the Apprentice sees the Seer's two results and their own`).toBeGreaterThanOrEqual(3);
  }

  async playToWerewolfWin(): Promise<void> {
    let kind: 'DAY' | 'NIGHT' = 'DAY';
    for (let round = 1; round <= 80; round += 1) {
      if (this.plan.finalShowdownAtLiving && kind === 'DAY' && this.farm.livingBots().length <= this.plan.finalShowdownAtLiving) {
        await this.finalShowdown();
        return;
      }
      const label = `${kind} ${round + 3}`;
      const published = kind === 'DAY'
        ? await this.ballot('DAY', label, (slots) => ({ targets: this.villageVictims(slots) }))
        : await this.night(label, (slots) => {
          const victims = this.villageVictims(slots);
          const investigator = this.farm.byRole('SEER').find((bot) => bot.alive) ?? this.farm.byRole('APPRENTICE_SEER').find((bot) => bot.alive);
          return { wolfTargets: victims, protect: this.protectOther(victims), investigate: this.nextInvestigation(investigator) };
        });
      if (published.winner) {
        expect(published.winner).toBe('WEREWOLF');
        return;
      }
      kind = kind === 'DAY' ? 'NIGHT' : 'DAY';
    }
    throw new Error(`${this.label} did not finish.`);
  }

  async finalShowdown(): Promise<void> {
    await this.metrics.time('enter final showdown', () => this.farm.enterFinalShowdown());
    const refused = await this.farm.moderator.post(`/api/games/${this.farm.gameId}/phases`, {
      data: { action: 'OPEN', kind: 'DAY', closesAt: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(refused.status(), `${this.label}: final showdown refuses a Day`).toBe(400);
    for (let ballot = 1; ballot <= 30; ballot += 1) {
      const published = await this.ballot('FINAL_BALLOT', `Final ballot ${ballot}`, (slots) => ({ targets: this.villageVictims(slots) }));
      if (published.winner) {
        expect(published.winner).toBe('WEREWOLF');
        return;
      }
    }
    throw new Error(`${this.label} final showdown did not finish.`);
  }

  async afterWin(): Promise<void> {
    const phases = await this.moderatorPhases();
    expect(phases.game.status).toBe('COMPLETED');
    const final = await this.sweep('after the win');
    for (const bot of this.farm.bots) {
      const dashboard = final.dashboards.get(bot.seatId)!;
      expect(dashboard.game.status).toBe('COMPLETED');
      expect(dashboard.timeline.some((event) => event.eventType === 'GAME_COMPLETED' && event.payload.winner === 'WEREWOLF')).toBe(true);
      expect(dashboard.rooms.every((room) => room.status === 'READ_ONLY'), `${this.label}: rooms read-only for ${bot.displayName}`).toBe(true);
      expect(dashboard.permission.actionKind).toBeNull();
    }
    const lastPhase = phases.phases.reduce((latest, phase) => phase.sequence > latest.sequence ? phase : latest);
    const lateWolf = this.livingWolves()[0];
    const late = await lateWolf.context.post(`/api/phases/${lastPhase.id}/actions`, { data: { actionKind: 'DAY_VOTE', targetIds: [this.farm.livingBots().find((bot) => bot !== lateWolf)!.seatId] } });
    expect(late.status(), `${this.label}: no actions after the win`).toBe(400);
    const reopen = await this.farm.moderator.post(`/api/games/${this.farm.gameId}/phases`, {
      data: { action: 'OPEN', kind: 'NIGHT', closesAt: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(reopen.status(), `${this.label}: a completed game refuses new phases`).toBe(400);

    const backup = await this.metrics.time('backup export POST', () => this.farm.moderator.post(`/api/games/${this.farm.gameId}/export`));
    expect(backup.status()).toBe(200);
    expect(backup.headers()['x-backup-checksum']).toBeTruthy();
    this.metrics.record('backup export size (KB)', (await backup.body()).length / 1024);
    const operations = await this.metrics.time('moderator operations GET', () => this.farm.moderator.get(`/api/games/${this.farm.gameId}/operations`));
    expect(operations.status()).toBe(200);
    const games = await this.metrics.time('moderator games list GET', () => this.farm.moderator.get(`/api/games?gameId=${this.farm.gameId}`));
    expect(games.status()).toBe(200);

    report.games.push({
      game: this.label,
      players: this.plan.playerCount,
      phases: phases.phases.length,
      winner: 'WEREWOLF',
      wallSeconds: Math.round((performance.now() - this.startedAt) / 1000),
      roles: Object.fromEntries(Object.entries(this.plan.composition).filter(([, count]) => count > 0)),
    });
  }

  async play(): Promise<void> {
    await this.setup();
    await this.sweep('after role release');
    await this.opening();
    await this.playToWerewolfWin();
    await this.afterWin();
  }
}

// ---------------------------------------------------------------- browser checks

/** Collects page errors, console errors, 5xx responses, and failed requests. Returns a function that stops listening. */
function watchPage(page: Page, problems: string[]): () => void {
  const onPageError = (error: Error) => problems.push(`pageerror: ${error.message.split('\n')[0]}`);
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === 'error' && !/status of 401/iu.test(message.text())) problems.push(`console: ${message.text().slice(0, 200)}`);
  };
  const onResponse = (response: PageResponse) => {
    if (response.status() >= 500) problems.push(`${response.status()} ${new URL(response.url()).pathname}`);
  };
  const onRequestFailed = (request: Request) => {
    if (new URL(request.url()).hostname === 'localhost') problems.push(`failed ${request.method()} ${new URL(request.url()).pathname}`);
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);
  return () => {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);
  };
}

async function browserChecks(browser: Browser, game: StressGame): Promise<void> {
  const farm = game.farm;
  const living = game.livingWolves()[0];
  const dead = farm.bots.find((bot) => !bot.alive)!;
  for (const [pageName, bot] of [['player page (living Werewolf)', living], ['player page (eliminated)', dead]] as const) {
    const context = await newBrowserContext(browser, { storageState: await bot.context.storageState() });
    const problems: string[] = [];
    try {
      const page = await context.newPage();
      watchPage(page, problems);
      const started = performance.now();
      await page.goto('/');
      await expect(page.getByText(bot.displayName, { exact: false }).first()).toBeVisible({ timeout: 60_000 });
      const loadMs = performance.now() - started;
      await page.waitForTimeout(1_500);
      report.browser.push({ game: game.label, page: pageName, loadMs: Math.round(loadMs), problems });
    } finally {
      await context.close();
    }
  }

  const { page } = await getSharedModerator(browser);
  const problems: string[] = [];
  const stop = watchPage(page, problems);
  try {
    const started = performance.now();
    await page.goto('/moderator');
    const selector = page.getByLabel('Selected game');
    await expect(selector).toBeVisible({ timeout: 60_000 });
    report.browser.push({ game: game.label, page: 'moderator console (open)', loadMs: Math.round(performance.now() - started), problems });
    if ((await selector.inputValue()) !== farm.gameId) {
      const switched = performance.now();
      // Switching games reloads the list with the chosen game's setup in one request.
      const loaded = page.waitForResponse((response) => response.url().includes(`/api/games?gameId=${farm.gameId}`) && response.request().method() === 'GET', { timeout: 60_000 });
      await selector.selectOption(farm.gameId);
      expect((await loaded).status()).toBe(200);
      await expect(selector).toHaveValue(farm.gameId);
      report.browser.push({ game: game.label, page: 'moderator console (switch to this game)', loadMs: Math.round(performance.now() - switched), problems: [] });
    }
    await page.waitForTimeout(3_000);
  } finally {
    stop();
  }
}

// ---------------------------------------------------------------- tests

test.describe.configure({ mode: 'serial', retries: 0 });

test.describe('80-player stress', () => {
  test('baseline: one 20-player game with every role to a Werewolf win', async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    const game = new StressGame(BASELINE);
    try {
      await game.play();
      await browserChecks(browser, game);
    } finally {
      report.metrics.push(...game.metrics.rows());
      writeReport();
      await game.farm?.dispose();
    }
  });

  test('two 80-player games at the same time, every role, both to a Werewolf win', async ({ browser }) => {
    test.setTimeout(90 * 60_000);
    const games = [new StressGame(GAME_A), new StressGame(GAME_B)];
    try {
      const results = await Promise.allSettled(games.map((game) => game.play()));
      const failures = results.flatMap((result, index) => result.status === 'rejected' ? [`${games[index].label}: ${String(result.reason)}`] : []);
      expect(failures, 'both games finished').toEqual([]);
      for (const game of games) await browserChecks(browser, game);
    } finally {
      for (const game of games) report.metrics.push(...game.metrics.rows());
      writeReport();
      await Promise.all(games.map((game) => game.farm?.dispose()));
    }
    const problems = report.browser.flatMap((entry) => entry.problems.map((problem) => `${entry.game} ${entry.page}: ${problem}`));
    expect(problems, 'browser pages had no errors').toEqual([]);
  });
});
