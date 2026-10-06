'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- the public entry links intentionally use full-page navigation. */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import GameSettingsFields from './game-settings-fields';
import { useRouter } from 'next/navigation';
import LiveGamePanel from './live-game-panel';
import { ConsoleNavigation, ConsolePanel } from './console-tabs';
import { OperationsProvider } from './operations-context';
import ApplicationsPanel from './applications-panel';
import { Announcements, BackupControls, ChatRooms, CoModeratorAccess, EventLog, FailSafeControls, FeedbackSection, HealthStrip, PlayerAccessRecovery, RestoredInvites } from './ops-sections';
import PlayerChoicesPanel from './player-choices-panel';
import SignupsPanel, { type AcceptedSignups } from './signups-panel';
import SpectatorsPanel from './spectators-panel';
import StatsPanel from './stats-panel';
import { shouldRefreshOperations } from '../../lib/game/operations-refresh';
import { defaultConsoleTab, isConsoleTabId, launchChecklist, resolveConsoleTab, rosterCountsNote, setupHint, waitingBadges, type ConsoleTabId, type SetupStepKey, type TabChoice } from '../../lib/game/console-guidance';
import { ROLE_CATALOG } from '../../lib/game/catalog';
import { ROLE_KEYS, type RoleKey } from '../../lib/game/types';
import type { EliminationSchedule } from '../../lib/game/elimination-schedule';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../lib/game/player-count';
import BrandHeader from './brand-header';
import { pollWhileVisible } from '../../lib/http/poll-while-visible';
import { conditionalGet, responseEtag } from '../../lib/http/conditional-get';
import { RELAXED_POLL_MS } from '../../lib/http/poll-interval';
import { createInviteExport } from '../../lib/roster/csv';

const sampleRoster = [
  'display_name,email',
  ...Array.from({ length: 20 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return `Player ${number},player${number}@example.test`;
  }),
].join('\n');

const roleOrder = ROLE_KEYS;
/** Where each setup step lives on the Setup tab, and what the "next step" note calls the button that jumps there. */
const SETUP_STEP_SECTIONS: Record<SetupStepKey, { id: string; label: string }> = {
  signups: { id: 'setup-signups', label: 'Go to sign-ups' },
  roster: { id: 'setup-roster', label: 'Go to the roster' },
  roles: { id: 'setup-roles', label: 'Go to the roles' },
  release: { id: 'setup-release', label: 'Go to release' },
};
const weekdayOptions = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
] as const;
type Composition = Record<RoleKey, number>;

function dateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultGameDates() {
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  const daysUntilNextMonday = ((8 - start.getDay()) % 7) || 7;
  start.setDate(start.getDate() + daysUntilNextMonday);
  const end = new Date(start);
  end.setDate(end.getDate() + 25);
  const cutoffDate = dateInput(end);
  return { start: dateInput(start), end: cutoffDate, cutoff: `${cutoffDate}T16:00` };
}

interface GameSummary {
  id: string;
  name: string;
  status: string;
  timezone: string;
  startDate: string;
  endDate: string;
  finalCutoffAt: string;
  finalCutoffLocal: string;
  activeWeekdays: number[];
  schedule: { dayCloses?: string; nightCloses?: string };
  hunterWindowMinutes?: number;
  dayDivisor?: number;
  nightDivisor?: number;
  eliminationSchedule?: EliminationSchedule | null;
  publicationMode?: 'REVIEW' | 'AUTOMATIC';
  reviewWindowMinutes?: number;
  automationPaused?: boolean;
  moderatorRole?: string;
}

interface RosterSeat {
  id: string;
  displayName: string;
  email: string;
  status: string;
  invitationEmailedAt?: string | null;
}

interface InviteRow {
  displayName: string;
  email: string;
  claimUrl: string;
  inviteCode: string;
}

interface RosterChange {
  playerCount: number;
  composition: Composition;
  resetToPreset: boolean;
}

interface InviteEmailResult {
  seatId: string;
  displayName: string;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  reason?: string;
}

interface Batch {
  id: string;
  revision: number;
  randomEvidenceHash: string;
  releasedAt: string | null;
  assignments: Array<{ seatId: string; role: RoleKey }>;
}

const SETUP_STATUSES = new Set(['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW']);

class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown>) {
    super(message);
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  const data = (await response.json()) as T & { error?: string; errors?: string[] };
  if (!response.ok) throw new RequestError(data.error ?? data.errors?.join(' ') ?? 'Request failed.', response.status, data as Record<string, unknown>);
  return data;
}

/** What the console's refresh knows about sign-ups: counts and whether the link is live, not the list itself. */
interface SignupSummary {
  state: 'NOT_OPEN' | 'OPEN' | 'CLOSED';
  live: boolean;
  pending: number;
  accepted: number;
  applicationsOpen: boolean;
  pendingApplications: number;
}

interface SelectedGameSetup {
  gameId: string;
  roster: { roster: RosterSeat[]; emailConfigured?: boolean; signups?: SignupSummary };
  assignments: { composition: Composition; batches: Batch[]; game?: { status: string } };
}

