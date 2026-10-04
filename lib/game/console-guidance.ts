import { MAX_PLAYERS, MIN_PLAYERS } from './player-count';
import { phaseName } from './timeline-view';

/**
 * How the moderator console is organised and what it tells a moderator to do
 * next. Pure and UI-free so the wording and the rules for which tab opens first
 * are unit-tested; nothing here changes a game rule.
 */

export const CONSOLE_TABS = [
  { id: 'setup', label: 'Setup', blurb: 'Schedule, roster, roles, and release. This is the one-time launch.' },
  { id: 'run', label: 'Run game', blurb: 'Open each phase, chase missing responses, lock, review, and publish.' },
  { id: 'people', label: 'People', blurb: 'Help a player back in, manage spectators, and share the game with co-moderators.' },
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
  return {
    schedule: gameCount ? 'done' : 'active',
    roster: seatCount ? 'done' : gameCount ? 'active' : 'todo',
    roles: hasBatch ? 'done' : seatCount ? 'active' : 'todo',
    release: released ? 'done' : hasBatch ? 'active' : 'todo',
  };
}

export type SetupStepKey = 'roster' | 'roles' | 'release';

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
export function setupHint(input: { status: string | undefined; seatCount: number; claimedCount: number; hasBatch: boolean; released: boolean }): ConsoleHint | null {
  const { status, seatCount, claimedCount, hasBatch, released } = input;
  if (status === 'COMPLETED') return { title: 'The game is over', detail: 'Download a JSON backup under Safety & records to keep a private record of it.' };
  if (status === 'STOPPED') return { title: 'This game was stopped', detail: 'Players can no longer act and the rooms are read-only. Download a backup under Safety & records, or start a new setup.' };
  if (!status || !['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW'].includes(status) || released) return null;
  if (!seatCount) return { title: 'Next: add your players', detail: `Paste a roster of ${MIN_PLAYERS} to ${MAX_PLAYERS} players under Import the roster. Each player gets their own private seat link.`, step: 'roster' };
  if (claimedCount < seatCount) {
    const waiting = seatCount - claimedCount;
    return { title: `Waiting for ${waiting} ${waiting === 1 ? 'player' : 'players'} to claim a seat`, detail: 'Email the invitations or send each person their own link. You can add or remove a player until you randomize roles.', step: 'roster' };
  }
  if (!hasBatch) return { title: 'Next: balance the roles', detail: 'Everyone has a seat. Check the role counts, save them, then randomize. Players see nothing until you release.', step: 'roles' };
  return { title: 'Next: review and release the roles', detail: 'The roles are randomized but still private. Releasing is permanent: it starts the game and locks setup.', step: 'release' };
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

/** How many events in the log are real problems: an email batch that failed, or an automatic step that could not run. Drives the badge on the Safety & records tab. */
export function attentionEventCount(events: ReadonlyArray<{ severity: string; source: string }>): number {
  return events.filter((event) => event.severity === 'WARNING' && PROBLEM_SOURCES.has(event.source)).length;
}
