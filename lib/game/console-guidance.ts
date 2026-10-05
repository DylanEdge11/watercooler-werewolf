import { MAX_PLAYERS, MIN_PLAYERS } from './player-count';
import { phaseName } from './timeline-view';

/**
 * How the moderator console is organised and what it tells a moderator to do
 * next. Pure and UI-free so the wording and the rules for which tab opens first
 * are unit-tested; nothing here changes a game rule.
 */

export const CONSOLE_TABS = [
  { id: 'setup', label: 'Setup', blurb: 'Schedule, sign-ups, roster, roles, and release. This is the one-time launch.' },
  { id: 'run', label: 'Run game', blurb: 'Open each phase, chase missing responses, lock, review, and publish.' },
  { id: 'people', label: 'People', blurb: 'Help a player back in, manage spectators, and share the game with co-moderators, including people who apply.' },
  { id: 'messages', label: 'Messages', blurb: 'Announce to everyone, moderate the chat rooms, and read player feedback.' },
  { id: 'safety', label: 'Safety & records', blurb: 'What the game has been doing, backups, and the controls that stop or reset a game.' },
] as const;

export type ConsoleTabId = (typeof CONSOLE_TABS)[number]['id'];

export function isConsoleTabId(value: string): value is ConsoleTabId {
  return CONSOLE_TABS.some((tab) => tab.id === value);
}

/** Statuses where the work is running the game rather than preparing it. */
const RUN_STATUSES = new Set(['ACTIVE', 'FINAL_SHOWDOWN', 'COMPLETED', 'STOPPED']);

/** The tab a moderator lands on: Setup until roles are released, then Run game. */
export function defaultConsoleTab(status: string | undefined): ConsoleTabId {
  return status && RUN_STATUSES.has(status) ? 'run' : 'setup';
}

export type ChecklistState = 'done' | 'active' | 'todo';

export interface LaunchProgress {
  gameCount: number;
  seatCount: number;
  claimedCount: number;
  hasBatch: boolean;
  released: boolean;
}

export interface LaunchChecklist {
  schedule: ChecklistState;
  roster: ChecklistState;
  roles: ChecklistState;
  release: ChecklistState;
}

/** The four launch steps: done once passed, active when it is the one to do now. */
export function launchChecklist(progress: LaunchProgress): LaunchChecklist {
  const { gameCount, seatCount, hasBatch, released } = progress;
  // A roster built from sign-ups passes through sizes too small to play, so the roster is done only at the minimum.
  const rosterReady = seatCount >= MIN_PLAYERS;
  return {
    schedule: gameCount ? 'done' : 'active',
    roster: rosterReady ? 'done' : gameCount ? 'active' : 'todo',
    roles: hasBatch ? 'done' : rosterReady ? 'active' : 'todo',
    release: released ? 'done' : hasBatch ? 'active' : 'todo',
  };
}

/**
 * What happened to the role counts after people were added to the roster in bulk (accepted from
 * sign-ups, or a list added to the roster). Below the minimum there are no counts yet; more than
 * one new player starts again from the standard preset; one new player keeps the moderator's counts.
 */
export function rosterCountsNote(result: { playerCount: number; resetToPreset: boolean; villagers: number }): string {
  if (result.playerCount < MIN_PLAYERS) return `The roster has ${result.playerCount} so far, and a game needs at least ${MIN_PLAYERS}.`;
  if (result.resetToPreset) return `Role counts were set to the standard preset for ${result.playerCount} players.`;
  return `Role counts now have ${result.villagers} ${result.villagers === 1 ? 'Villager' : 'Villagers'}; other roles are unchanged.`;
}

export type SetupStepKey = 'signups' | 'roster' | 'roles' | 'release';

export interface ConsoleHint {
  title: string;
  detail: string;
  /** The setup step this hint is about, so the console can offer a way to jump to it. */
  step?: SetupStepKey;
}

/**
 * The next thing to do before and after a game, shown above the tabs. While a
 * game is running, the Run game tab says what to do for the current phase.
 */
