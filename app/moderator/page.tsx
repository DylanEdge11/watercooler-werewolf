'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- the public entry links intentionally use full-page navigation. */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import GameSettingsFields from './game-settings-fields';
import { useRouter } from 'next/navigation';
import LiveGamePanel from './live-game-panel';
import OperationsPanel from './operations-panel';
import { shouldRefreshOperations } from '../../lib/game/operations-refresh';
import { ROLE_CATALOG } from '../../lib/game/catalog';
import { ROLE_KEYS, type RoleKey } from '../../lib/game/types';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../lib/game/player-count';
import BrandMark from '../brand-mark';
import { pollWhileVisible } from '../../lib/http/poll-while-visible';
import { createInviteExport } from '../../lib/roster/csv';

const sampleRoster = [
  'display_name,email',
  ...Array.from({ length: 20 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return `Player ${number},player${number}@example.test`;
  }),
].join('\n');

const roleOrder = ROLE_KEYS;
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

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  const data = (await response.json()) as T & { error?: string; errors?: string[] };
  if (!response.ok) throw new Error(data.error ?? data.errors?.join(' ') ?? 'Request failed.');
  return data;
}

function BrandHeader() {
  return (
    <header className="setup-header">
      <a className="brand" href="/" aria-label="Watercooler Werewolf home">
        <BrandMark />
        <span><strong>Watercooler</strong><small>Werewolf</small></span>
      </a>
      <span className="mode-chip">Moderator console</span>
    </header>
  );
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
  const [emailingInvites, setEmailingInvites] = useState(false);
  const [editingRoster, setEditingRoster] = useState(false);
  const [addedInvite, setAddedInvite] = useState<{ gameId: string; seatId: string; displayName: string; claimUrl: string } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [liveRefreshToken, setLiveRefreshToken] = useState(0);
  const [showNewGameForm, setShowNewGameForm] = useState(false);
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  const [compositionDraftIds, setCompositionDraftIds] = useState<Set<string>>(() => new Set());
  const selectedGameRef = useRef('');
  const gamesRequest = useRef(0);
  const gameDetailRequest = useRef(0);
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

  const loadGame = useCallback(async (selectedGameId: string) => {
    const requestId = ++gameDetailRequest.current;
    const [rosterData, assignmentData] = await Promise.all([
      requestJson<{ roster: RosterSeat[]; emailConfigured?: boolean }>(`/api/games/${selectedGameId}/roster`),
      requestJson<{ composition: Composition; batches: Batch[]; game?: { status: string } }>(`/api/games/${selectedGameId}/assignments`),
    ]);
    if (requestId !== gameDetailRequest.current || selectedGameRef.current !== selectedGameId) return;
    setRoster(rosterData.roster);
    setEmailConfigured(Boolean(rosterData.emailConfigured));
    setComposition(compositionDrafts.current.get(selectedGameId) ?? assignmentData.composition);
    setBatches(assignmentData.batches);
    if (assignmentData.game?.status) {
      setGames((current) => current.map((game) => game.id === selectedGameId ? { ...game, status: assignmentData.game?.status ?? game.status } : game));
    }
  }, []);

  const loadGames = useCallback(async (preferredGameId = selectedGameRef.current) => {
    const requestId = ++gamesRequest.current;
    const data = await requestJson<{ games: GameSummary[] }>('/api/games');
    if (requestId !== gamesRequest.current) return;
    setAuthenticated(true);
    setGames(data.games);
    const selected = data.games.find((game) => game.id === preferredGameId) ?? data.games[0];
    if (selected) {
      selectedGameRef.current = selected.id;
      setGameId(selected.id);
      await loadGame(selected.id);
    } else {
      selectedGameRef.current = '';
      setGameId('');
      setRoster([]);
      setComposition(null);
      setBatches([]);
    }
  }, [loadGame]);

  const handleLiveChange = useCallback((action?: string) => {
    if (shouldRefreshOperations(action)) setLiveRefreshToken((token) => token + 1);
    void loadGames(gameId).catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to refresh the game.'));
  }, [gameId, loadGames]);

  useEffect(() => {
    void (async () => {
      try {
        const bootstrap = await requestJson<{ needsBootstrap: boolean }>('/api/moderators/bootstrap');
        setNeedsBootstrap(bootstrap.needsBootstrap);
        if (!bootstrap.needsBootstrap) await loadGames();
      } catch {
        setAuthenticated(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadGames]);

  useEffect(() => {
    if (!authenticated) return;
    return pollWhileVisible(() => {
      void loadGames(gameId).catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to refresh the game.'));
    }, 10_000);
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
          publicationMode: form.get('publicationMode'),
          reviewWindowMinutes: form.get('reviewWindowMinutes'),
        }),
      });
      setMessage('Game created. Import the player roster next.');
      setInviteRows([]);
      setShowNewGameForm(false);
      setShowSchedulePanel(false);
      await loadGames(data.gameId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create the game.');
    }
  }

  function selectGame(nextGameId: string) {
    if (!nextGameId) return;
    setShowNewGameForm(false);
    setShowSchedulePanel(false);
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
    }
    window.setTimeout(() => document.getElementById('game-schedule')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
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

  async function importRoster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const data = await requestJson<{ invites: InviteRow[]; playerCount: number; composition: Composition }>(
        `/api/games/${gameId}/roster`,
        { method: 'POST', body: JSON.stringify({ csv: form.get('csv') }) },
      );
      setInviteRows(data.invites);
      markCompositionDraft(gameId, null);
      setComposition(data.composition);
      setMessage(`${data.playerCount} private seats created. Email the invitations below, or download the invite file now; codes are not shown again.`);
      await loadGame(gameId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to import the roster.');
    }
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
    setError('');
    try {
      await requestJson(`/api/games/${gameId}/assignments`, {
        method: 'POST',
        body: JSON.stringify({ action: 'RELEASE', batchId }),
      });
      setMessage('Roles released. Each player can now see only their own role.');
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
        <aside className="setup-progress">
          <p className="eyebrow">Launch checklist</p>
          <ol>
            <li className={`${games.length ? 'done' : 'active'} ${showSchedulePanel || showNewGameForm ? 'reviewing' : ''}`}><button className="checklist-step" type="button" onClick={openGameSchedule} aria-controls="game-schedule"><span>1</span><div><strong>Game schedule</strong><small>Open timezone and cadence</small></div></button></li>
            <li className={roster.length ? 'done' : games.length ? 'active' : ''}><span>2</span><div><strong>Player roster</strong><small>Minimum {MIN_PLAYERS} · up to {MAX_PLAYERS} private seats</small></div></li>
            <li className={latestBatch ? 'done' : roster.length ? 'active' : ''}><span>3</span><div><strong>Role balance</strong><small>Compose and randomize</small></div></li>
            <li className={latestBatch?.releasedAt ? 'done' : latestBatch ? 'active' : ''}><span>4</span><div><strong>Release roles</strong><small>Irreversible launch</small></div></li>
          </ol>
          <a className="quiet-link" href="/">View current player session →</a>
          <a className="quiet-link" href="/moderator/player-preview">Open Player View Studio →</a>
        </aside>

        <section className="console-main">
          <div className="console-title">
            <div><p className="eyebrow accent">Office campaign</p><h1>{selectedGame?.name ?? 'Set up a new game'}</h1></div>
            <div className="console-title-actions">{selectedGame && <span className="status-pill">{selectedGame.status.replaceAll('_', ' ')}</span>}<button className="secondary-button" type="button" onClick={startNewSetup}>Start new setup</button><button className="text-button" type="button" onClick={signOut}>Sign out</button></div>
          </div>
          {error && <p className="notice error" role="alert">{error}</p>}
          {message && <p className="notice success" role="status">{message}</p>}
          {recoveryCodes.length > 0 && (
            <div className="notice warning"><strong>Save these one-time recovery codes now:</strong><code>{recoveryCodes.join(' · ')}</code></div>
          )}

          {games.length > 0 && (
            <section className="setup-card game-selector-card">
              <div className="setup-card-heading"><span>↔</span><div><h2>Game workspace</h2><p>Select a prior game to review its scoped roster, roles, and operations.</p></div></div>
              <div className="button-row">
                <label className="game-selector-label">Selected game
                  <select aria-label="Selected game" value={gameId} onChange={(event) => selectGame(event.target.value)}>
                    {games.map((game) => <option key={game.id} value={game.id}>{game.name} · {game.status.replaceAll('_', ' ')}</option>)}
                  </select>
                </label>
                {canCancelSetup && <button className="danger-button" type="button" onClick={() => void cancelSetup()}>Cancel setup and start new game</button>}
                {showNewGameForm && <button className="secondary-button" type="button" onClick={() => setShowNewGameForm(false)}>Back to selected game</button>}
              </div>
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
            <>
              {showSchedulePanel && selectedGame && <section className="setup-card" id="game-schedule">
                <div className="setup-card-heading"><span>01</span><div><h2>Game schedule</h2><p>{setupEditable ? 'Review or update the setup details, then continue where you left off.' : 'Review the launch schedule. It becomes read-only after roles are released.'}</p></div></div>
                <form className="setup-grid" key={`schedule-${selectedGame.id}-${selectedGame.finalCutoffAt}-${selectedGame.hunterWindowMinutes}-${selectedGame.dayDivisor}-${selectedGame.nightDivisor}-${selectedGame.publicationMode}-${selectedGame.reviewWindowMinutes}`} onSubmit={updateSchedule}>
                  <label className="wide">Game name<input name="name" defaultValue={selectedGame.name} disabled={!setupEditable} required /></label>
                  <label>Timezone<input name="timezone" defaultValue={selectedGame.timezone} disabled={!setupEditable} required /></label>
                  <label>Start date<input name="startDate" type="date" defaultValue={selectedGame.startDate} disabled={!setupEditable} required /></label>
                  <label>End date<input name="endDate" type="date" defaultValue={selectedGame.endDate} disabled={!setupEditable} required /></label>
                  <label>Final cutoff<input name="finalCutoffAt" type="datetime-local" defaultValue={selectedGame.finalCutoffLocal} disabled={!setupEditable} required /></label>
                  <label>Day ballot closes<input name="dayCloses" type="time" defaultValue={selectedGame.schedule.dayCloses ?? '16:00'} disabled={!setupEditable} required /></label>
                  <label>Night actions close<input name="nightCloses" type="time" defaultValue={selectedGame.schedule.nightCloses ?? '09:00'} disabled={!setupEditable} required /></label>
                  <fieldset className="weekday-picker wide" disabled={!setupEditable}><legend>Active weekdays</legend><div>{weekdayOptions.map((day) => <label key={day.value}><input name="activeWeekdays" type="checkbox" value={day.value} defaultChecked={selectedGame.activeWeekdays.includes(day.value)} />{day.label}</label>)}</div></fieldset>
                  <GameSettingsFields initial={{ hunterWindowMinutes: selectedGame.hunterWindowMinutes, dayDivisor: selectedGame.dayDivisor, nightDivisor: selectedGame.nightDivisor, publicationMode: selectedGame.publicationMode, reviewWindowMinutes: selectedGame.reviewWindowMinutes }} disabled={!setupEditable} />
                  <div className="button-row wide">
                    {setupEditable && <button className="primary-button" type="submit">Save schedule</button>}
                    <button className="secondary-button" type="button" onClick={() => setShowSchedulePanel(false)}>Close schedule</button>
                  </div>
                </form>
                {!setupEditable && <p className="notice warning schedule-lock-note">Schedule changes are locked for this {selectedGame.status.replaceAll('_', ' ').toLowerCase()} game.</p>}
              </section>}
              {setupEditable ? <section className="setup-card">
                <div className="setup-card-heading"><span>02</span><div><h2>Import the roster</h2><p>Use the exact CSV headers below. Re-importing replaces every seat, so everyone must claim again; to add or remove one player, use <strong>Change the roster</strong> below. Presets start at {MIN_PLAYERS} players and add special roles in stages; they are starting points, not a balance guarantee.</p></div></div>
                <form className="form-stack" onSubmit={importRoster}>
                  <label>Roster CSV<textarea name="csv" defaultValue={sampleRoster} rows={8} spellCheck={false} required /></label>
                  <div className="button-row">
                    <button className="primary-button" type="submit">Create private seats</button>
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
                          {rosterEditable && <button className="text-button" type="button" onClick={() => void removeSeat(seat)} disabled={editingRoster || roster.length <= MIN_PLAYERS} aria-label={`Remove ${seat.displayName}`}>Remove</button>}
                        </span>
                      </li>)}
                    </ul>
                  </details>
                </div>}
              </section> : <section className="setup-card"><p className="notice warning">This game is {selectedGame?.status.replaceAll('_', ' ').toLowerCase()}. Setup changes are locked. Select another game or start a new setup.</p></section>}

              {setupEditable && composition && (
                <section className="setup-card">
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
                <section className="setup-card assignment-review">
                  <div className="setup-card-heading"><span>04</span><div><h2>Review assignment batch {latestBatch.revision}</h2><p>Random evidence <code>{latestBatch.randomEvidenceHash.slice(0, 16)}…</code></p></div></div>
                  <div className="assignment-grid">
                    {latestBatch.assignments.map((assignment) => <div key={assignment.seatId}><span>{rosterById.get(assignment.seatId)?.displayName ?? 'Player'}</span><strong>{ROLE_CATALOG[assignment.role].name}</strong></div>)}
                  </div>
                  {latestBatch.releasedAt ? <p className="notice success">Released {new Date(latestBatch.releasedAt).toLocaleString()}</p> : setupEditable ? <button className="danger-button" type="button" onClick={() => releaseAssignments(latestBatch.id)}>Release roles to players</button> : <p className="notice warning">This preview cannot be released because setup is locked.</p>}
                </section>
              )}
              {latestBatch?.releasedAt && <LiveGamePanel key={`live-${gameId}`} gameId={gameId} gameStatus={selectedGame?.status ?? ''} onChanged={handleLiveChange} />}
              <OperationsPanel key={`operations-${gameId}`} gameId={gameId} refreshToken={liveRefreshToken} onGameChanged={handleLiveChange} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
