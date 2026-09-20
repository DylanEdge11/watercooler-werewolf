'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- the public entry links intentionally use full-page navigation. */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import LiveGamePanel from './live-game-panel';
import OperationsPanel from './operations-panel';
import { shouldRefreshOperations } from '../../lib/game/operations-refresh';
import { ROLE_CATALOG } from '../../lib/game/catalog';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../lib/game/player-count';

const sampleRoster = [
  'display_name,email',
  ...Array.from({ length: 20 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return `Player ${number},player${number}@example.test`;
  }),
].join('\n');

const roleOrder = ['VILLAGER', 'WEREWOLF', 'SEER', 'BODYGUARD', 'HUNTER', 'MASON'] as const;
type RoleKey = (typeof roleOrder)[number];
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
  moderatorRole?: string;
}

interface RosterSeat {
  id: string;
  displayName: string;
  email: string;
  status: string;
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
        <span className="brand-mark" aria-hidden="true">
          <span className="brand-moon" />
          <span className="brand-cup" />
        </span>
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
  const [inviteCsv, setInviteCsv] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [liveRefreshToken, setLiveRefreshToken] = useState(0);
  const [showNewGameForm, setShowNewGameForm] = useState(false);
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
      requestJson<{ roster: RosterSeat[] }>(`/api/games/${selectedGameId}/roster`),
      requestJson<{ composition: Composition; batches: Batch[]; game?: { status: string } }>(`/api/games/${selectedGameId}/assignments`),
    ]);
    if (requestId !== gameDetailRequest.current || selectedGameRef.current !== selectedGameId) return;
    setRoster(rosterData.roster);
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
    const poll = window.setInterval(() => {
      void loadGames(gameId).catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to refresh the game.'));
    }, 10_000);
    return () => window.clearInterval(poll);
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
          activeWeekdays: [1, 2, 3, 4, 5],
          schedule: { dayCloses: '16:00', nightCloses: '09:00' },
        }),
      });
      setMessage('Game created. Import the player roster next.');
      setInviteCsv('');
      setShowNewGameForm(false);
      await loadGames(data.gameId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create the game.');
    }
  }

  function selectGame(nextGameId: string) {
    if (!nextGameId) return;
    setShowNewGameForm(false);
    setInviteCsv('');
    setMessage('');
    setError('');
    selectedGameRef.current = nextGameId;
    void loadGames(nextGameId).catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load the selected game.'));
  }

  function startNewSetup() {
    setShowNewGameForm(true);
    setError('');
    setMessage('');
    setInviteCsv('');
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
      setInviteCsv('');
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
      const data = await requestJson<{ inviteCsv: string; playerCount: number; composition: Composition }>(
        `/api/games/${gameId}/roster`,
        { method: 'POST', body: JSON.stringify({ csv: form.get('csv') }) },
      );
      setInviteCsv(data.inviteCsv);
      markCompositionDraft(gameId, null);
      setComposition(data.composition);
      setMessage(`${data.playerCount} private seats created. Download the invite file now; codes are not shown again.`);
      await loadGame(gameId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to import the roster.');
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
    const url = URL.createObjectURL(new Blob([inviteCsv], { type: 'text/csv;charset=utf-8' }));
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
  const latestBatch = batches[0];
  const rosterById = useMemo(() => new Map(roster.map((seat) => [seat.id, seat])), [roster]);
  const gameDates = useMemo(() => defaultGameDates(), []);
  const balanceScore = composition
    ? composition.VILLAGER - composition.WEREWOLF * 5 + composition.SEER * 3 + composition.BODYGUARD * 2 + composition.HUNTER + composition.MASON
    : 0;

  if (loading) return <main className="setup-shell"><BrandHeader /><p className="setup-loading">Opening the moderator console…</p></main>;

  if (!authenticated) {
    return (
      <main className="setup-shell">
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
    <main className="setup-shell">
      <BrandHeader />
      <div className="console-layout">
        <aside className="setup-progress">
          <p className="eyebrow">Launch checklist</p>
          <ol>
            <li className={games.length ? 'done' : 'active'}><span>1</span><div><strong>Game schedule</strong><small>Timezone and cadence</small></div></li>
            <li className={roster.length ? 'done' : games.length ? 'active' : ''}><span>2</span><div><strong>Player roster</strong><small>{MIN_PLAYERS}–{MAX_PLAYERS} private seats</small></div></li>
            <li className={latestBatch ? 'done' : roster.length ? 'active' : ''}><span>3</span><div><strong>Role balance</strong><small>Compose and randomize</small></div></li>
            <li className={latestBatch?.releasedAt ? 'done' : latestBatch ? 'active' : ''}><span>4</span><div><strong>Release roles</strong><small>Irreversible launch</small></div></li>
          </ol>
          <a className="quiet-link" href="/">View player preview →</a>
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
            <section className="setup-card">
              <div className="setup-card-heading"><span>01</span><div><h2>Schedule the campaign</h2><p>Weekday phases keep the game lively without disrupting work.</p></div></div>
              <form className="setup-grid" onSubmit={createGame}>
                <label className="wide">Game name<input name="name" defaultValue="Office Werewolf Campaign" required /></label>
                <label>Timezone<input name="timezone" defaultValue="America/Regina" required /></label>
                <label>Start date<input name="startDate" type="date" defaultValue={gameDates.start} required /></label>
                <label>End date<input name="endDate" type="date" defaultValue={gameDates.end} required /></label>
                <label>Final cutoff<input name="finalCutoffAt" type="datetime-local" defaultValue={gameDates.cutoff} required /></label>
                <div className="schedule-note wide"><strong>Default cadence</strong><span>Day ballot closes 4:00 PM · Night actions close 9:00 AM · Monday–Friday</span></div>
                <button className="primary-button" type="submit">Create game</button>
              </form>
            </section>
          ) : (
            <>
              {setupEditable ? <section className="setup-card">
                <div className="setup-card-heading"><span>02</span><div><h2>Import the roster</h2><p>Use the exact CSV headers below. Re-importing replaces unlaunched seats. Presets start at {MIN_PLAYERS} players and add special roles in stages; they are starting points, not a balance guarantee.</p></div></div>
                <form className="form-stack" onSubmit={importRoster}>
                  <label>Roster CSV<textarea name="csv" defaultValue={sampleRoster} rows={8} spellCheck={false} required /></label>
                  <div className="button-row">
                    <button className="primary-button" type="submit">Create private seats</button>
                    {inviteCsv && <button className="secondary-button" type="button" onClick={downloadInvites}>Download invite CSV</button>}
                  </div>
                </form>
                {roster.length > 0 && <div className="claim-meter"><span style={{ width: `${(claimed / roster.length) * 100}%` }} /><strong>{claimed} of {roster.length} claimed</strong></div>}
              </section> : <section className="setup-card"><p className="notice warning">This game is {selectedGame?.status.replaceAll('_', ' ').toLowerCase()}. Setup changes are locked. Select another game or start a new setup.</p></section>}

              {setupEditable && composition && (
                <section className="setup-card">
                  <div className="setup-card-heading"><span>03</span><div><h2>Balance the roles</h2><p>Counts must equal the roster. Unique roles cap at one; Masons travel in groups. Small-game presets are editable before release.</p></div></div>
                  <div className="role-composer">
                    {roleOrder.map((role) => (
                      <label key={role}>{role.toLowerCase().replace(/^./u, (letter) => letter.toUpperCase())}
                        <input type="number" min="0" max={role === 'SEER' || role === 'BODYGUARD' || role === 'HUNTER' ? 1 : roster.length} value={composition[role]} onChange={(event) => {
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