export function setupHint(input: { status: string | undefined; seatCount: number; claimedCount: number; hasBatch: boolean; released: boolean; pendingSignups?: number; signupsOpen?: boolean }): ConsoleHint | null {
  const { status, seatCount, claimedCount, hasBatch, released } = input;
  const pendingSignups = input.pendingSignups ?? 0;
  if (status === 'COMPLETED') return { title: 'The game is over', detail: 'Download a JSON backup under Safety & records to keep a private record of it.' };
  if (status === 'STOPPED') return { title: 'This game was stopped', detail: 'Players can no longer act and the rooms are read-only. Download a backup under Safety & records, or start a new setup.' };
  if (!status || !['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW'].includes(status) || released) return null;
  // People waiting come first: they are the one thing here that changes without the moderator doing anything.
  if (pendingSignups > 0 && status !== 'ASSIGNMENT_PREVIEW') {
    const need = Math.max(0, MIN_PLAYERS - seatCount);
    return {
      title: `${pendingSignups} ${pendingSignups === 1 ? 'person has' : 'people have'} signed up`,
      detail: `Accept the people you want in the game. A game needs ${MIN_PLAYERS} to ${MAX_PLAYERS} players${seatCount ? `, and the roster has ${seatCount}${need ? `, so ${need} more ${need === 1 ? 'is' : 'are'} needed` : ''}` : ''}.`,
      step: 'signups',
    };
  }
  if (seatCount < MIN_PLAYERS) {
    if (input.signupsOpen) return { title: 'Sign-ups are open', detail: `Share the sign-up link and accept the people you want as they arrive. If you have a list of your own, you can import it too, before or after. A game needs ${MIN_PLAYERS} to ${MAX_PLAYERS} players${seatCount ? `; the roster has ${seatCount}` : ''}.`, step: 'signups' };
    if (seatCount) {
      const need = MIN_PLAYERS - seatCount;
      return { title: `Add ${need} more ${need === 1 ? 'player' : 'players'}`, detail: `A game needs at least ${MIN_PLAYERS} players and the roster has ${seatCount}. Accept more sign-ups, add players one at a time, or import a roster.`, step: 'roster' };
    }
    return { title: 'Next: add your players', detail: `Paste a roster of ${MIN_PLAYERS} to ${MAX_PLAYERS} players under Import the roster, or open sign-ups and let people join from a link. Each player gets their own private seat link.`, step: 'roster' };
  }
  if (claimedCount < seatCount) {
    const waiting = seatCount - claimedCount;
    return { title: `Waiting for ${waiting} ${waiting === 1 ? 'player' : 'players'} to claim a seat`, detail: 'Email the invitations or send each person their own link. You can add or remove a player until you randomize roles.', step: 'roster' };
  }
  if (!hasBatch) return { title: 'Next: balance the roles', detail: 'Everyone has a seat. Check the role counts, save them, then randomize. Players see nothing until you release.', step: 'roles' };
  return { title: 'Next: review and release the roles', detail: 'The roles are randomized but still private. Releasing is permanent: it starts the game and locks setup.', step: 'release' };
}

export interface TabCount {
  count: number;
  description: string;
}

/**
 * The numbers on the Setup and People tabs: people waiting to be accepted onto the roster, and
 * applications waiting for the owner. Only counted where the moderator can act on them.
 */
export function waitingBadges(input: { pendingSignups: number; pendingApplications: number; setupEditable: boolean; isOwner: boolean }): { setup?: TabCount; people?: TabCount } {
  const badges: { setup?: TabCount; people?: TabCount } = {};
  if (input.setupEditable && input.pendingSignups > 0) {
    badges.setup = { count: input.pendingSignups, description: `${input.pendingSignups} ${input.pendingSignups === 1 ? 'person is' : 'people are'} waiting to be accepted into the game` };
  }
  if (input.isOwner && input.pendingApplications > 0) {
    badges.people = { count: input.pendingApplications, description: `${input.pendingApplications} moderator ${input.pendingApplications === 1 ? 'application is' : 'applications are'} waiting for your decision` };
  }
  return badges;
}

