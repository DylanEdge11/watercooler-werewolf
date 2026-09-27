import { randomUUID } from 'node:crypto';
import { type APIRequestContext, type APIResponse } from '@playwright/test';
import type { ActionKind, PhaseKind, PhaseResolution, RoleComposition, RoleKey } from '../lib/game/types';
import { DEFAULT_COMPOSITION, E2E_PLAYER_COUNT, E2E_RUN_ID, MODERATOR_EMAIL, MODERATOR_PASSWORD } from './constants';
import { newRequestContext } from './transport';

interface ApiError {
  error?: string;
  errors?: string[];
}

export interface Invite {
  displayName: string;
  email: string;
  claimUrl: string;
  inviteCode: string;
}

export interface Bot {
  index: number;
  displayName: string;
  email: string;
  inviteCode: string;
  pin: string;
  context: APIRequestContext;
  seatId: string;
  role: RoleKey;
  alive: boolean;
}

export interface Outcome extends PhaseResolution {
  phaseId: string;
}

export interface Dashboard {
  player: {
    id: string;
    displayName: string;
    alive: boolean;
    role: RoleKey | null;
    teammates: Array<{ id: string; displayName: string; alive: boolean }>;
  };
  game: {
    id: string;
    name: string;
    status: string;
    counts: { total: number; living: number };
  };
  phase: {
    id: string;
    sequence: number;
    kind: PhaseKind;
    status: string;
    slots: number;
  } | null;
  permission: { actionKind: ActionKind | null; maxTargets: number; label: string };
  candidates: Array<{ id: string; displayName: string }>;
  currentAction: { kind: ActionKind; targetIds: string[]; version: number } | null;
  timeline: Array<{ eventType: string; payload: Record<string, unknown> }>;
  notifications: Array<{ type: string; title: string; body: string }>;
  rooms: Array<{ id: string; type: string; status: string; access: string }>;
}

export interface GamePhase {
  id: string;
  sequence: number;
  kind: PhaseKind;
  status: string;
  slots: number;
  currentSubmissions: number;
  hunterDeadlineAt: string | null;
  proposal: null | {
    proposedOutcome: Outcome;
    reviewedOutcome: Outcome | null;
    publishedOutcome: Outcome | null;
    overrideReason: string | null;
  };
}

export interface PhasesResponse {
  game: { status: string; finalCutoffAt: string; timezone: string };
  roster: Array<{ id: string; displayName: string; alive: boolean; role: RoleKey }>;
  phases: GamePhase[];
}

export interface Decision {
  bot: Bot;
  actionKind: ActionKind;
  targetIds: string[];
}

let sharedModerator: APIRequestContext | null = null;
let sharedModeratorLogin: Promise<APIRequestContext> | null = null;

async function moderatorContext(): Promise<APIRequestContext> {
  if (sharedModerator) return sharedModerator;
  sharedModeratorLogin ??= (async () => {
    const context = await newRequestContext();
    try {
      await requireOk<{ ok: true }>(
        await context.post('/api/moderators/login', { data: { email: MODERATOR_EMAIL, password: MODERATOR_PASSWORD } }),
        'moderator login',
      );
      sharedModerator = context;
      return context;
    } catch (error) {
      await context.dispose().catch(() => undefined);
      throw error;
    }
  })();
  try {
    return await sharedModeratorLogin;
  } finally {
    sharedModeratorLogin = null;
  }
}

async function responseData<T>(response: APIResponse): Promise<T & ApiError> {
  return await response.json() as T & ApiError;
}

export async function requireOk<T>(response: APIResponse, operation: string): Promise<T> {
  const data = await responseData<T>(response);
  if (!response.ok()) {
    const detail = data.error ?? data.errors?.join(' ') ?? 'request failed';
    throw new Error(`${operation} (${response.status()}): ${detail}`);
  }
  return data as T;
}

