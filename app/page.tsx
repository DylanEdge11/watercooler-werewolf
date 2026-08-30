'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import PrivateRoomChat from './private-room-chat';

type RoleKey = 'VILLAGER' | 'WEREWOLF' | 'SEER' | 'BODYGUARD' | 'HUNTER' | 'MASON';
type ActionKind = 'DAY_VOTE' | 'WOLF_VOTE' | 'INVESTIGATE' | 'PROTECT' | 'HUNTER_SHOT';

interface DashboardData {
  player: {
    id: string;
    displayName: string;
    alive: boolean;
    role: RoleKey | null;
    roleDefinition: { name: string; faction: string; summary: string } | null;
    teammates: Array<{ id: string; displayName: string; alive: boolean }>;
  };
  game: { id: string; name: string; status: string; timezone: string; counts: { total: number; living: number }; stopReason?: string | null };
  phase: null | {
    id: string;
    sequence: number;
    kind: 'DAY' | 'NIGHT' | 'FINAL_BALLOT';
    status: string;
    slots: number;
    deadline: string | null;
  };
  permission: { actionKind: ActionKind | null; maxTargets: number; label: string };
  candidates: Array<{ id: string; displayName: string }>;
  currentAction: null | { targetIds: string[]; version: number; submittedAt: string };
  participation: { submitted: number; eligible: number };
  timeline: Array<{
    id: string;
    eventType: string;
    createdAt: string;
    payload: {
      kind?: string;
      title?: string;
      body?: string;
      winner?: string | null;
      eliminations?: Array<{ displayName: string; role: string; cause: string }>;
    };
  }>;
  notifications: Array<{ id: string; title: string; body: string; createdAt: string }>;
  rooms: Array<{ id: string; type: 'WEREWOLF' | 'MASON' | 'DEAD'; status: string; access: string }>;
}