export default function ModeratorPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [gameId, setGameId] = useState('');
  const [roster, setRoster] = useState<RosterSeat[]>([]);
  const [composition, setComposition] = useState<Composition | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  // Private links from this session's import and single-player adds, kept only in memory.
  const [inviteRows, setInviteRows] = useState<InviteRow[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [signupSummary, setSignupSummary] = useState<SignupSummary | null>(null);
  const [emailingInvites, setEmailingInvites] = useState(false);
  const [editingRoster, setEditingRoster] = useState(false);
  const [addedInvite, setAddedInvite] = useState<{ gameId: string; seatId: string; displayName: string; claimUrl: string } | null>(null);
  const [message, setMessage] = useState('');
  const clearMessage = useCallback(() => setMessage(''), []);
  const [error, setError] = useState('');
  const clearPageNotices = useCallback(() => { setMessage(''); setError(''); }, []);
  const [liveRefreshToken, setLiveRefreshToken] = useState(0);
  const [showNewGameForm, setShowNewGameForm] = useState(false);
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  const [compositionDraftIds, setCompositionDraftIds] = useState<Set<string>>(() => new Set());
  // The tab the moderator picked; until they pick one, the console opens on Setup or Run game by the game's status.
  const [selectedTab, setSelectedTab] = useState<TabChoice | null>(null);
  // A result or follow-up is waiting on the moderator, reported by the live game panel, so the Run game tab can say so.
  const [runAttention, setRunAttention] = useState(false);
  const selectedGameRef = useRef('');
  const gamesRequest = useRef(0);
  const gameDetailRequest = useRef(0);
  // The ETag of the games list and setup on screen (lib/http/conditional-get.ts).
  // It names the data, not the URL: the first load (no ?gameId=) and the polls
  // that follow (with it) return the same body, so they share one tag.
  const gamesEtag = useRef<string | null>(null);
  const compositionDrafts = useRef(new Map<string, Composition>());

  function markCompositionDraft(selectedGameId: string, draft: Composition | null) {
    if (draft) compositionDrafts.current.set(selectedGameId, draft);
    else compositionDrafts.current.delete(selectedGameId);
    setCompositionDraftIds((current) => {
      const next = new Set(current);
      if (draft) next.add(selectedGameId);
      else next.delete(selectedGameId);
      return next;
    });
  }

  const applyGameSetup = useCallback((selectedGameId: string, rosterData: SelectedGameSetup['roster'], assignmentData: SelectedGameSetup['assignments']) => {
    setRoster(rosterData.roster);
    setEmailConfigured(Boolean(rosterData.emailConfigured));
    setSignupSummary(rosterData.signups ?? null);
    setComposition(compositionDrafts.current.get(selectedGameId) ?? assignmentData.composition);
    setBatches(assignmentData.batches);
    if (assignmentData.game?.status) {
      setGames((current) => current.map((game) => game.id === selectedGameId ? { ...game, status: assignmentData.game?.status ?? game.status } : game));
    }
  }, []);

  const loadGame = useCallback(async (selectedGameId: string) => {
    const requestId = ++gameDetailRequest.current;
    const [rosterData, assignmentData] = await Promise.all([
      requestJson<SelectedGameSetup['roster']>(`/api/games/${selectedGameId}/roster`),
      requestJson<SelectedGameSetup['assignments']>(`/api/games/${selectedGameId}/assignments`),
    ]);
    if (requestId !== gameDetailRequest.current || selectedGameRef.current !== selectedGameId) return;
    applyGameSetup(selectedGameId, rosterData, assignmentData);
  }, [applyGameSetup]);

  // One request: the games list carries the selected game's roster and assignments.
  const loadGames = useCallback(async (preferredGameId = selectedGameRef.current) => {
    const requestId = ++gamesRequest.current;
    const detailRequestId = ++gameDetailRequest.current;
    const query = preferredGameId ? `?gameId=${encodeURIComponent(preferredGameId)}` : '';
    const response = await conditionalGet(`/api/games${query}`, gamesEtag.current);
    // null: nothing changed since what is on screen.
    if (!response) return;
    const data = (await response.json()) as { games: GameSummary[]; selected: SelectedGameSetup | null; error?: string };
    if (!response.ok) throw new RequestError(data.error ?? 'Request failed.', response.status, data as unknown as Record<string, unknown>);
    if (requestId !== gamesRequest.current) return;
    setAuthenticated(true);
    setGames(data.games);
    const selected = data.selected;
    if (selected) {
      selectedGameRef.current = selected.gameId;
      setGameId(selected.gameId);
      // A game switch that started after this request wins.
      const applied = detailRequestId === gameDetailRequest.current;
      if (applied) applyGameSetup(selected.gameId, selected.roster, selected.assignments);
      gamesEtag.current = applied ? responseEtag(response) : null;
    } else {
      gamesEtag.current = responseEtag(response);
      selectedGameRef.current = '';
      setGameId('');
      setRoster([]);
      setSignupSummary(null);
      setComposition(null);
      setBatches([]);
    }
  }, [applyGameSetup]);

  const handleLiveChange = useCallback((action?: string) => {
    if (shouldRefreshOperations(action)) setLiveRefreshToken((token) => token + 1);
    void loadGames(gameId).catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to refresh the game.'));
  }, [gameId, loadGames]);

  useEffect(() => {
    void (async () => {
      try {
        await loadGames();
        // A link such as /moderator#messages opens that tab.
        const linked = window.location.hash.slice(1);
        if (isConsoleTabId(linked)) setSelectedTab({ id: linked, forDefault: null });
      } catch (caught) {
        // Signed out: the 401 also says whether the first moderator account still has to be created.
        setNeedsBootstrap(caught instanceof RequestError && caught.body.needsBootstrap === true);
        setAuthenticated(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadGames]);

  // A link to another tab, such as /moderator#messages, also works while the console is already open.
  useEffect(() => {
    const openLinkedTab = () => {
      const linked = window.location.hash.slice(1);
      if (isConsoleTabId(linked)) setSelectedTab({ id: linked, forDefault: null });
    };
    window.addEventListener('hashchange', openLinkedTab);
    return () => window.removeEventListener('hashchange', openLinkedTab);
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    // The live game panel keeps its own, faster pace near deadlines.
    return pollWhileVisible(() => {
      void loadGames(gameId).catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to refresh the game.'));
    }, RELAXED_POLL_MS);
  }, [authenticated, gameId, loadGames]);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const data = await requestJson<{ recoveryCodes?: string[] }>(recoveryMode ? '/api/moderators/recover' : '/api/moderators/login', {
        method: 'POST',
        body: JSON.stringify(recoveryMode
          ? { email: form.get('email'), recoveryCode: form.get('recoveryCode'), newPassword: form.get('newPassword') }
          : { email: form.get('email'), password: form.get('password') }),
      });
      setRecoveryCodes(data.recoveryCodes ?? []);
      setNeedsBootstrap(false);
      setRecoveryMode(false);
      setMessage(recoveryMode ? 'Moderator password recovered. All previous moderator sessions were invalidated.' : '');
      await loadGames();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in.');
    }
  }

  async function createGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const data = await requestJson<{ gameId: string }>('/api/games', {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          timezone: form.get('timezone'),
          startDate: form.get('startDate'),
          endDate: form.get('endDate'),
          finalCutoffAt: form.get('finalCutoffAt'),
          activeWeekdays: form.getAll('activeWeekdays').map(Number),
          schedule: { dayCloses: form.get('dayCloses'), nightCloses: form.get('nightCloses') },
          hunterWindowHours: form.get('hunterWindowHours'),
          dayDivisor: form.get('dayDivisor'),
          nightDivisor: form.get('nightDivisor'),
          // Empty clears the schedule; a missing field (a disabled form) leaves it unchanged.
          eliminationSchedule: form.get('eliminationSchedule') ?? undefined,
          publicationMode: form.get('publicationMode'),
          reviewWindowMinutes: form.get('reviewWindowMinutes'),
        }),
      });
      setMessage('Game created. Import the player roster next.');
      setInviteRows([]);
      setShowNewGameForm(false);
      setShowSchedulePanel(false);
      setSelectedTab(null);
      await loadGames(data.gameId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create the game.');
    }
  }

  function selectGame(nextGameId: string) {
    if (!nextGameId) return;
    setShowNewGameForm(false);
    setShowSchedulePanel(false);
    setSelectedTab(null);
    setInviteRows([]);
    setMessage('');
    setError('');
    selectedGameRef.current = nextGameId;
    void loadGames(nextGameId).catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load the selected game.'));
  }

  function startNewSetup() {
    setShowNewGameForm(true);
    setShowSchedulePanel(false);
    setError('');
    setMessage('');
    setInviteRows([]);
  }

  function openGameSchedule() {
    setError('');
    setMessage('');
    if (!selectedGame) {
      setShowNewGameForm(true);
      setShowSchedulePanel(false);
    } else {
      setShowNewGameForm(false);
      setShowSchedulePanel(true);
      chooseTab('setup');
    }
    window.setTimeout(() => document.getElementById('game-schedule')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  /** Picks a tab. It holds until the game flips between setup and running, when the console goes to the tab that suits it. */
  function chooseTab(id: ConsoleTabId) {
    setSelectedTab({ id, forDefault: defaultConsoleTab(selectedGame?.status, Boolean(batches[0]?.releasedAt)) });
  }

  /** Jumps to a step of the launch checklist on the Setup tab. */
  function goToSetupStep(sectionId: string) {
    setShowNewGameForm(false);
    chooseTab('setup');
    window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  async function updateSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGame || !setupEditable) return;
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await requestJson(`/api/games/${gameId}/schedule`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.get('name'),
          timezone: form.get('timezone'),
          startDate: form.get('startDate'),
          endDate: form.get('endDate'),
          finalCutoffAt: form.get('finalCutoffAt'),
          activeWeekdays: form.getAll('activeWeekdays').map(Number),
          schedule: { dayCloses: form.get('dayCloses'), nightCloses: form.get('nightCloses') },
          hunterWindowHours: form.get('hunterWindowHours'),
          dayDivisor: form.get('dayDivisor'),
          nightDivisor: form.get('nightDivisor'),
          // Empty clears the schedule; a missing field (a disabled form) leaves it unchanged.
          eliminationSchedule: form.get('eliminationSchedule') ?? undefined,
          publicationMode: form.get('publicationMode'),
          reviewWindowMinutes: form.get('reviewWindowMinutes'),
        }),
      });
      setMessage('Game schedule updated. The launch checklist is ready to continue.');
      await loadGames(gameId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update the game schedule.');
    }
  }

  async function cancelSetup() {
    if (!selectedGame) return;
    if (!window.confirm(`Cancel “${selectedGame.name}” and start a new setup? This permanently cancels the unfinished setup, invalidates all invite links and player sessions for it, and retains its audit history.`)) return;
    setError('');
    try {
      await requestJson(`/api/games/${gameId}/operations`, {
        method: 'POST',
        body: JSON.stringify({ action: 'CANCEL_SETUP', confirmed: true, confirmationName: selectedGame.name }),
      });
      markCompositionDraft(gameId, null);
      setInviteRows([]);
      setRoster([]);
      setComposition(null);
      setBatches([]);
      setShowNewGameForm(true);
      setMessage('The unfinished setup was cancelled. Its invite links and player sessions are invalid, and its audit history remains available.');
      await loadGames(gameId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to cancel the setup.');
    }
  }

  /**
   * Imports the pasted list. With people already on the roster it is added to them (ADD): everyone
   * there keeps their seat and link. The separate Replace button starts the roster over (REPLACE).
   */
  async function importRoster(form: HTMLFormElement, mode: 'ADD' | 'REPLACE') {
    if (editingRoster) return;
    const editedGame = gameId;
    const csv = new FormData(form).get('csv');
    setError('');
    // The box starts with an example list. Adding it to a real roster would put twenty made-up players on it.
    if (mode === 'ADD' && String(csv ?? '').trim() === sampleRoster.trim()) {
      setError('The list in the box is only an example. Paste your own players there first, then add them.');
      return;
    }
    setEditingRoster(true);
    try {
      const data = await requestJson<RosterChange & { invites: InviteRow[]; added?: number; skipped?: number }>(
        `/api/games/${editedGame}/roster`,
        // A replace says how many players this page is showing, so it is refused if someone else has changed the roster since.
        { method: 'POST', body: JSON.stringify({ csv, mode, expectedSeatCount: mode === 'REPLACE' ? roster.length : undefined }) },
      );
      if (selectedGameRef.current !== editedGame) return;
      markCompositionDraft(editedGame, null);
      setComposition(data.composition);
      if (mode === 'ADD') {
        const added = data.added ?? data.invites.length;
        const skipped = data.skipped ?? 0;
        // Links are shown once, so keep them with any from people accepted earlier in this visit.
        setInviteRows((current) => [...current, ...data.invites]);
        const counts = rosterCountsNote({ playerCount: data.playerCount, resetToPreset: data.resetToPreset, villagers: data.composition.VILLAGER });
        setMessage(`${added} ${added === 1 ? 'player was' : 'players were'} added to the roster${skipped ? `; ${skipped} already on it ${skipped === 1 ? 'was' : 'were'} left as they are` : ''}. ${counts} Email their invitations below, or download the invite file now; the links are not shown again.`);
      } else {
        setInviteRows(data.invites);
        setMessage(`${data.playerCount} private seats created. Email the invitations below, or download the invite file now; codes are not shown again.`);
      }
    } catch (caught) {
      if (selectedGameRef.current === editedGame) setError(caught instanceof Error ? caught.message : 'Unable to import the roster.');
    } finally {
      setEditingRoster(false);
      if (selectedGameRef.current === editedGame) await loadGame(editedGame).catch(() => {});
    }
  }

  function replaceRoster(form: HTMLFormElement | null) {
    if (!form || editingRoster) return;
    const accepted = signupSummary?.accepted ?? 0;
    const fromSignups = accepted > 0 ? ` That includes the ${accepted} ${accepted === 1 ? 'person' : 'people'} you accepted from sign-ups; they go back to waiting, and you can accept them again.` : '';
    if (!window.confirm(`Replace the whole roster with this list? Everyone on the roster now is removed and every invitation link already sent stops working.${fromSignups} Anyone who already claimed a seat must claim again.`)) return;
    void importRoster(form, 'REPLACE');
  }

  function rosterChangeMessage(summary: string, data: RosterChange) {
    const counts = data.resetToPreset
      ? `Role counts were reset to the standard preset for ${data.playerCount} players.`
      : `Role counts now have ${data.composition.VILLAGER} ${data.composition.VILLAGER === 1 ? 'Villager' : 'Villagers'}; other roles are unchanged.`;
    return `${summary} The roster now has ${data.playerCount} players. ${counts}`;
  }

  async function addSeat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editingRoster) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const editedGame = gameId;
    setError('');
    setMessage('');
    setEditingRoster(true);
    try {
      const data = await requestJson<RosterChange & { seat: RosterSeat; claimUrl: string; inviteCode: string }>(`/api/games/${editedGame}/seats`, {
        method: 'POST',
        body: JSON.stringify({ displayName: form.get('displayName'), email: form.get('email') }),
      });
      if (selectedGameRef.current !== editedGame) return;
      formElement.reset();
      markCompositionDraft(editedGame, null);
      setComposition(data.composition);
      setInviteRows((current) => [...current, { displayName: data.seat.displayName, email: data.seat.email, claimUrl: data.claimUrl, inviteCode: data.inviteCode }]);
      setAddedInvite({ gameId: editedGame, seatId: data.seat.id, displayName: data.seat.displayName, claimUrl: data.claimUrl });
      setMessage(rosterChangeMessage(`${data.seat.displayName} was added.`, data));
    } catch (caught) {
      if (selectedGameRef.current === editedGame) setError(caught instanceof Error ? caught.message : 'Unable to add the player.');
    } finally {
      setEditingRoster(false);
      if (selectedGameRef.current === editedGame) await loadGame(editedGame).catch(() => {});
    }
  }

  async function removeSeat(seat: RosterSeat) {
    if (editingRoster) return;
    if (!window.confirm(`Remove ${seat.displayName} from the roster? Their invitation link stops working. You can add them again later.`)) return;
    const editedGame = gameId;
    setError('');
    setMessage('');
    setEditingRoster(true);
    try {
      const data = await requestJson<RosterChange>(`/api/games/${editedGame}/seats/${encodeURIComponent(seat.id)}`, { method: 'DELETE' });
      if (selectedGameRef.current !== editedGame) return;
      markCompositionDraft(editedGame, null);
      setComposition(data.composition);
      setAddedInvite((current) => current?.seatId === seat.id ? null : current);
      setInviteRows((current) => current.filter((row) => row.email !== seat.email));
      setMessage(rosterChangeMessage(`${seat.displayName} was removed.`, data));
    } catch (caught) {
      if (selectedGameRef.current === editedGame) setError(caught instanceof Error ? caught.message : 'Unable to remove the player.');
    } finally {
      setEditingRoster(false);
      if (selectedGameRef.current === editedGame) await loadGame(editedGame).catch(() => {});
    }
  }

  /** People accepted from the sign-up list are now seats; keep their private links for the invite file and show the new role counts. */
  function signupsAccepted(result: AcceptedSignups) {
    const acceptedFor = gameId;
    // The moderator moved to another game while the accept was in flight: its seats and counts are not this game's.
    if (selectedGameRef.current !== acceptedFor) return;
    markCompositionDraft(acceptedFor, null);
    setComposition(result.composition);
    setInviteRows((current) => [...current, ...result.invites]);
    void loadGame(acceptedFor).catch(() => {});
  }

  async function copyAddedInvite() {
    if (!addedInvite) return;
    try {
      await navigator.clipboard.writeText(addedInvite.claimUrl);
      setMessage(`Copied ${addedInvite.displayName}’s private link. Send it only to them.`);
    } catch {
      setError('Copy failed. Select the link and copy it by hand.');
    }
  }

  async function emailInvites(seats: RosterSeat[]) {
    if (!seats.length || emailingInvites) return;
    if (seats.length > 1 && !window.confirm(`Email a new private link to ${seats.length} players who haven’t claimed a seat? Any earlier link for them, including the invite CSV, stops working.`)) return;
    setError('');
    setMessage('');
    setEmailingInvites(true);
    // A send can take a while; the result belongs only to the game it came from.
    const sentFrom = gameId;
    const stillOnGame = () => selectedGameRef.current === sentFrom;
    try {
      const data = await requestJson<{ sent: number; results: InviteEmailResult[] }>(`/api/games/${sentFrom}/invites`, {
        method: 'POST',
        body: JSON.stringify({ seatIds: seats.map((seat) => seat.id) }),
      });
      if (!stillOnGame()) return;
      // Emailed links replace the ones in the downloaded file. Skipped test
      // addresses keep their links, so the file stays valid if nothing else changed.
      if (data.results.some((result) => result.status !== 'SKIPPED')) setInviteRows([]);
      setAddedInvite((current) => data.results.some((result) => result.seatId === current?.seatId && result.status !== 'SKIPPED') ? null : current);
      // Reserved test addresses are skipped by design, so they are a note, not an error.
      const failed = data.results.filter((result) => result.status === 'FAILED');
      const skipped = data.results.filter((result) => result.status === 'SKIPPED').length;
      setMessage(`Emailed ${data.sent} of ${data.results.length} ${data.results.length === 1 ? 'player' : 'players'}.${skipped ? ` Skipped ${skipped} test ${skipped === 1 ? 'address' : 'addresses'}, which can’t receive mail.` : ''}`);
      if (failed.length) setError(`Not sent: ${failed.map((result) => `${result.displayName} (${result.reason ?? 'not sent'})`).join('; ')}`);
    } catch (caught) {
      if (stillOnGame()) setError(caught instanceof Error ? caught.message : 'Unable to email invitations.');
    } finally {
      setEmailingInvites(false);
      if (stillOnGame()) await loadGame(sentFrom).catch(() => {});
    }
  }

  async function saveComposition() {
    if (!composition) return;
    setError('');
    try {
      await requestJson(`/api/games/${gameId}/assignments`, {
        method: 'POST',
        body: JSON.stringify({ action: 'SAVE_COMPOSITION', composition }),
      });
      markCompositionDraft(gameId, null);
      setMessage('Role composition saved and logged.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save role counts.');
    }
  }

  async function previewAssignments() {
    setError('');
    try {
      await requestJson(`/api/games/${gameId}/assignments`, {
        method: 'POST',
        body: JSON.stringify({ action: 'PREVIEW' }),
      });
      setMessage('A new cryptographically randomized assignment batch is ready for review.');
      await loadGame(gameId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to randomize roles.');
    }
  }

  async function releaseAssignments(batchId: string) {
    if (!window.confirm('Release roles? Every player will see their role, and this can’t be undone.')) return;
    setError('');
    try {
      await requestJson(`/api/games/${gameId}/assignments`, {
        method: 'POST',
        body: JSON.stringify({ action: 'RELEASE', batchId }),
      });
      setMessage('Roles released. Each player can now see only their own role.');
      chooseTab('run');
      await loadGames();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to release roles.');
    }
  }

  async function signOut() {
    await fetch('/api/moderators/logout', { method: 'POST' });
    router.push('/moderator');
  }

  function downloadInvites() {
    const url = URL.createObjectURL(new Blob([createInviteExport(inviteRows)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'watercooler-werewolf-invites.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const selectedGame = games.find((game) => game.id === gameId);
  const setupEditable = Boolean(selectedGame && SETUP_STATUSES.has(selectedGame.status));
  const canCancelSetup = setupEditable && selectedGame?.moderatorRole === 'OWNER';
  const claimed = roster.filter((seat) => seat.status === 'CLAIMED').length;
  const unclaimed = roster.filter((seat) => seat.status === 'INVITED');
  // Single-seat edits close once roles are randomized (see lib/game/roster-edit.ts).
  const rosterEditable = Boolean(selectedGame && ['DRAFT', 'REGISTRATION'].includes(selectedGame.status) && roster.length > 0);
  const shownInvite = addedInvite?.gameId === gameId && unclaimed.some((seat) => seat.id === addedInvite.seatId) ? addedInvite : null;
  const latestBatch = batches[0];
  const rosterById = useMemo(() => new Map(roster.map((seat) => [seat.id, seat])), [roster]);
  const gameDates = useMemo(() => defaultGameDates(), []);
  const released = Boolean(latestBatch?.releasedAt);
  const activeTab = resolveConsoleTab(selectedTab, defaultConsoleTab(selectedGame?.status, released));
  const checklist = launchChecklist({ gameCount: games.length, seatCount: roster.length, claimedCount: claimed, hasBatch: Boolean(latestBatch), released });
  const hint = setupHint({ status: selectedGame?.status, seatCount: roster.length, claimedCount: claimed, hasBatch: Boolean(latestBatch), released, pendingSignups: signupSummary?.pending ?? 0, signupsOpen: signupSummary?.live ?? false });
  const waiting = waitingBadges({ pendingSignups: signupSummary?.pending ?? 0, pendingApplications: signupSummary?.pendingApplications ?? 0, setupEditable, isOwner: selectedGame?.moderatorRole === 'OWNER' });
  const balanceScore = composition
    ? composition.VILLAGER - composition.WEREWOLF * 5 + composition.SEER * 3 + composition.BODYGUARD * 2 + composition.HUNTER + composition.MASON + composition.APPRENTICE_SEER * 2 + composition.MAYOR * 2 + composition.CUPID
    : 0;

  if (loading) return <main className="setup-shell backstage"><BrandHeader /><p className="setup-loading">Opening the moderator console…</p></main>;

  if (!authenticated) {
    return (
      <main className="setup-shell backstage">
        <BrandHeader />
        <section className="auth-card">
          <p className="eyebrow accent">Private game control</p>
          <h1>{needsBootstrap ? 'Owner setup required' : recoveryMode ? 'Recover moderator access' : 'Moderator sign-in'}</h1>
          <p>{needsBootstrap ? 'Create the first moderator once from a trusted operator machine, then return here to sign in.' : recoveryMode ? 'Use one unused recovery code to choose a new password. Previous moderator sessions will be signed out.' : 'Sign in to resume setup or run an active game.'}</p>
          {needsBootstrap ? (
            <div className="form-stack">
              <p className="notice warning">Public account creation is disabled. On the server or a trusted operator machine, configure <code>WATERCOOLER_OWNER_EMAIL</code> and run <code>npm run owner:bootstrap</code>. The command prompts for the password without echoing it and displays recovery codes once.</p>
              <p className="field-help">After the command succeeds, reload this page to sign in with the app-owned moderator credentials.</p>
            </div>
          ) : <form className="form-stack" onSubmit={handleAuth}>
            <label>Email<input name="email" type="email" autoComplete="email" required /></label>
            {recoveryMode ? <><label>One-time recovery code<input name="recoveryCode" autoComplete="one-time-code" required /></label><label>New moderator password<input name="newPassword" type="password" minLength={12} autoComplete="new-password" required /></label></> : <label>Password<input name="password" type="password" minLength={needsBootstrap ? 12 : undefined} autoComplete={needsBootstrap ? 'new-password' : 'current-password'} required /></label>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit">{needsBootstrap ? 'Create moderator' : recoveryMode ? 'Recover access' : 'Sign in'}</button>
            {!needsBootstrap && <button className="text-button" type="button" onClick={() => { setRecoveryMode((current) => !current); setError(''); }}>{recoveryMode ? 'Back to sign in' : 'Forgot password? Use a recovery code'}</button>}
          </form>}
        </section>
      </main>
    );
  }

  return (
    <main className="setup-shell backstage">
      <BrandHeader />
      <div className="console-layout">
        <aside className={`setup-progress${checklist.release === 'done' ? ' launched' : ''}`}>
          <p className="eyebrow">Launch checklist</p>
          {checklist.release === 'done' && <p className="launch-complete">All four launch steps are done.</p>}
          <ol>
            <li className={`${checklist.schedule} ${showSchedulePanel || showNewGameForm ? 'reviewing' : ''}`}><button className="checklist-step" type="button" onClick={openGameSchedule} aria-controls="game-schedule"><span>1</span><div><strong>Game schedule</strong><small>Open timezone and cadence</small></div></button></li>
            <li className={checklist.roster}><button className="checklist-step" type="button" onClick={() => goToSetupStep('setup-roster')} disabled={!selectedGame}><span>2</span><div><strong>Player roster</strong><small>Minimum {MIN_PLAYERS} · up to {MAX_PLAYERS} private seats</small></div></button></li>
            <li className={checklist.roles}><button className="checklist-step" type="button" onClick={() => goToSetupStep(setupEditable && composition ? 'setup-roles' : 'setup-release')} disabled={!latestBatch && !(setupEditable && composition)}><span>3</span><div><strong>Role balance</strong><small>Compose and randomize</small></div></button></li>
            <li className={checklist.release}><button className="checklist-step" type="button" onClick={() => goToSetupStep('setup-release')} disabled={!latestBatch}><span>4</span><div><strong>Release roles</strong><small>Irreversible launch</small></div></button></li>
          </ol>
          <nav className="console-links" aria-label="Moderator links">
            <a className="quiet-link" href="/guide#moderators" target="_blank" rel="noopener noreferrer">Moderator guide →<span className="sr-only"> (opens in a new tab)</span></a>
            <a className="quiet-link" href="/">View current player session →</a>
            <a className="quiet-link" href="/moderator/player-preview">Open Player View Studio →</a>
          </nav>
        </aside>

        <section className="console-main">
          <div className="console-title">
            <div><p className="eyebrow accent">Office campaign</p><h1>{selectedGame?.name ?? 'Set up a new game'}</h1></div>
            <div className="console-title-actions">{selectedGame && <span className="status-pill">{selectedGame.status.replaceAll('_', ' ')}</span>}</div>
          </div>
          <div className={`game-bar${games.length ? '' : ' bare'}`}>
            {games.length > 0 && (
              <label className="game-selector-label">Selected game
                <select aria-label="Selected game" value={gameId} onChange={(event) => selectGame(event.target.value)}>
                  {games.map((game) => <option key={game.id} value={game.id}>{game.name} · {game.status.replaceAll('_', ' ')}</option>)}
                </select>
              </label>
            )}
            <div className="game-bar-actions">
              {showNewGameForm && games.length > 0 && <button className="secondary-button" type="button" onClick={() => setShowNewGameForm(false)}>Back to selected game</button>}
              <button className="secondary-button" type="button" onClick={startNewSetup}>Start new setup</button>
              <button className="text-button" type="button" onClick={signOut}>Sign out</button>
            </div>
          </div>
          {/* With a game open the result is pinned under the tab bar; without one (the new-game form, the welcome page) there is no tab bar, so it is shown here. */}
          {(!games.length || showNewGameForm) && <>
            {error && <p className="notice error" role="alert">{error}</p>}
            {message && <p className="notice success" role="status">{message}</p>}
          </>}
          {recoveryCodes.length > 0 && (
            <div className="notice warning"><strong>Save these one-time recovery codes now:</strong><code>{recoveryCodes.join(' · ')}</code></div>
          )}
          {hint && games.length > 0 && !showNewGameForm && <section className="next-step page-next-step" aria-label="Next step"><div><strong>{hint.title}</strong> {hint.detail}</div>{hint.step && <button className="secondary-button" type="button" onClick={() => goToSetupStep(SETUP_STEP_SECTIONS[hint.step!].id)}>{SETUP_STEP_SECTIONS[hint.step].label}</button>}</section>}

          {!games.length && (
            <section className="setup-card welcome-card" aria-labelledby="console-welcome-title">
              <div className="setup-card-heading"><span aria-hidden="true">★</span><div><h2 id="console-welcome-title">Welcome, moderator</h2><p>You run the game but don’t play it, so this console shows every role. A game has three parts.</p></div></div>
              <ol className="welcome-steps">
                <li><strong>Set up.</strong> Choose the dates and rules below, add your players (import a list, let them sign up from a link, or both), balance the roles, then release them. Use the launch checklist beside this page to see where you are.</li>
                <li><strong>Run.</strong> Each Day and Night: open a phase, nudge anyone who hasn’t responded, lock it, check the result, and publish it. Or let the app publish for you.</li>
                <li><strong>Look after people.</strong> Reset a forgotten PIN, announce news, add spectators, and keep an eye on the chat.</li>
              </ol>
              <p className="field-help">New to this? <a href="/guide#moderators" target="_blank" rel="noopener noreferrer">Read the moderator guide<span className="sr-only"> (opens in a new tab)</span></a>, or open <a href="/moderator/player-preview">Player View Studio</a> to see what your players will see.</p>
            </section>
          )}

          {!games.length || showNewGameForm ? (
            <section className="setup-card" id="game-schedule">
              <div className="setup-card-heading"><span>01</span><div><h2>Schedule the campaign</h2><p>Weekday phases keep the game lively without disrupting work.</p></div></div>
              <form className="setup-grid" onSubmit={createGame}>
                <label className="wide">Game name<input name="name" defaultValue="Office Werewolf Campaign" required /></label>
                <label>Timezone<input name="timezone" defaultValue="America/Regina" required /></label>
                <label>Start date<input name="startDate" type="date" defaultValue={gameDates.start} required /></label>
                <label>End date<input name="endDate" type="date" defaultValue={gameDates.end} required /></label>
                <label>Final cutoff<input name="finalCutoffAt" type="datetime-local" defaultValue={gameDates.cutoff} required /></label>
                <label>Day ballot closes<input name="dayCloses" type="time" defaultValue="16:00" required /></label>
                <label>Night actions close<input name="nightCloses" type="time" defaultValue="09:00" required /></label>
                <fieldset className="weekday-picker wide"><legend>Active weekdays</legend><div>{weekdayOptions.map((day) => <label key={day.value}><input name="activeWeekdays" type="checkbox" value={day.value} defaultChecked={[1, 2, 3, 4, 5].includes(day.value)} />{day.label}</label>)}</div></fieldset>
                <GameSettingsFields />
                <button className="primary-button" type="submit">Create game</button>
              </form>
            </section>
          ) : (
            <OperationsProvider key={`operations-${gameId}`} gameId={gameId} refreshToken={liveRefreshToken} onGameChanged={handleLiveChange}>
              <ConsoleNavigation active={activeTab} onSelect={chooseTab} runAttention={runAttention} waiting={waiting} notices={{ error, message, clearMessage, clearAll: clearPageNotices }} />

              <ConsolePanel id="setup" active={activeTab === 'setup'}>
              {activeTab === 'setup' && <RestoredInvites />}
              {showSchedulePanel && selectedGame && <section className="setup-card" id="game-schedule">
                <div className="setup-card-heading"><span>01</span><div><h2>Game schedule</h2><p>{setupEditable ? 'Review or update the setup details, then continue where you left off.' : 'Review the launch schedule. It becomes read-only after roles are released.'}</p></div></div>
                <form className="setup-grid" key={`schedule-${selectedGame.id}-${selectedGame.finalCutoffAt}-${selectedGame.hunterWindowMinutes}-${selectedGame.dayDivisor}-${selectedGame.nightDivisor}-${JSON.stringify(selectedGame.eliminationSchedule ?? null)}-${selectedGame.publicationMode}-${selectedGame.reviewWindowMinutes}`} onSubmit={updateSchedule}>
                  <label className="wide">Game name<input name="name" defaultValue={selectedGame.name} disabled={!setupEditable} required /></label>
                  <label>Timezone<input name="timezone" defaultValue={selectedGame.timezone} disabled={!setupEditable} required /></label>
                  <label>Start date<input name="startDate" type="date" defaultValue={selectedGame.startDate} disabled={!setupEditable} required /></label>
                  <label>End date<input name="endDate" type="date" defaultValue={selectedGame.endDate} disabled={!setupEditable} required /></label>
                  <label>Final cutoff<input name="finalCutoffAt" type="datetime-local" defaultValue={selectedGame.finalCutoffLocal} disabled={!setupEditable} required /></label>
                  <label>Day ballot closes<input name="dayCloses" type="time" defaultValue={selectedGame.schedule.dayCloses ?? '16:00'} disabled={!setupEditable} required /></label>
                  <label>Night actions close<input name="nightCloses" type="time" defaultValue={selectedGame.schedule.nightCloses ?? '09:00'} disabled={!setupEditable} required /></label>
                  <fieldset className="weekday-picker wide" disabled={!setupEditable}><legend>Active weekdays</legend><div>{weekdayOptions.map((day) => <label key={day.value}><input name="activeWeekdays" type="checkbox" value={day.value} defaultChecked={selectedGame.activeWeekdays.includes(day.value)} />{day.label}</label>)}</div></fieldset>
                  <GameSettingsFields initial={{ hunterWindowMinutes: selectedGame.hunterWindowMinutes, dayDivisor: selectedGame.dayDivisor, nightDivisor: selectedGame.nightDivisor, eliminationSchedule: selectedGame.eliminationSchedule ?? null, publicationMode: selectedGame.publicationMode, reviewWindowMinutes: selectedGame.reviewWindowMinutes }} disabled={!setupEditable} />
                  <div className="button-row wide">
                    {setupEditable && <button className="primary-button" type="submit">Save schedule</button>}
                    <button className="secondary-button" type="button" onClick={() => setShowSchedulePanel(false)}>Close schedule</button>
                  </div>
                </form>
                {!setupEditable && <p className="notice warning schedule-lock-note">Schedule changes are locked for this {selectedGame.status.replaceAll('_', ' ').toLowerCase()} game.</p>}
              </section>}
              {setupEditable && selectedGame && <SignupsPanel key={`signups-${gameId}`} gameId={gameId} gameStatus={selectedGame.status} active={activeTab === 'setup'} refreshKey={`${signupSummary?.state}-${signupSummary?.pending}-${signupSummary?.accepted}`} onAccepted={signupsAccepted} onRosterChanged={() => void loadGame(gameId).catch(() => {})} />}
              {setupEditable ? <section className="setup-card" id="setup-roster">
                <div className="setup-card-heading"><span>2b</span><div><h2>Import the roster</h2><p>Use the exact CSV headers below. Use this, the <strong>Sign-ups</strong> card above, or both, in either order. Once anyone is on the roster, an imported list is added to it: they keep their seats and links, and anyone on the list who is already there is skipped. To start over from the list instead, use <strong>Replace the whole roster</strong>. To add or remove one player, use <strong>Change the roster</strong> below. Presets start at {MIN_PLAYERS} players and add special roles in stages; they are starting points, not a balance guarantee.</p></div></div>
                <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void importRoster(event.currentTarget, roster.length > 0 ? 'ADD' : 'REPLACE'); }}>
                  <label>Roster CSV<textarea name="csv" defaultValue={sampleRoster} rows={8} spellCheck={false} required /></label>
                  {roster.length > 0 && <p className="field-help" role="note">This list will be added to the {roster.length} {roster.length === 1 ? 'player' : 'players'} already on the roster{(signupSummary?.accepted ?? 0) > 0 ? `, including the ${signupSummary?.accepted} you accepted from sign-ups` : ''}. They keep their seats and links.</p>}
                  <div className="button-row">
                    <button className="primary-button" type="submit" disabled={editingRoster}>{roster.length > 0 ? 'Add these players to the roster' : 'Create private seats'}</button>
                    {roster.length > 0 && <button className="secondary-button" type="button" onClick={(event) => replaceRoster(event.currentTarget.form)} disabled={editingRoster}>Replace the whole roster</button>}
                    {inviteRows.length > 0 && <button className="secondary-button" type="button" onClick={downloadInvites}>Download invite CSV</button>}
                  </div>
                </form>
                {roster.length > 0 && <div className="claim-meter"><span style={{ width: `${(claimed / roster.length) * 100}%` }} /><strong>{claimed} of {roster.length} claimed</strong></div>}
                {rosterEditable ? <div className="invite-email roster-edit">
                  <p><strong>Change the roster</strong></p>
                  <p className="field-help">Add a late joiner, or remove someone who hasn’t claimed their seat. Everyone else keeps their seat. Each change adds or removes one Villager. This locks once you randomize roles.</p>
                  <form className="setup-grid" onSubmit={addSeat} aria-label="Add a player">
                    <label>Display name<input name="displayName" maxLength={80} autoComplete="off" required /></label>
                    <label>Email<input name="email" type="email" autoComplete="off" required /></label>
                    <div className="button-row wide"><button className="secondary-button" type="submit" disabled={editingRoster}>{editingRoster ? 'Saving…' : 'Add player'}</button></div>
                  </form>
                  {shownInvite && <div className="added-invite">
                    <p className="field-help">{shownInvite.displayName}’s private link is shown only now. Copy it and send it only to them{emailConfigured ? ', or use Email in the waiting list below' : ''}.</p>
                    <div className="button-row"><input readOnly value={shownInvite.claimUrl} aria-label={`${shownInvite.displayName}’s private link`} onFocus={(event) => event.currentTarget.select()} /><button className="text-button" type="button" onClick={() => void copyAddedInvite()}>Copy link</button></div>
                  </div>}
                </div> : roster.length > 0 && selectedGame?.status === 'ASSIGNMENT_PREVIEW' && <p className="field-help roster-lock-note">Roles have been randomized, so players can’t be added or removed. To change the roster, select <strong>Save composition</strong> to discard the preview.</p>}
                {unclaimed.length > 0 && <div className="invite-email">
                  <div className="button-row">
                    <button className="primary-button" type="button" onClick={() => void emailInvites(unclaimed)} disabled={!emailConfigured || emailingInvites}>{emailingInvites ? 'Sending…' : `Email invites to ${unclaimed.length} unclaimed ${unclaimed.length === 1 ? 'player' : 'players'}`}</button>
                  </div>
                  <p className="field-help">{emailConfigured ? 'Each email holds a new private link. Any earlier link for that player, including the one in the invite CSV, stops working.' : 'Invite email is not set up for this site, so use Download invite CSV. The site operator can turn email on in Vercel.'}</p>
                  <details>
                    <summary>Waiting on {unclaimed.length} {unclaimed.length === 1 ? 'player' : 'players'}</summary>
                    <ul className="invite-list">
                      {unclaimed.map((seat) => <li key={seat.id}>
                        <span><strong>{seat.displayName}</strong><small>{seat.email} · {seat.invitationEmailedAt ? `emailed ${new Date(seat.invitationEmailedAt).toLocaleString()}` : 'not emailed'}</small></span>
                        <span className="button-row">
                          {emailConfigured && <button className="text-button" type="button" onClick={() => void emailInvites([seat])} disabled={emailingInvites}>{seat.invitationEmailedAt ? 'Resend' : 'Email'}</button>}
                          {rosterEditable && <button className="text-button" type="button" onClick={() => void removeSeat(seat)} disabled={editingRoster || roster.length === MIN_PLAYERS} aria-label={`Remove ${seat.displayName}`}>Remove</button>}
                        </span>
                      </li>)}
                    </ul>
                  </details>
                </div>}
              </section> : <section className="setup-card" id="setup-roster"><p className="notice warning">This game is {selectedGame?.status.replaceAll('_', ' ').toLowerCase()}. Setup changes are locked. Select another game or start a new setup.</p></section>}

              {setupEditable && composition && roster.length >= MIN_PLAYERS && (
                <section className="setup-card" id="setup-roles">
                  <div className="setup-card-heading"><span>03</span><div><h2>Balance the roles</h2><p>Counts must equal the roster. Unique roles cap at one; Masons travel in groups. Small-game presets are editable before release.</p></div></div>
                  <div className="role-composer">
                      {roleOrder.map((role) => (
                        <label key={role}>{ROLE_CATALOG[role].name}
                        <input type="number" min="0" max={ROLE_CATALOG[role].unique ? 1 : roster.length} value={composition[role]} onChange={(event) => {
                          const next = { ...composition, [role]: Number(event.target.value) };
                          markCompositionDraft(gameId, next);
                          setComposition(next);
                        }} />
                      </label>
                    ))}
                  </div>
                  <div className="balance-bar"><div><strong>Signed balance score</strong><small>Village positive · Werewolf negative</small></div><b className={Math.abs(balanceScore) <= Math.max(2, roster.length * .15) ? 'balanced' : ''}>{balanceScore > 0 ? '+' : ''}{balanceScore}</b></div>
                  <div className="button-row">
                    <button className="secondary-button" type="button" onClick={saveComposition}>Save composition</button>
                    <button className="primary-button" type="button" onClick={previewAssignments} disabled={claimed !== roster.length || compositionDraftIds.has(gameId)}>Randomize roles</button>
                  </div>
                  {claimed !== roster.length && <p className="field-help">Randomization unlocks when every seat is claimed.</p>}
                  {compositionDraftIds.has(gameId) && <p className="field-help">Save the role composition before randomizing; the preview is invalidated when counts change.</p>}
                </section>
              )}

              {latestBatch && (
                <section className="setup-card assignment-review" id="setup-release">
                  <div className="setup-card-heading"><span>04</span><div><h2>Review assignment batch {latestBatch.revision}</h2><p>Random evidence <code>{latestBatch.randomEvidenceHash.slice(0, 16)}…</code></p></div></div>
                  <div className="assignment-grid">
                    {latestBatch.assignments.map((assignment) => <div key={assignment.seatId}><span>{rosterById.get(assignment.seatId)?.displayName ?? 'Player'}</span><strong>{ROLE_CATALOG[assignment.role].name}</strong></div>)}
                  </div>
                  {latestBatch.releasedAt ? <p className="notice success">Released {new Date(latestBatch.releasedAt).toLocaleString()}</p> : setupEditable ? <button className="danger-button" type="button" onClick={() => releaseAssignments(latestBatch.id)}>Release roles to players</button> : <p className="notice warning">This preview cannot be released because setup is locked.</p>}
                </section>
              )}
                {canCancelSetup && <section className="setup-card start-over" id="setup-start-over">
                  <div className="setup-card-heading"><span aria-hidden="true">▲</span><div><h2>Start over</h2><p>Cancel this unfinished setup and begin a new game. Its invite links and player sessions stop working; its audit history is kept.</p></div></div>
                  <button className="danger-button" type="button" onClick={() => void cancelSetup()}>Cancel setup and start new game</button>
                </section>}
              </ConsolePanel>

              <ConsolePanel id="run" active={activeTab === 'run'}>
                <HealthStrip />
                {released ? <>
                  <LiveGamePanel key={`live-${gameId}`} gameId={gameId} gameStatus={selectedGame?.status ?? ''} onChanged={handleLiveChange} onAttention={setRunAttention} />
                  <PlayerChoicesPanel key={`choices-${gameId}`} gameId={gameId} refreshToken={liveRefreshToken} />
                  <StatsPanel key={`stats-${gameId}`} gameId={gameId} refreshToken={liveRefreshToken} />
                </> : <section className="setup-card run-placeholder">
                  <div className="setup-card-heading"><span aria-hidden="true">▶</span><div><h2>{selectedGame?.status === 'CANCELLED' || selectedGame?.status === 'STOPPED' ? 'There is no game to run' : 'The game hasn’t started yet'}</h2><p>{selectedGame?.status === 'CANCELLED' ? 'This setup was cancelled.' : selectedGame?.status === 'STOPPED' ? 'This game was stopped before its roles were released.' : 'Phases, results, and every player’s choices appear here once you release the roles.'}</p></div></div>
                  {setupEditable && <button className="secondary-button" type="button" onClick={() => chooseTab('setup')}>Back to setup</button>}
                </section>}
              </ConsolePanel>

              <ConsolePanel id="people" active={activeTab === 'people'}>
                <section className="setup-card" id="player-access">
                  <div className="setup-card-heading"><span aria-hidden="true">◈</span><div><h2>Player access</h2><p>Get a player back in when they forget their PIN or their seat locks.</p></div></div>
                    <div className="card-stack"><PlayerAccessRecovery /></div>
                </section>
                {released
                  ? <SpectatorsPanel key={`spectators-${gameId}`} gameId={gameId} gameStatus={selectedGame?.status ?? ''} />
                  : <section className="setup-card spectators-card" id="spectators">
                    <div className="setup-card-heading"><span>◉</span><div><h2>Spectators</h2><p>Let people watch once the game is running. They have no role and no vote.</p></div></div>
                    <p className="field-help">Spectators can be added after you release the roles.</p>
                  </section>}
                <section className="setup-card" id="moderators">
                  <div className="setup-card-heading"><span aria-hidden="true">◆</span><div><h2>Moderators</h2><p>Share this game with co-moderators. Only the owner can add or remove them, or hand the game over.</p></div></div>
                  <div className="card-stack"><CoModeratorAccess /></div>
                </section>
                <ApplicationsPanel key={`applications-${gameId}`} gameId={gameId} isOwner={selectedGame?.moderatorRole === 'OWNER'} canOpen={!['CANCELLED', 'STOPPED', 'COMPLETED'].includes(selectedGame?.status ?? '')} active={activeTab === 'people'} refreshKey={`${signupSummary?.applicationsOpen}-${signupSummary?.pendingApplications}`} onChanged={handleLiveChange} />
              </ConsolePanel>

              <ConsolePanel id="messages" active={activeTab === 'messages'}>
                <section className="setup-card" id="announcements">
                  <div className="setup-card-heading"><span aria-hidden="true">▤</span><div><h2>Announcements</h2><p>Tell every player something official, then copy it into an email or group chat so nobody misses it.</p></div></div>
                    <div className="card-stack"><Announcements /></div>
                </section>
                <section className="setup-card" id="chat-moderation">
                  <div className="setup-card-heading"><span aria-hidden="true">◐</span><div><h2>Chat moderation</h2><p>Read any room, post as Moderator, make a room read-only, or remove a message.</p></div></div>
                  <div className="card-stack"><ChatRooms /></div>
                </section>
                <section className="setup-card" id="feedback">
                  <div className="setup-card-heading"><span aria-hidden="true">◒</span><div><h2>Feedback and ratings</h2><p>What players and moderators have said about the game so far.</p></div></div>
                  <div className="card-stack"><FeedbackSection /></div>
                </section>
              </ConsolePanel>

              <ConsolePanel id="safety" active={activeTab === 'safety'}>
                <section className="setup-card" id="records">
                  <div className="setup-card-heading"><span aria-hidden="true">▦</span><div><h2>Records and backups</h2><p>What the game has been doing, and private copies you can keep or restore from.</p></div></div>
                    <div className="card-stack"><EventLog /><BackupControls /></div>
                </section>
                <section className="setup-card danger-zone" id="danger-zone">
                  <div className="setup-card-heading"><span aria-hidden="true">▲</span><div><h2>Danger zone</h2><p>These end a game or rewind it. Read the confirmation before you agree.</p></div></div>
                  <div className="card-stack"><FailSafeControls /></div>
                </section>
              </ConsolePanel>
            </OperationsProvider>
          )}
        </section>
      </div>
    </main>
  );
}