function csvValue(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function rosterCsv(suffix: string): string {
  return [
    'display_name,email',
    ...Array.from({ length: E2E_PLAYER_COUNT }, (_, index) => {
      const number = String(index + 1).padStart(2, '0');
      return `${csvValue(`Bot ${number}`)},${csvValue(`bot${number}-${suffix}@e2e.test`)}`;
    }),
  ].join('\n');
}

export class GameHarness {
  private constructor(
    public readonly moderator: APIRequestContext,
    public readonly gameId: string,
    public readonly gameName: string,
    public readonly bots: Bot[],
    public readonly composition: RoleComposition,
  ) {}

  static async create(options: { name?: string; composition?: RoleComposition } = {}): Promise<GameHarness> {
    const moderator = await moderatorContext();
    const contexts: APIRequestContext[] = [];
    const name = options.name ?? `Playwright Bot Farm ${E2E_RUN_ID} ${randomUUID().slice(0, 8)}`;
    const composition = options.composition ?? DEFAULT_COMPOSITION;
    const suffix = `${Date.now()}-${randomUUID().slice(0, 6)}`;

    try {
      const created = await requireOk<{ gameId: string }>(
        await moderator.post('/api/games', {
          data: {
            name,
            timezone: 'America/Regina',
            // The cutoff is in the past so final showdown is available at once; it must fall within the dates.
            startDate: '2000-01-01',
            endDate: '2099-12-31',
            finalCutoffAt: '2000-01-01T00:00',
            activeWeekdays: [1, 2, 3, 4, 5],
            schedule: { dayCloses: '16:00', nightCloses: '09:00' },
            // The bot farm locks and publishes by hand; automatic results would race it.
            publicationMode: 'REVIEW',
          },
        }),
        'create game',
      );

      const imported = await requireOk<{ invites: Invite[] }>(
        await moderator.post(`/api/games/${created.gameId}/roster`, { data: { csv: rosterCsv(suffix) } }),
        `import ${E2E_PLAYER_COUNT}-player roster`,
      );
      const roster = await requireOk<{ roster: Array<{ id: string; displayName: string }> }>(
        await moderator.get(`/api/games/${created.gameId}/roster`),
        'load imported roster',
      );
      const seatByName = new Map(roster.roster.map((seat) => [seat.displayName, seat.id]));

      const bots = await Promise.all(imported.invites.map(async (invite, index) => {
        const context = await newRequestContext();
        contexts.push(context);
        const pin = String(410000 + index).slice(-6);
        await requireOk<{ seat: { displayName: string } }>(
          await context.post(`/api/seats/claim/${encodeURIComponent(invite.inviteCode)}`, { data: { pin } }),
          `claim ${invite.displayName}`,
        );
        const seatId = seatByName.get(invite.displayName);
        if (!seatId) throw new Error(`No seat id was returned for ${invite.displayName}.`);
        return {
          index,
          displayName: invite.displayName,
          email: invite.email,
          inviteCode: invite.inviteCode,
          pin,
          context,
          seatId,
          role: 'VILLAGER' as RoleKey,
          alive: true,
        } satisfies Bot;
      }));

      await requireOk<{ ok: true }>(
        await moderator.post(`/api/games/${created.gameId}/assignments`, { data: { action: 'SAVE_COMPOSITION', composition } }),
        'save role composition',
      );
      const preview = await requireOk<{ batchId: string; assignments: Array<{ seatId: string; role: RoleKey }> }>(
        await moderator.post(`/api/games/${created.gameId}/assignments`, { data: { action: 'PREVIEW' } }),
        'preview roles',
      );
      const roleBySeat = new Map(preview.assignments.map((assignment) => [assignment.seatId, assignment.role]));
      for (const bot of bots) {
        const role = roleBySeat.get(bot.seatId);
        if (!role) throw new Error(`No role assignment was returned for ${bot.displayName}.`);
        bot.role = role;
      }
      await requireOk<{ ok: true }>(
        await moderator.post(`/api/games/${created.gameId}/assignments`, { data: { action: 'RELEASE', batchId: preview.batchId } }),
        'release roles',
      );

      const farm = new GameHarness(moderator, created.gameId, name, bots, composition);
      const dashboards = await Promise.all(bots.map((bot) => farm.dashboard(bot)));
      for (const dashboard of dashboards) {
        const bot = bots.find((candidate) => candidate.seatId === dashboard.player.id);
        if (!bot || dashboard.player.role !== bot.role) {
          throw new Error(`Role release did not reach ${dashboard.player.displayName}.`);
        }
      }
      return farm;
    } catch (error) {
      await Promise.all(contexts.map((context) => context.dispose().catch(() => undefined)));
      throw error;
    }
  }

  byRole(role: RoleKey): Bot[] {
    return this.bots.filter((bot) => bot.role === role);
  }

  livingBots(): Bot[] {
    return this.bots.filter((bot) => bot.alive);
  }

  botBySeatId(seatId: string): Bot {
    const bot = this.bots.find((candidate) => candidate.seatId === seatId);
    if (!bot) throw new Error(`Unknown bot seat ${seatId}.`);
    return bot;
  }

  async dashboard(bot: Bot): Promise<Dashboard> {
    return requireOk<Dashboard>(await bot.context.get('/api/player'), `${bot.displayName} dashboard`);
  }

  async phases(): Promise<PhasesResponse> {
    return requireOk<PhasesResponse>(await this.moderator.get(`/api/games/${this.gameId}/phases`), 'load phases');
  }

  async open(kind: PhaseKind): Promise<{ phaseId: string; slots: number }> {
    const closesAt = new Date(Date.now() + 20 * 60_000).toISOString();
    return requireOk<{ phaseId: string; slots: number }>(
      await this.moderator.post(`/api/games/${this.gameId}/phases`, { data: { action: 'OPEN', kind, closesAt } }),
      `open ${kind}`,
    );
  }

  async submitToPhase(phaseId: string, decision: Decision): Promise<{ version: number }> {
    return requireOk<{ version: number }>(
      await decision.bot.context.post(`/api/phases/${phaseId}/actions`, {
        data: { actionKind: decision.actionKind, targetIds: decision.targetIds },
      }),
      `${decision.bot.displayName} submit ${decision.actionKind}`,
    );
  }

  async submitConcurrently(phaseId: string, decisions: Decision[]): Promise<Array<{ version: number }>> {
    return Promise.all(decisions.map((decision) => this.submitToPhase(phaseId, decision)));
  }

  async lockAndPropose(phaseId: string): Promise<{ outcome: Outcome; hunterDeadline?: string | null }> {
    return requireOk<{ outcome: Outcome; hunterDeadline?: string | null }>(
      await this.moderator.post(`/api/games/${this.gameId}/phases`, { data: { action: 'LOCK_AND_PROPOSE', phaseId } }),
      'lock and propose phase',
    );
  }

  async finalizeHunter(phaseId: string, skipHunter = false): Promise<{ outcome: Outcome }> {
    return requireOk<{ outcome: Outcome }>(
      await this.moderator.post(`/api/games/${this.gameId}/phases`, { data: { action: 'FINALIZE_HUNTER', phaseId, skipHunter } }),
      'finalize Hunter',
    );
  }

  async publish(phaseId: string, override?: { eliminationIds: string[]; reason: string }): Promise<{ outcome: Outcome; winner: 'VILLAGE' | 'WEREWOLF' | null }> {
    const data = override
      ? { action: 'PUBLISH', phaseId, overrideEliminationIds: override.eliminationIds, overrideReason: override.reason }
      : { action: 'PUBLISH', phaseId };
    return requireOk<{ outcome: Outcome; winner: 'VILLAGE' | 'WEREWOLF' | null }>(
      await this.moderator.post(`/api/games/${this.gameId}/phases`, { data }),
      'publish phase',
    );
  }

  async enterFinalShowdown(): Promise<void> {
    await requireOk<{ status: string }>(
      await this.moderator.post(`/api/games/${this.gameId}/phases`, { data: { action: 'ENTER_FINAL_SHOWDOWN' } }),
      'enter final showdown',
    );
  }

  updateAlive(outcome: PhaseResolution): void {
    for (const elimination of outcome.eliminations) {
      this.botBySeatId(elimination.playerId).alive = false;
    }
  }

  expectedWinner(): 'VILLAGE' | 'WEREWOLF' | null {
    const living = this.livingBots();
    const wolves = living.filter((bot) => bot.role === 'WEREWOLF').length;
    const village = living.length - wolves;
    return wolves === 0 ? 'VILLAGE' : wolves >= village ? 'WEREWOLF' : null;
  }

  async dispose(): Promise<void> {
    await Promise.all(this.bots.map((bot) => bot.context.dispose().catch(() => undefined)));
  }
}

export function chooseLivingTarget(
  bots: Bot[],
  predicate: (bot: Bot) => boolean,
  actor?: Bot,
): Bot {
  const target = bots.find((bot) => bot.alive && (!actor || bot.seatId !== actor.seatId) && predicate(bot));
  if (!target) throw new Error('No living target satisfied the scripted decision.');
  return target;
}

export function expectErrorBody(data: ApiError, message: string): void {
  const text = [data.error, ...(data.errors ?? [])].filter(Boolean).join(' ');
  if (!text.includes(message)) throw new Error(`Expected error containing "${message}", received "${text}".`);
}

export async function readError(response: APIResponse): Promise<ApiError> {
  return responseData<ApiError>(response);
}