function initials(name: string): string {
  return name.split(/\s+/u).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function deadlineLabel(deadline: string | null): string {
  if (!deadline) return 'Awaiting moderator';
  const milliseconds = new Date(deadline).valueOf() - Date.now();
  if (milliseconds <= 0) return 'Closing now';
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${remainder}m`;
}

function PublicWelcome() {
  return (
    <main className="welcome-shell">
      <div className="welcome-moon" aria-hidden="true">☾</div>
      <section className="welcome-card">
        <Link className="brand" href="/" aria-label="Watercooler Werewolf home">
          <span className="brand-mark" aria-hidden="true"><span className="brand-moon" /><span className="brand-cup" /></span>
          <span><strong>Watercooler</strong><small>Werewolf</small></span>
        </Link>
        <p className="eyebrow accent">A slow-burn social deduction game</p>
        <h1>Suspicion fits neatly between meetings.</h1>
        <p>Private roles, official ballots, and moderator-reviewed outcomes—designed for a month of office intrigue.</p>
        <div className="button-row">
          <Link className="primary-link" href="/player-login">Player sign-in</Link>
          <Link className="secondary-link" href="/moderator">Moderator console</Link>
        </div>
        <small>Have an invite link? Open it directly to claim your private seat.</small>
      </section>
    </main>
  );
}

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackError, setFeedbackError] = useState('');

  const refresh = useCallback(async () => {
    const response = await fetch('/api/player');
    if (response.status === 401) {
      setUnauthenticated(true);
      setLoading(false);
      return;
    }
    const result = await response.json() as DashboardData & { error?: string };
    if (!response.ok) throw new Error(result.error ?? 'Unable to load the game.');
    setData(result);
    setSelected(result.currentAction?.targetIds ?? []);
    setUnauthenticated(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Unable to load the game.');
        setLoading(false);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  function toggleCandidate(id: string) {
    if (!data) return;
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= data.permission.maxTargets) return current;
      return [...current, id];
    });
  }

  async function submitAction() {
    if (!data?.phase || !data.permission.actionKind) return;
    setError('');
    const response = await fetch(`/api/phases/${data.phase.id}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actionKind: data.permission.actionKind, targetIds: selected }),
    });
    const result = await response.json() as { error?: string; errors?: string[]; version?: number };
    if (!response.ok) return setError(result.error ?? result.errors?.join(' ') ?? 'Unable to submit your action.');
    setMessage(`Response saved as revision ${result.version}. You can change it until the phase locks.`);
    await refresh();
  }

  async function signOut() {
    await fetch('/api/seats/logout', { method: 'POST' });
    window.location.href = '/';
  }

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedbackError('');
    setFeedbackMessage('');
    const form = event.currentTarget;
    const formData = new FormData(form);
    const response = await fetch(`/api/games/${data?.game.id}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating: Number(formData.get('rating')), comment: formData.get('comment') }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setFeedbackError(result.error ?? 'Unable to save feedback.');
      return;
    }
    form.reset();
    setFeedbackMessage('Thanks — your feedback is recorded privately for the pilot review.');
  }

  const selectedNames = useMemo(
    () => selected.map((id) => data?.candidates.find((candidate) => candidate.id === id)?.displayName).filter(Boolean),
    [data?.candidates, selected],
  );

  if (loading) return <main className="setup-shell"><p className="setup-loading">Opening the village…</p></main>;
  if (unauthenticated) return <PublicWelcome />;
  if (!data) return <main className="setup-shell centered"><section className="auth-card"><h1>The village is out of reach.</h1><p>{error}</p><Link className="primary-link" href="/player-login">Try signing in</Link></section></main>;

  const role = data.player.roleDefinition;
  const phaseTitle = data.game.status === 'STOPPED'
    ? 'The moderator has stopped this campaign.'
    : data.phase
    ? data.phase.status === 'PENDING_HUNTER'
      ? 'The village is holding its breath.'
      : data.phase.status === 'PENDING_APPROVAL'
        ? 'The moderator is reviewing the outcome.'
        : data.phase.kind === 'NIGHT'
          ? 'Night has fallen.'
          : 'The village is voting.'
    : data.game.status === 'COMPLETED'
      ? 'The campaign is complete.'
      : 'The village is between phases.';

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Watercooler Werewolf home">
          <span className="brand-mark" aria-hidden="true"><span className="brand-moon" /><span className="brand-cup" /></span>
          <span><strong>Watercooler</strong><small>Werewolf</small></span>
        </a>
        <div className="game-switcher"><span className="status-dot" aria-hidden="true" />{data.game.name}<span className="chevron" aria-hidden="true">⌄</span></div>
        <div className="profile">
          <div className="avatar">{initials(data.player.displayName)}</div>
          <span className="profile-name">{data.player.displayName}</span>
          <button className="icon-button signout-button" aria-label="Sign out" onClick={signOut}>↗</button>
        </div>
      </header>

      <div className="workspace" id="top">
        <nav className="mobile-nav" aria-label="Game sections">
          <a href="#today">Today</a>
          {data.player.teammates.length > 0 && <a href="#team">Teammates</a>}
          {data.rooms.length > 0 && <a href="#private-room">Private room</a>}
          <a href="#timeline">Timeline</a>
          {data.notifications.length > 0 && <a href="#notifications">Updates</a>}
          <a href="#feedback">Feedback</a>
        </nav>
        <aside className="sidebar" aria-label="Game navigation">
          <p className="eyebrow">Game room</p>
          <nav>
            <a className="nav-item active" href="#today"><span>◐</span>Today</a>
            <a className="nav-item" href="#timeline"><span>≋</span>Timeline</a>
            {data.rooms.length > 0 && <a className="nav-item" href="#private-room"><span>◆</span>Private room</a>}
          </nav>
          <div className="sidebar-rule" />
          <p className="eyebrow">Your game</p>
          <div className="mini-stat"><span>Cycle</span><strong>{String(data.phase?.sequence ?? 0).padStart(2, '0')}</strong></div>
          <div className="mini-stat"><span>Living</span><strong>{data.game.counts.living}</strong></div>
          <div className="mini-stat"><span>Eliminated</span><strong>{data.game.counts.total - data.game.counts.living}</strong></div>
          <div className="sidebar-note"><span aria-hidden="true">☾</span><p><strong>Keep it quiet.</strong>Your role is private until you are eliminated.</p></div>
        </aside>

        <section className="main-column" id="today">
          <div className="welcome-row">
            <div><p className="eyebrow accent">{data.phase ? `${data.phase.kind.replaceAll('_', ' ')} · Cycle ${data.phase.sequence}` : data.game.status.replaceAll('_', ' ')}</p><h1>{phaseTitle}</h1><p>{data.permission.label}</p></div>
            <div className="deadline-card"><span>Response window</span><strong>{deadlineLabel(data.phase?.deadline ?? null)}</strong><small>{data.phase?.status.replaceAll('_', ' ') ?? 'No open phase'}</small></div>
          </div>
          {data.game.status === 'STOPPED' && <p className="notice warning" role="status">{data.game.stopReason ?? 'This game is stopped. Player actions and rooms are read-only.'}</p>}

          <section className={`role-card ${data.player.alive ? '' : 'eliminated-role'}`}>
            <div className="role-orbit"><span aria-hidden="true">{data.player.role === 'WEREWOLF' ? '☾' : data.player.role === 'SEER' ? '◉' : data.player.role === 'BODYGUARD' ? '✚' : '◆'}</span></div>
            <div className="role-copy"><p className="eyebrow">Your private role</p><h2>{role?.name ?? 'Not released'}</h2><p>{data.player.alive ? role?.summary ?? 'The moderator is preparing assignments.' : 'You have been eliminated. Your role is now public and you may spectate.'}</p></div>
            <div className="role-faction"><span>Faction</span><strong>{role?.faction ?? 'Hidden'}</strong><small>{data.player.alive ? 'You are alive' : 'Eliminated'}</small></div>
          </section>

          {data.permission.actionKind && data.phase ? (
            <section className="ballot-card">
              <div className="card-heading"><h2>{data.permission.label}</h2><span className="submission-count">{data.participation.submitted}/{data.participation.eligible} submitted</span></div>
              <div className="selection-summary"><span>{selected.length} / {data.permission.maxTargets} selected</span><div className="progress-track"><span style={{ width: `${(selected.length / data.permission.maxTargets) * 100}%` }} /></div><small>{selectedNames.join(' · ') || 'Choose living players below'}</small></div>
              <div className="candidate-grid">
                {data.candidates.map((candidate) => {
                  const isSelected = selected.includes(candidate.id);
                  return <button className={`candidate ${isSelected ? 'selected' : ''}`} key={candidate.id} onClick={() => toggleCandidate(candidate.id)} aria-pressed={isSelected}><span className="candidate-avatar">{initials(candidate.displayName)}</span><span><strong>{candidate.displayName}</strong><small>Living player</small></span><span className="check">{isSelected ? '✓' : ''}</span></button>;
                })}
              </div>
              {error && <p className="form-error" role="alert">{error}</p>}
              {message && <p className="action-success" role="status">{message}</p>}
              <div className="ballot-footer"><p><span>●</span> Your latest revision counts when the phase locks.</p><button className="primary-button" type="button" onClick={submitAction} disabled={selected.length === 0}>Save response</button></div>
            </section>
          ) : (
            <section className="ballot-card waiting-card"><span className="waiting-icon" aria-hidden="true">◐</span><div><h2>{data.permission.label}</h2><p>{data.player.alive ? 'You can step away. This page will show the next official action when it opens.' : 'Published outcomes and game announcements will continue to appear here.'}</p></div><button className="secondary-button" onClick={() => void refresh()}>Check for updates</button></section>
          )}
        </section>

        <aside className="right-rail">
          {data.notifications[0] && <section className="rail-card announcement" id="notifications"><p className="eyebrow">Private result</p><h2>{data.notifications[0].title}</h2><p>{data.notifications[0].body}</p><small>{new Date(data.notifications[0].createdAt).toLocaleString()}</small></section>}
          {data.player.teammates.length > 0 && <section className="rail-card" id="team"><div className="rail-heading"><h2>{data.player.role === 'WEREWOLF' ? 'Your pack' : 'Fellow Masons'}</h2><span>{data.player.teammates.length}</span></div><div className="player-stack">{data.player.teammates.map((teammate) => <div className="player-row" key={teammate.id}><span className="candidate-avatar small">{initials(teammate.displayName)}</span><span><strong>{teammate.displayName}</strong><small>{teammate.alive ? 'Living' : 'Eliminated'}</small></span><span className={`ready-dot ${teammate.alive ? 'ready' : ''}`} /></div>)}</div></section>}
          {data.rooms.length > 0 && <PrivateRoomChat rooms={data.rooms} />}
          <section className="rail-card" id="timeline"><div className="rail-heading"><h2>Official timeline</h2><span>{data.timeline.length}</span></div>{data.timeline.length ? <div className="timeline-mini">{data.timeline.map((event) => <article key={event.id}><strong>{event.eventType === 'GAME_COMPLETED' ? `${event.payload.winner} wins` : event.eventType === 'GAME_STOPPED' ? 'Campaign stopped' : event.eventType === 'FINAL_SHOWDOWN_ENTERED' ? 'Final showdown entered' : event.eventType === 'ANNOUNCEMENT' ? event.payload.title : `${event.payload.kind} resolved`}</strong><p>{event.eventType === 'ANNOUNCEMENT' ? event.payload.body : event.eventType === 'GAME_STOPPED' ? 'Player actions are blocked and rooms are read-only.' : event.eventType === 'FINAL_SHOWDOWN_ENTERED' ? 'The final ballot is now the only legal phase.' : event.payload.eliminations?.length ? event.payload.eliminations.map((item) => `${item.displayName} · ${item.role}`).join(', ') : 'No elimination published.'}</p><small>{new Date(event.createdAt).toLocaleString()}</small></article>)}</div> : <p>No published outcomes yet.</p>}</section>
          <section className="rail-card pilot-feedback-card" id="feedback"><div className="rail-heading"><h2>Pilot feedback</h2><span aria-hidden="true">?</span></div><p>Share a quick signal with the moderator team. This is private to the pilot operators.</p><form className="chat-compose" onSubmit={submitFeedback}><label>Rating<select name="rating" defaultValue="5"><option value="5">5 — excellent</option><option value="4">4 — good</option><option value="3">3 — mixed</option><option value="2">2 — difficult</option><option value="1">1 — blocked</option></select></label><label>Comment<textarea name="comment" rows={3} maxLength={2000} placeholder="What should we improve?" /></label>{feedbackError && <p className="form-error" role="alert">{feedbackError}</p>}{feedbackMessage && <p className="action-success" role="status">{feedbackMessage}</p>}<button className="secondary-button" type="submit">Send feedback</button></form></section>
          <section className="rail-card moon-card"><div className="moon-art" aria-hidden="true">☾</div><p className="eyebrow">Privacy reminder</p><h2>Talk freely. Keep screenshots private.</h2><p>Official actions only count when submitted here.</p></section>
        </aside>
      </div>
    </main>
  );
}