export interface RunPhase {
  kind: string;
  sequence: number;
  status: string;
}

/** What to do now in a running game, from the newest unfinished phase (or none). */
export function runHint(input: { status: string | undefined; current: RunPhase | null; lastPublishedKind: string | null }): ConsoleHint | null {
  const { status, current, lastPublishedKind } = input;
  if (!status || ['COMPLETED', 'STOPPED', 'CANCELLED'].includes(status)) return null;
  if (!current) {
    if (status === 'FINAL_SHOWDOWN') return { title: 'Open the final ballot', detail: 'Final showdown is on, so the final ballot is the only phase left. Choose a deadline and open it.' };
    if (status !== 'ACTIVE') return null;
    const next = lastPublishedKind === null ? 'the first Day' : lastPublishedKind === 'DAY' ? 'the next Night' : 'the next Day';
    return { title: `Open ${next}`, detail: 'Check the deadline, then select Open phase. Players can respond as soon as it opens.' };
  }
  const name = phaseName(current.kind, current.sequence);
  switch (current.status) {
    case 'OPEN':
      return { title: `${name} is collecting responses`, detail: 'Voting closes at the deadline. Nudge anyone who has not responded, or lock early to calculate the result.' };
    case 'LOCKED':
      return { title: `${name} is locked`, detail: 'Responses are closed. Calculate the result to review it.' };
    case 'PENDING_APPROVAL':
      return { title: `${name} has a result to review`, detail: 'Check the tally and outcome, then approve it to publish. Nothing changes for players until it is published.' };
    case 'PENDING_HUNTER':
    case 'HUNTER_FINALIZING':
      return { title: `${name} is waiting on the Hunter`, detail: 'The Hunter has a window to take a final shot. Finalize once they have shot or the window closes.' };
    default:
      return null;
  }
}

/** Phase states where the moderator has something to do. Drives the dot on the Run game tab. */
export function runNeedsAttention(phaseStatus: string | undefined): boolean {
  return phaseStatus === 'LOCKED' || phaseStatus === 'PENDING_APPROVAL' || phaseStatus === 'PENDING_HUNTER' || phaseStatus === 'HUNTER_FINALIZING';
}

/** Event sources that mean something failed. The log also marks a moderator's own audited actions (stop, reset, PIN reset) as warnings; those are a record, not a problem. */
const PROBLEM_SOURCES = new Set(['EMAIL', 'AUTOMATION']);

/**
 * How many events in the log are real problems: an email batch that failed, or an automatic step that could not
 * run. With `since`, only those logged after it, so the badge on the Safety & records tab counts problems the
 * moderator has not looked at yet.
 */
export function attentionEventCount(events: ReadonlyArray<{ severity: string; source: string; createdAt?: string }>, since: string | null = null): number {
  return events.filter((event) => event.severity === 'WARNING' && PROBLEM_SOURCES.has(event.source) && (since === null || (event.createdAt ?? '') > since)).length;
}

/** When the newest problem in the log was recorded (ISO timestamps sort as text), or null if there is none. */
export function latestAttentionEventAt(events: ReadonlyArray<{ severity: string; source: string; createdAt: string }>): string | null {
  let latest: string | null = null;
  for (const event of events) {
    if (event.severity === 'WARNING' && PROBLEM_SOURCES.has(event.source) && (latest === null || event.createdAt > latest)) latest = event.createdAt;
  }
  return latest;
}

/** A tab the moderator picked, and the tab the console would have opened on when they picked it. */
export interface TabChoice {
  id: ConsoleTabId;
  /** Null for a tab chosen by a link, which holds whatever the game does. */
  forDefault: ConsoleTabId | null;
}

/**
 * The tab to show. A choice holds while the game stays on the same side of release; when it flips (a reset sends a
 * running game back to setup, a release starts one) the console goes to the tab that suits the new state.
 */
export function resolveConsoleTab(choice: TabChoice | null, defaultTab: ConsoleTabId): ConsoleTabId {
  return choice && (choice.forDefault === null || choice.forDefault === defaultTab) ? choice.id : defaultTab;
}
