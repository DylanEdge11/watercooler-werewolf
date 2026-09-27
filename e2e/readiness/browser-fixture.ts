import { randomInt, randomUUID } from 'node:crypto';
import { expect, type APIResponse, type Browser, type BrowserContext, type Page, type Response as PageResponse } from '@playwright/test';
import type { ActionKind, PhaseKind, PhaseResolution, RoleComposition, RoleKey } from '../../lib/game/types';
import { participationCounter } from '../../lib/game/actions';
import type { DashboardData } from '../../app/player-dashboard';
import type { TestInfo } from '@playwright/test';
import { BASE_URL, DEFAULT_COMPOSITION, E2E_PLAYER_COUNT, E2E_REMOTE, E2E_RUN_ID, MODERATOR_EMAIL, MODERATOR_PASSWORD } from '../constants';
import { E2E_REQUEST_HEADERS, newBrowserContext } from '../transport';

const ROLE_NAMES: Record<RoleKey, string> = {
  VILLAGER: 'Villager',
  WEREWOLF: 'Werewolf',
  SEER: 'Seer',
  BODYGUARD: 'Bodyguard',
  HUNTER: 'Hunter',
  MASON: 'Mason',
  APPRENTICE_SEER: 'Apprentice Seer',
  MAYOR: 'Mayor',
  CUPID: 'Cupid',
};

const FORBIDDEN_PLAYER_KEYS = new Set([
  'proposedOutcome',
  'reviewedOutcome',
  'publishedOutcome',
  'protectedPlayerIds',
  'investigations',
  'seerId',
  'selectedTargets',
  'hunterRequiredIds',
  'randomDraws',
  'tally',
  'warnings',
  'privateData',
  'privateActionTallies',
  'rawOutcome',
]);

const REDACTED_MESSAGE = '[redacted]';

export interface InviteRow {
  displayName: string;
  email: string;
  claimUrl: string;
  inviteCode: string;
}

export interface BrowserPlayerAccount {
  readonly index: number;
  readonly displayName: string;
  readonly email: string;
  readonly inviteCode: string;
  readonly claimUrl: string;
  readonly pin: string;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly seatId: string;
  role: RoleKey;
  alive: boolean;
}

/** The player dashboard response, as the app types it. */
export type PlayerDashboard = DashboardData;

export interface ModeratorPhase {
  id: string;
  sequence: number;
  kind: PhaseKind;
  status: string;
  slots: number;
  currentSubmissions: number;
  hunterDeadlineAt: string | null;
  proposal: null | {
    outcome: PhaseResolution;
    proposedOutcome?: PhaseResolution;
    reviewedOutcome?: PhaseResolution | null;
    publishedOutcome?: PhaseResolution | null;
    overrideReason: string | null;
  };
}

export interface ModeratorPhasesResponse {
  game: { status: string; finalCutoffAt: string; timezone: string };
  roster: Array<{ id: string; displayName: string; alive: boolean; role: RoleKey }>;
  phases: ModeratorPhase[];
}

interface ApiError {
  error?: string;
  errors?: string[];
}

interface TelemetryEntry {
  kind: string;
  label: string;
  detail: string;
}

