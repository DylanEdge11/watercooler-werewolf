'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import LiveGamePanel from './live-game-panel';
import OperationsPanel from './operations-panel';

const sampleRoster = [
  'display_name,email',
  ...Array.from({ length: 20 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return `Player ${number},player${number}@example.com`;
  }),
].join('\n');

const roleOrder = ['VILLAGER', 'WEREWOLF', 'SEER', 'DOCTOR', 'HUNTER', 'MASON'] as const;
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
      <Link className="brand" href="/" aria-label="Watercooler Werewolf home">
        <span className="brand-mark" aria-hidden="true">
          <span className="brand-moon" />
          <span className="brand-cup" />
        </span>
        <span><strong>Watercooler</strong><small>Werewolf</small></span>
      </Link>
      <span className="mode-chip">Moderator console</span>
    </header>
  );
}

export default function ModeratorPage() {
  const [loading, setLoading] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
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

  const loadGame = useCallback(async (selectedGameId: string) => {
    const [rosterData, assignmentData] = await Promise.all([
      requestJson<{ roster: RosterSeat[] }>(`/api/games/${selectedGameId}/roster`),
      requestJson<{ composition: Composition; batches: Batch[] }>(`/api/games/${selectedGameId}/assignments`),
    ]);
    setRoster(rosterData.roster);
    setComposition(assignmentData.composition);
    setBatches(assignmentData.batches);
  }, []);

  const loadGames = useCallback(async () => {
    const data = await requestJson<{ games: GameSummary[] }>('/api/games');
    setAuthenticated(true);
    setGames(data.games);
    if (data.games[0]) {
      setGameId(data.games[0].id);
      await loadGame(data.games[0].id);
    }
  }, [loadGame]);

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

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const endpoint = needsBootstrap ? '/api/moderators/bootstrap' : '/api/moderators/login';
      const data = await requestJson<{ recoveryCodes?: string[] }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      setRecoveryCodes(data.recoveryCodes ?? []);
      setNeedsBootstrap(false);
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
      const finalCutoff = new Date(String(form.get('finalCutoffAt'))).toISOString();
      const data = await requestJson<{ gameId: string }>('/api/games', {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          timezone: form.get('timezone'),
          startDate: form.get('startDate'),
          endDate: form.get('endDate'),
          finalCutoffAt: finalCutoff,
          activeWeekdays: [1, 2, 3, 4, 5],
          schedule: { dayCloses: '16:00', nightCloses: '09:00' },
        }),
      });
      setMessage('Game created. Import the player roster next.');
      await loadGames();
      setGameId(data.gameId);
      await loadGame(data.gameId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create the game.');
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

  function downloadInvites() {
    const url = URL.createObjectURL(new Blob([inviteCsv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'watercooler-werewolf-invites.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const selectedGame = games.find((game) => game.id === gameId);
  const claimed = roster.filter((seat) => seat.status === 'CLAIMED').length;
  const latestBatch = batches[0];
  const rosterById = useMemo(() => new Map(roster.map((seat) => [seat.id, seat])), [roster]);
  const gameDates = useMemo(() => defaultGameDates(), []);
  const balanceScore = composition
    ? composition.VILLAGER - composition.WEREWOLF * 5 + composition.SEER * 3 + composition.DOCTOR * 2 + composition.HUNTER + composition.MASON
    : 0;

  if (loading) return <main className="setup-shell"><BrandHeader /><p className="setup-loading">Opening the moderator console…</p></main>;

  if (!authenticated) {
    return (
      <main className="setup-shell">
        <BrandHeader />
        <section className="auth-card">
          <p className="eyebrow accent">Private game control</p>
          <h1>{needsBootstrap ? 'Create the primary moderator' : 'Moderator sign-in'}</h1>
          <p>{needsBootstrap ? 'This first account owns the game and can add co-moderators later.' : 'Sign in to resume setup or run an active game.'}</p>
          <form className="form-stack" onSubmit={handleAuth}>
            <label>Email<input name="email" type="email" autoComplete="email" required /></label>
            <label>Password<input name="password" type="password" minLength={needsBootstrap ? 12 : undefined} autoComplete={needsBootstrap ? 'new-password' : 'current-password'} required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit">{needsBootstrap ? 'Create moderator' : 'Sign in'}</button>
          </form>
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
            <li className={roster.length ? 'done' : games.length ? 'active' : ''}><span>2</span><div><strong>Player roster</strong><small>20–80 private seats</small></div></li>
            <li className={latestBatch ? 'done' : roster.length ? 'active' : ''}><span>3</span><div><strong>Role balance</strong><small>Compose and randomize</small></div></li>
            <li className={latestBatch?.releasedAt ? 'done' : latestBatch ? 'active' : ''}><span>4</span><div><strong>Release roles</strong><small>Irreversible launch</small></div></li>
          </ol>
          <Link className="quiet-link" href="/">View player preview →</Link>
        </aside>

        <section className="console-main">
          <div className="console-title">
            <div><p className="eyebrow accent">Office campaign</p><h1>{selectedGame?.name ?? 'Set up a new game'}</h1></div>
            {selectedGame && <span className="status-pill">{selectedGame.status.replaceAll('_', ' ')}</span>}
          </div>
          {error && <p className="notice error" role="alert">{error}</p>}
          {message && <p className="notice success" role="status">{message}</p>}
          {recoveryCodes.length > 0 && (
            <div className="notice warning"><strong>Save these one-time recovery codes now:</strong><code>{recoveryCodes.join(' · ')}</code></div>
          )}

          {!games.length ? (
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
              <section className="setup-card">
                <div className="setup-card-heading"><span>02</span><div><h2>Import the roster</h2><p>Use the exact CSV headers below. Re-importing replaces unlaunched seats.</p></div></div>
                <form className="form-stack" onSubmit={importRoster}>
                  <label>Roster CSV<textarea name="csv" defaultValue={sampleRoster} rows={8} spellCheck={false} required /></label>
                  <div className="button-row">
                    <button className="primary-button" type="submit">Create private seats</button>
                    {inviteCsv && <button className="secondary-button" type="button" onClick={downloadInvites}>Download invite CSV</button>}
                  </div>
                </form>
                {roster.length > 0 && <div className="claim-meter"><span style={{ width: `${(claimed / roster.length) * 100}%` }} /><strong>{claimed} of {roster.length} claimed</strong></div>}
              </section>

              {composition && (
                <section className="setup-card">
                  <div className="setup-card-heading"><span>03</span><div><h2>Balance the roles</h2><p>Counts must equal the roster. Unique roles cap at one; Masons travel in groups.</p></div></div>
                  <div className="role-composer">
                    {roleOrder.map((role) => (
                      <label key={role}>{role.toLowerCase().replace(/^./u, (letter) => letter.toUpperCase())}
                        <input type="number" min="0" max={role === 'SEER' || role === 'DOCTOR' || role === 'HUNTER' ? 1 : roster.length} value={composition[role]} onChange={(event) => setComposition({ ...composition, [role]: Number(event.target.value) })} />
                      </label>
                    ))}
                  </div>
                  <div className="balance-bar"><div><strong>Signed balance score</strong><small>Village positive · Werewolf negative</small></div><b className={Math.abs(balanceScore) <= Math.max(2, roster.length * .15) ? 'balanced' : ''}>{balanceScore > 0 ? '+' : ''}{balanceScore}</b></div>
                  <div className="button-row">
                    <button className="secondary-button" type="button" onClick={saveComposition}>Save composition</button>
                    <button className="primary-button" type="button" onClick={previewAssignments} disabled={claimed !== roster.length}>Randomize roles</button>
                  </div>
                  {claimed !== roster.length && <p className="field-help">Randomization unlocks when every seat is claimed.</p>}
                </section>
              )}

              {latestBatch && (
                <section className="setup-card assignment-review">
                  <div className="setup-card-heading"><span>04</span><div><h2>Review assignment batch {latestBatch.revision}</h2><p>Random evidence <code>{latestBatch.randomEvidenceHash.slice(0, 16)}…</code></p></div></div>
                  <div className="assignment-grid">
                    {latestBatch.assignments.map((assignment) => <div key={assignment.seatId}><span>{rosterById.get(assignment.seatId)?.displayName ?? 'Player'}</span><strong>{assignment.role}</strong></div>)}
                  </div>
                  {latestBatch.releasedAt ? <p className="notice success">Released {new Date(latestBatch.releasedAt).toLocaleString()}</p> : <button className="danger-button" type="button" onClick={() => releaseAssignments(latestBatch.id)}>Release roles to players</button>}
                </section>
              )}
              {latestBatch?.releasedAt && <LiveGamePanel gameId={gameId} gameStatus={selectedGame?.status ?? ''} />}
              {latestBatch?.releasedAt && <OperationsPanel gameId={gameId} />}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