function redactMessage(value: string): string {
  return value
    .replace(/\b\d{6}\b/gu, REDACTED_MESSAGE)
    .replace(/\b(?:VILLAGER|WEREWOLF|SEER|BODYGUARD|HUNTER|MASON|APPRENTICE_SEER|MAYOR|CUPID)\b/giu, '[role]')
    .replace(/\/claim\/[^/?#]+/gu, '/claim/[redacted]');
}

function redactedUrl(value: string): string {
  try {
    const url = new URL(value, BASE_URL);
    return `${url.origin}${url.pathname.replace(/^\/claim\/[^/]+$/u, '/claim/[redacted]')}`;
  } catch {
    return '[invalid-url]';
  }
}

function isLocalUrl(value: string): boolean {
  try {
    return new URL(value, BASE_URL).origin === new URL(BASE_URL).origin;
  } catch {
    return false;
  }
}

function isExpectedVercelProtectionProbe(method: string, value: string): boolean {
  try {
    const url = new URL(value, BASE_URL);
    if (url.origin !== new URL(BASE_URL).origin) return false;
    if (url.pathname === '/.well-known/vercel/jwe') return true;
    // Protected Preview navigation emits canceled HEAD probes for document
    // routes and an OPTIONS probe at the origin while browser contexts move
    // between pages. No application flow uses these methods; GET/POST failures
    // remain strict so API and document failures are still reported.
    return method === 'HEAD' || (method === 'OPTIONS' && url.pathname === '/');
  } catch {
    return false;
  }
}

function responseKey(response: PageResponse): string {
  return `${response.request().method()}:${response.url()}:${response.status()}`;
}

function csvValue(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function rosterCsv(suffix: string, playerCount: number): string {
  return [
    'display_name,email',
    ...Array.from({ length: playerCount }, (_, index) => {
      const number = String(index + 1).padStart(2, '0');
      return `${csvValue(`Player ${number}`)},${csvValue(`player${number}-${suffix}@e2e.test`)}`;
    }),
  ].join('\n');
}

function futureDeadlineInput(): string {
  return '2099-12-31T23:59';
}

interface JsonResponseLike {
  json(): Promise<unknown>;
  ok(): boolean;
  status(): number;
}

async function json<T>(response: JsonResponseLike, operation: string): Promise<T & ApiError> {
  const body = await response.json() as T & ApiError;
  if (!response.ok()) throw new Error(`${operation} failed with HTTP ${response.status()}.`);
  return body;
}

async function post<T>(context: BrowserContext, path: string, data: Record<string, unknown>, operation: string): Promise<T> {
  return json<T>(await context.request.post(path, { data, headers: E2E_REQUEST_HEADERS }), operation);
}

async function get<T>(context: BrowserContext, path: string, operation: string): Promise<T> {
  return json<T>(await context.request.get(path, { headers: E2E_REQUEST_HEADERS }), operation);
}

function recordForbiddenKeys(value: unknown, path = '$', found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => recordForbiddenKeys(entry, `${path}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_PLAYER_KEYS.has(key)) found.push(childPath);
    recordForbiddenKeys(child, childPath, found);
  }
  return found;
}

export class BrowserTelemetry {
  private readonly byPage = new Map<Page, { label: string; entries: TelemetryEntry[] }>();
  private readonly allowedResponses = new Set<string>();
  private readonly allowedConsoleErrors: RegExp[] = [];

  attach(page: Page, label: string): void {
    const state = { label, entries: [] as TelemetryEntry[] };
    this.byPage.set(page, state);
    void page.addInitScript(() => {
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
        console.error('__playwright_unhandled_rejection__', reason);
      });
    });
    page.on('pageerror', (error) => {
      state.entries.push({ kind: 'pageerror', label, detail: redactMessage(error.message) });
    });
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        if (message.type() === 'error') {
          const allowedIndex = this.allowedConsoleErrors.findIndex((pattern) => pattern.test(message.text()));
          if (allowedIndex >= 0) {
            this.allowedConsoleErrors.splice(allowedIndex, 1);
            return;
          }
        }
        state.entries.push({ kind: `console-${message.type()}`, label, detail: redactMessage(message.text()) });
      }
    });
    page.on('requestfailed', (request) => {
      // Vercel's protected Preview runtime probes this platform-owned endpoint
      // from the page without forwarding the automation bypass header. Its
      // failure is expected after the root/API preflight has authenticated the
      // deployment; application-origin failures remain strict below.
      if (isLocalUrl(request.url()) && !isExpectedVercelProtectionProbe(request.method(), request.url())) {
        state.entries.push({ kind: 'requestfailed', label, detail: `${request.method()} ${redactedUrl(request.url())}` });
      }
    });
    page.on('response', (response) => {
      if (response.status() >= 500 && !this.allowedResponses.has(responseKey(response))) {
        state.entries.push({ kind: '5xx', label, detail: `${response.status()} ${redactedUrl(response.url())}` });
      }
    });
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      let pathname = '/';
      try {
        pathname = new URL(frame.url()).pathname;
      } catch {
        state.entries.push({ kind: 'navigation', label, detail: '[invalid-navigation]' });
        return;
      }
      const allowed = pathname === '/' || pathname === '/player-login' || pathname === '/moderator' || /^\/claim\/[^/]+$/u.test(pathname);
      if (!allowed) state.entries.push({ kind: 'navigation', label, detail: redactedUrl(frame.url()) });
    });
  }

  allowResponse(response: PageResponse): void {
    this.allowedResponses.add(responseKey(response));
  }

  allowConsoleError(pattern: RegExp, count = 1): void {
    for (let index = 0; index < count; index += 1) this.allowedConsoleErrors.push(pattern);
  }

  errorEntries(): TelemetryEntry[] {
    return [...this.byPage.values()]
      .flatMap((state) => state.entries)
      .filter((entry) => entry.kind === 'pageerror' || entry.kind === 'console-error' || entry.kind === 'requestfailed' || entry.kind === '5xx' || entry.kind === 'navigation');
  }

  warningEntries(): TelemetryEntry[] {
    return [...this.byPage.values()]
      .flatMap((state) => state.entries)
      .filter((entry) => entry.kind === 'console-warning');
  }

  assertHealthy(): void {
    const errors = this.errorEntries();
    if (errors.length) throw new Error(`Unexpected browser telemetry (${errors.length}): ${errors.map((entry) => `${entry.kind}@${entry.label}:${entry.detail}`).join(', ')}`);
  }
}

export interface SharedModerator {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly telemetry: BrowserTelemetry;
}

function localClientAddress(): string {
  return `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`;
}

let sharedModerator: SharedModerator | null = null;
let sharedModeratorPromise: Promise<SharedModerator> | null = null;

export async function getSharedModerator(browser: Browser): Promise<SharedModerator> {
  if (sharedModerator) return sharedModerator;
  sharedModeratorPromise ??= (async () => {
    // Locally every browser otherwise looks like one client, so the sign-ins
    // of a failed test's retries used up the moderator allowance (5 per 15
    // minutes) and failed every later test. Each local sign-in gets its own
    // private client address. Hosted runs keep the real per-client limit.
    const context = await newBrowserContext(browser, E2E_REMOTE ? {} : { extraHTTPHeaders: { 'x-forwarded-for': localClientAddress() } });
    const page = await context.newPage();
    const telemetry = new BrowserTelemetry();
    telemetry.attach(page, 'moderator');
    telemetry.allowConsoleError(/status of 401/iu, 4);
    await page.goto('/moderator');
    await expect(page.getByRole('heading', { name: /Moderator sign-in|Owner setup required/u })).toBeVisible();
    if (!(await page.getByRole('heading', { name: 'Moderator sign-in', exact: true }).count())) throw new Error('The disposable test server did not bootstrap the fictional moderator.');
    await page.getByLabel('Email').fill(MODERATOR_EMAIL);
    await page.getByLabel('Password').fill(MODERATOR_PASSWORD);
    const login = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/moderators/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const loginResponse = await login;
    if (!loginResponse.ok()) throw new Error('Moderator browser sign-in failed.');
    await expect(page.getByText('Launch checklist', { exact: true })).toBeVisible();
    sharedModerator = { context, page, telemetry };
    return sharedModerator;
  })();
  try {
    return await sharedModeratorPromise;
  } finally {
    sharedModeratorPromise = null;
  }
}

export async function closeSharedModerator(): Promise<void> {
  const current = sharedModerator;
  sharedModerator = null;
  if (current) await current.context.close().catch(() => undefined);
}

export class BrowserPlayer {
  constructor(public readonly account: BrowserPlayerAccount, private readonly telemetry: BrowserTelemetry) {}

  get page(): Page { return this.account.page; }
  get context(): BrowserContext { return this.account.context; }

  async claimAndSignIn(): Promise<void> {
    await this.page.goto(this.account.claimUrl);
    await expect(this.page.getByRole('heading', { name: `Welcome, ${this.account.displayName}.`, exact: true })).toBeVisible();
    await this.page.getByLabel('Six-digit PIN').fill(this.account.pin);
    const claim = this.page.waitForResponse((response) => response.request().method() === 'POST' && /\/api\/seats\/claim\/[^/]+$/u.test(new URL(response.url()).pathname));
    await this.page.getByRole('button', { name: 'Claim my seat', exact: true }).click();
    const claimResponse = await claim;
    if (!claimResponse.ok()) {
      const body = await claimResponse.json().catch(() => ({})) as { error?: string };
      throw new Error(`Player ${this.account.index} seat claim failed with HTTP ${claimResponse.status()}: ${body.error ?? 'unknown response'}`);
    }
    await expect(this.page.getByRole('heading', { name: 'Your seat is ready.', exact: true })).toBeVisible();
    await this.page.getByRole('link', { name: 'Enter the game', exact: true }).click();
    await this.waitForDashboard();
    this.telemetry.allowConsoleError(/status of 401/iu, 3);
    await this.page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await this.page.waitForURL((url) => url.pathname === '/');

    await this.page.goto('/player-login');
    await expect(this.page.getByRole('heading', { name: 'Player sign-in', exact: true })).toBeVisible();
    await this.page.getByLabel('Seat code').fill(this.account.inviteCode);
    await this.page.getByLabel('Six-digit PIN').fill(this.account.pin);
    const login = this.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/seats/login');
    await this.page.getByRole('button', { name: 'Enter the game', exact: true }).click();
    const loginResponse = await login;
    if (!loginResponse.ok()) throw new Error(`Player ${this.account.index} browser sign-in failed.`);
    await this.waitForDashboard();
  }

  async waitForDashboard(): Promise<void> {
    await expect(this.page.getByText('Your private role', { exact: true })).toBeVisible({ timeout: 30_000 });
  }

  async reload(): Promise<PlayerDashboard> {
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.waitForDashboard();
    return this.dashboard();
  }

  async dashboard(): Promise<PlayerDashboard> {
    return json<PlayerDashboard>(await this.context.request.get('/api/player', { headers: E2E_REQUEST_HEADERS }), `dashboard ${this.account.index}`);
  }

  async selectTarget(target: BrowserPlayerAccount): Promise<void> {
    const button = this.page.getByRole('button').filter({ hasText: target.displayName }).filter({ hasText: 'Living player' }).first();
    await expect(button).toBeVisible();
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  }

  async clearSelection(): Promise<void> {
    const selected = this.page.getByRole('button', { pressed: true });
    for (let index = await selected.count() - 1; index >= 0; index -= 1) await selected.nth(index).click();
  }

  async prepareTarget(target: BrowserPlayerAccount): Promise<void> {
    await this.clearSelection();
    await this.selectTarget(target);
  }

  async submitPrepared(): Promise<{ status: number; version?: number; elapsedMs: number }> {
    const startedAt = Date.now();
    const responsePromise = this.page.waitForResponse((response) => response.request().method() === 'POST' && /\/api\/phases\/[^/]+\/actions$/u.test(new URL(response.url()).pathname));
    await this.page.getByRole('button', { name: 'Save response', exact: true }).click();
    const response = await responsePromise;
    const body = await response.json() as { version?: number };
    this.telemetry.allowResponse(response);
    if (response.ok()) await expect(this.page.getByRole('status')).toContainText('Response saved as revision');
    return { status: response.status(), version: body.version, elapsedMs: Date.now() - startedAt };
  }

  async submitPreparedExpectingError(expectedStatus: number, expectedMessage: RegExp): Promise<void> {
    const responsePromise = this.page.waitForResponse((response) => response.request().method() === 'POST' && /\/api\/phases\/[^/]+\/actions$/u.test(new URL(response.url()).pathname));
    this.telemetry.allowConsoleError(new RegExp(`status of ${expectedStatus}`, 'iu'));
    await this.page.getByRole('button', { name: 'Save response', exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(expectedStatus);
    this.telemetry.allowResponse(response);
    await expect(this.page.getByRole('alert').filter({ hasText: expectedMessage }).first()).toBeVisible();
  }

  async doubleClickPrepared(): Promise<number> {
    let requests = 0;
    const listener = (request: { method(): string; url(): string }) => {
      if (request.method() === 'POST' && /\/api\/phases\/[^/]+\/actions$/u.test(new URL(request.url()).pathname)) requests += 1;
    };
    this.page.on('request', listener);
    await this.page.getByRole('button', { name: 'Save response', exact: true }).dblclick();
    await expect.poll(() => requests).toBe(1);
    // Wait for the save itself, so a read that follows sees it.
    await expect(this.page.getByRole('status')).toContainText('Response saved as revision');
    this.page.off('request', listener);
    return requests;
  }

  async submitActionDirect(phaseId: string, actionKind: ActionKind, targetIds: string[]): Promise<{ response: APIResponse; body: ApiError }> {
    const response = await this.context.request.post(`/api/phases/${phaseId}/actions`, { data: { actionKind, targetIds }, headers: E2E_REQUEST_HEADERS });
    const body = await response.json() as ApiError;
    return { response, body };
  }

  async expectRoleVisible(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: ROLE_NAMES[this.account.role], exact: true })).toBeVisible();
  }

  async expectCompleted(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'The campaign is complete.', exact: true })).toBeVisible();
    await expect(this.page.getByRole('button', { name: 'Save response', exact: true })).toHaveCount(0);
    await expect(this.page.getByText('This campaign is complete.', { exact: false })).toBeVisible();
  }

  async expectReadOnly(): Promise<void> {
    const data = await this.dashboard();
    expect(data.permission.actionKind).toBeNull();
    expect(data.rooms.every((room) => room.status === 'READ_ONLY' || room.type === 'DEAD')).toBe(true);
  }
}

export interface BrowserGameOptions {
  name?: string;
  composition?: RoleComposition;
  /** Roster size; must equal the composition total. Defaults to E2E_PLAYER_COUNT. */
  playerCount?: number;
  setupThroughUi?: boolean;
  /** UI setup only: choose automatic results in the create form instead of the review default. */
  automaticResults?: boolean;
  mobilePlayerIndex?: number;
}

export class BrowserGame {
  private constructor(
    public readonly moderator: SharedModerator,
    public readonly gameId: string,
    public readonly gameName: string,
    public readonly players: BrowserPlayer[],
    public readonly composition: RoleComposition,
    public readonly telemetry: BrowserTelemetry,
  ) {}

  static async create(browser: Browser, testInfo: TestInfo, options: BrowserGameOptions = {}): Promise<BrowserGame> {
    const moderator = await getSharedModerator(browser);
    const telemetry = moderator.telemetry;
    const gameName = options.name ?? `Browser Readiness ${E2E_RUN_ID} ${randomUUID().slice(0, 8)}`;
    const composition = options.composition ?? DEFAULT_COMPOSITION;
    const playerCount = options.playerCount ?? E2E_PLAYER_COUNT;
    const suffix = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const useUiSetup = Boolean(options.setupThroughUi);
    let gameId = '';
    let invites: InviteRow[] = [];
    const contexts: BrowserContext[] = [];

    try {
      if (useUiSetup) {
        await moderator.page.goto('/moderator');
        const gameNameField = moderator.page.getByLabel('Game name');
        if (!(await gameNameField.count())) {
          await expect(moderator.page.getByRole('button', { name: 'Start new setup', exact: true })).toBeVisible();
          await moderator.page.getByRole('button', { name: 'Start new setup', exact: true }).click();
        }
        await expect(gameNameField).toBeVisible();
        await gameNameField.fill(gameName);
        if (options.automaticResults) await moderator.page.getByRole('group', { name: 'Results', exact: true }).getByLabel('Publish automatically after a review window').check();
        const createResponsePromise = moderator.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/games');
        await moderator.page.getByRole('button', { name: 'Create game', exact: true }).click();
        const created = await json<{ gameId: string }>(await createResponsePromise, 'create browser game');
        gameId = created.gameId;
        await expect(moderator.page.getByRole('heading', { name: gameName, exact: true })).toBeVisible();
        const rosterResponsePromise = moderator.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${gameId}/roster`);
        await moderator.page.getByLabel('Roster CSV').fill(rosterCsv(suffix, playerCount));
        await moderator.page.getByRole('button', { name: 'Create private seats', exact: true }).click();
        const rosterData = await json<{ invites: InviteRow[] }>(await rosterResponsePromise, 'import browser roster');
        invites = rosterData.invites;
      } else {
        const created = await post<{ gameId: string }>(moderator.context, '/api/games', {
          name: gameName,
          timezone: 'America/Regina',
          // The cutoff is in the past so final showdown is available at once; it must fall within the dates.
          startDate: '2000-01-01',
          endDate: '2099-12-31',
          finalCutoffAt: '2000-01-01T00:00',
          activeWeekdays: [1, 2, 3, 4, 5],
          schedule: { dayCloses: '16:00', nightCloses: '09:00' },
          // These scripted games drive every lock, Hunter follow-up, and publish by hand, so automatic results stay off.
          // The UI-created UAT game opts in to automatic results and checks them.
          publicationMode: 'REVIEW',
        }, 'create browser game');
        gameId = created.gameId;
        const rosterData = await post<{ invites: InviteRow[] }>(moderator.context, `/api/games/${gameId}/roster`, { csv: rosterCsv(suffix, playerCount) }, 'import browser roster');
        invites = rosterData.invites;
      }

      const roster = await get<{ roster: Array<{ id: string; displayName: string }> }>(moderator.context, `/api/games/${gameId}/roster`, 'load browser roster');
      const seatByName = new Map(roster.roster.map((seat) => [seat.displayName, seat.id]));
      const players: BrowserPlayer[] = [];
      // Claims and first logins are intentionally serialized. They still use
      // independent browser contexts, while avoiding SQLite write-lock races
      // in the disposable local server during fixture setup.
      for (const [index, invite] of invites.entries()) {
        const context = await newBrowserContext(browser);
        contexts.push(context);
        const page = await context.newPage();
        telemetry.attach(page, `player-${String(index + 1).padStart(2, '0')}`);
        // Each player sees a one-time "A player has been eliminated" notice after
        // a published elimination. Acknowledge it whenever it covers the page.
        await page.addLocatorHandler(page.getByRole('button', { name: 'I understand', exact: true }), async (button) => {
          await button.click();
        });
        if (options.mobilePlayerIndex === index) await page.setViewportSize({ width: 390, height: 844 });
        const seatId = seatByName.get(invite.displayName);
        if (!seatId) throw new Error(`Player seat ${index + 1} was not returned by the moderator roster.`);
        const account: BrowserPlayerAccount = {
          index: index + 1,
          displayName: invite.displayName,
          email: invite.email,
          inviteCode: invite.inviteCode,
          claimUrl: invite.claimUrl,
          pin: String(410000 + index).slice(-6),
          context,
          page,
          seatId,
          role: 'VILLAGER',
          alive: true,
        };
        const player = new BrowserPlayer(account, telemetry);
        await player.claimAndSignIn();
        players.push(player);
      }

      if (!useUiSetup) {
        await post(moderator.context, `/api/games/${gameId}/assignments`, { action: 'SAVE_COMPOSITION', composition }, 'save browser composition');
        const preview = await post<{ batchId: string; assignments: Array<{ seatId: string; role: RoleKey }> }>(moderator.context, `/api/games/${gameId}/assignments`, { action: 'PREVIEW' }, 'preview browser assignments');
        const roleBySeat = new Map(preview.assignments.map((assignment) => [assignment.seatId, assignment.role]));
        for (const player of players) {
          const role = roleBySeat.get(player.account.seatId);
          if (!role) throw new Error(`Player ${player.account.index} did not receive a moderator assignment.`);
          player.account.role = role;
        }
        await post(moderator.context, `/api/games/${gameId}/assignments`, { action: 'RELEASE', batchId: preview.batchId }, 'release browser assignments');
      } else {
        await moderator.page.reload();
        await expect(moderator.page.getByText(`${playerCount} of ${playerCount} claimed`, { exact: true })).toBeVisible({ timeout: 30_000 });
        for (const role of Object.keys(composition) as RoleKey[]) await moderator.page.getByRole('spinbutton', { name: ROLE_NAMES[role], exact: true }).fill(String(composition[role]));
        await moderator.page.getByRole('button', { name: 'Save composition', exact: true }).click();
        await expect(moderator.page.getByRole('status')).toContainText('Role composition saved');
        const previewResponsePromise = moderator.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${gameId}/assignments`);
        await moderator.page.getByRole('button', { name: 'Randomize roles', exact: true }).click();
        const preview = await json<{ batchId: string; assignments: Array<{ seatId: string; role: RoleKey }> }>(await previewResponsePromise, 'preview browser assignments');
        const roleBySeat = new Map(preview.assignments.map((assignment) => [assignment.seatId, assignment.role]));
        for (const player of players) {
          const role = roleBySeat.get(player.account.seatId);
          if (!role) throw new Error(`Player ${player.account.index} did not receive a moderator assignment.`);
          player.account.role = role;
        }
        await expect(moderator.page.getByRole('button', { name: 'Release roles to players', exact: true })).toBeVisible();
        const releaseResponsePromise = moderator.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${gameId}/assignments`);
        await moderator.page.getByRole('button', { name: 'Release roles to players', exact: true }).click();
        const releaseResponse = await releaseResponsePromise;
        if (!releaseResponse.ok()) throw new Error('The moderator UI could not release assignments.');
      }

      const game = new BrowserGame(moderator, gameId, gameName, players, composition, telemetry);
      testInfo.annotations.push({ type: 'scenario', description: `game=${gameId}; players=${playerCount}` });
      await Promise.all(players.map(async (player) => {
        await expect.poll(async () => (await player.dashboard()).player.role, { timeout: 30_000 }).toBe(player.account.role);
        await player.reload();
        await player.expectRoleVisible();
        const dashboard = await player.dashboard();
        expect(dashboard.player.id).toBe(player.account.seatId);
        expect(dashboard.player.displayName).toBe(player.account.displayName);
        expect(dashboard.player.role).toBe(player.account.role);
      }));
      return game;
    } catch (error) {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
      throw error;
    }
  }

  get accounts(): BrowserPlayerAccount[] { return this.players.map((player) => player.account); }
  living(): BrowserPlayer[] { return this.players.filter((player) => player.account.alive); }
  byRole(role: RoleKey): BrowserPlayer[] { return this.players.filter((player) => player.account.role === role); }

  playerBySeatId(seatId: string): BrowserPlayer {
    const player = this.players.find((candidate) => candidate.account.seatId === seatId);
    if (!player) throw new Error('The browser fixture received an unknown seat id.');
    return player;
  }

  chooseLiving(predicate: (player: BrowserPlayer) => boolean, actor?: BrowserPlayer): BrowserPlayer {
    const target = this.living().find((player) => (!actor || player.account.seatId !== actor.account.seatId) && predicate(player));
    if (!target) throw new Error('The browser fixture could not find a living target for the scripted action.');
    return target;
  }

  async phases(): Promise<ModeratorPhasesResponse> {
    return get<ModeratorPhasesResponse>(this.moderator.context, `/api/games/${this.gameId}/phases`, 'load moderator phases');
  }

  phaseById(phaseId: string, state: ModeratorPhasesResponse): ModeratorPhase {
    const phase = state.phases.find((candidate) => candidate.id === phaseId);
    if (!phase) throw new Error('The moderator phase response did not include the expected phase.');
    return phase;
  }

  async openPhase(kind: PhaseKind, closesAt = futureDeadlineInput()): Promise<{ phaseId: string; slots: number }> {
    await this.moderator.page.reload();
    await expect(this.moderator.page.getByRole('heading', { name: 'Run the live game', exact: true })).toBeVisible({ timeout: 30_000 });
    await this.moderator.page.getByLabel('Phase').selectOption(kind);
    await this.moderator.page.getByLabel(/Deadline \(/u).fill(closesAt);
    const responsePromise = this.moderator.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${this.gameId}/phases`);
    await this.moderator.page.getByRole('button', { name: 'Open phase', exact: true }).click();
    return json<{ phaseId: string; slots: number }>(await responsePromise, `open ${kind}`);
  }

  async lockAndPropose(phaseId: string): Promise<{ outcome: PhaseResolution; hunterDeadline?: string | null }> {
    await this.moderator.page.reload();
    await expect(this.moderator.page.getByRole('heading', { name: 'Run the live game', exact: true })).toBeVisible({ timeout: 30_000 });
    const lockButton = this.moderator.page.getByRole('button', { name: /Lock responses & calculate|Calculate locked responses/u }).first();
    await expect(lockButton).toBeVisible();
    const responsePromise = this.moderator.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${this.gameId}/phases`);
    await lockButton.click();
    return json<{ outcome: PhaseResolution; hunterDeadline?: string | null }>(await responsePromise, `lock phase ${phaseId}`);
  }

  async finalizeHunter(phaseId: string): Promise<{ outcome: PhaseResolution }> {
    await this.moderator.page.reload();
    await expect(this.moderator.page.getByText('Hunter follow-up required', { exact: true })).toBeVisible({ timeout: 30_000 });
    const responsePromise = this.moderator.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${this.gameId}/phases`);
    await this.moderator.page.getByRole('button', { name: 'Finalize Hunter', exact: true }).click();
    return json<{ outcome: PhaseResolution }>(await responsePromise, `finalize Hunter ${phaseId}`);
  }

  async publish(phaseId: string): Promise<{ outcome: PhaseResolution; winner: 'VILLAGE' | 'WEREWOLF' | null }> {
    await this.moderator.page.reload();
    await expect(this.moderator.page.getByRole('heading', { name: 'Run the live game', exact: true })).toBeVisible({ timeout: 30_000 });
    const publishButton = this.moderator.page.getByRole('button', { name: 'Approve & publish', exact: true });
    await expect(publishButton).toBeVisible();
    const responsePromise = this.moderator.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${this.gameId}/phases`);
    await publishButton.click();
    return json<{ outcome: PhaseResolution; winner: 'VILLAGE' | 'WEREWOLF' | null }>(await responsePromise, `publish phase ${phaseId}`);
  }

  async enterFinalShowdown(): Promise<void> {
    await this.moderator.page.reload();
    await expect(this.moderator.page.getByRole('button', { name: 'Enter final showdown', exact: true })).toBeVisible({ timeout: 30_000 });
    const responsePromise = this.moderator.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${this.gameId}/phases`);
    await this.moderator.page.getByRole('button', { name: 'Enter final showdown', exact: true }).click();
    await json<unknown>(await responsePromise, 'enter final showdown');
  }

  async submitConcurrently(decisions: Array<{ player: BrowserPlayer; target: BrowserPlayer }>): Promise<Array<{ status: number; version?: number; elapsedMs: number }>> {
    if (!decisions.length) return [];
    await Promise.all(decisions.map((decision) => decision.player.prepareTarget(decision.target.account)));
    const result = await Promise.all(decisions.map((decision) => decision.player.submitPrepared()));
    expect(result.every((entry) => entry.status < 500)).toBe(true);
    return result;
  }

  async assertPlayerPrivacy(player: BrowserPlayer, options: { allowOwnInvestigation?: boolean } = {}): Promise<PlayerDashboard> {
    const dashboard = await player.dashboard();
    expect(recordForbiddenKeys(dashboard), `private fields leaked to player ${player.account.index}`).toEqual([]);
    expect(dashboard.player.id).toBe(player.account.seatId);
    expect(dashboard.player.role).toBe(player.account.role);
    expect(dashboard.candidates.every((candidate) => Object.keys(candidate).sort().join(',') === 'displayName,id')).toBe(true);
    expect(dashboard.player.teammates.every((teammate) => Object.keys(teammate).sort().join(',') === 'alive,displayName,id')).toBe(true);
    if (!options.allowOwnInvestigation) expect(dashboard.notifications.some((notification) => notification.type === 'INVESTIGATION_RESULT')).toBe(false);
    // "N of M submitted" may count across players only for Day ballots and the pack's own vote.
    // Any other action, including a future Night role, is counted for the reader alone.
    expect(Object.keys(dashboard.participation).sort().join(',')).toBe('eligible,submitted');
    expect(dashboard.participation).toEqual(participationCounter({
      actionKind: dashboard.phase ? dashboard.permission.actionKind : null,
      livingPlayers: dashboard.game.counts.living,
      livingWerewolves: dashboard.game.counts.werewolvesRemaining,
      sharedSubmissions: dashboard.participation.submitted,
      ownSubmission: Boolean(dashboard.currentAction),
    }));
    if (dashboard.permission.actionKind === 'WOLF_VOTE') expect(dashboard.player.role).toBe('WEREWOLF');
    const rendered = await player.page.locator('body').innerText();
    expect(rendered).not.toContain('Proposed outcome');
    expect(rendered).not.toContain('Vote tally');
    expect(rendered).not.toContain('Protected:');
    return dashboard;
  }

  async assertModeratorOnlyRoutes(player: BrowserPlayer): Promise<void> {
    for (const path of [`/api/games/${this.gameId}/roster`, `/api/games/${this.gameId}/assignments`, `/api/games/${this.gameId}/phases`, `/api/games/${this.gameId}/operations`]) {
      const response = await player.context.request.get(path, { headers: E2E_REQUEST_HEADERS });
      expect(response.status()).toBe(401);
    }
  }

  async assertNoActionAfterCompletion(player: BrowserPlayer, phaseId: string, target: BrowserPlayer): Promise<void> {
    const result = await player.submitActionDirect(phaseId, 'DAY_VOTE', [target.account.seatId]);
    expect(result.response.status()).toBe(400);
    expect(`${result.body.error ?? ''} ${(result.body.errors ?? []).join(' ')}`).toMatch(/not accepting|complete|closed/iu);
  }

  async updateAlive(outcome: PhaseResolution): Promise<void> {
    for (const elimination of outcome.eliminations) this.playerBySeatId(elimination.playerId).account.alive = false;
  }

  async assertHealthy(): Promise<void> { this.telemetry.assertHealthy(); }
  async dispose(): Promise<void> { await Promise.all(this.players.map((player) => player.context.close().catch(() => undefined))); }
}

export function roleName(role: RoleKey): string { return ROLE_NAMES[role]; }
export function actionForRole(role: RoleKey, phaseKind: PhaseKind): ActionKind | null {
  if (phaseKind === 'DAY' || phaseKind === 'FINAL_BALLOT') return 'DAY_VOTE';
  if (role === 'WEREWOLF') return 'WOLF_VOTE';
  if (role === 'SEER') return 'INVESTIGATE';
  if (role === 'BODYGUARD') return 'PROTECT';
  return null;
}

export function verifyExpectedRoleComposition(players: BrowserPlayerAccount[], expected: RoleComposition): void {
  const counts = Object.fromEntries(Object.keys(expected).map((key) => [key, 0])) as RoleComposition;
  for (const player of players) counts[player.role] += 1;
  expect(counts).toEqual(expected);
}
