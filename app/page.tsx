'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- the public entry links intentionally use full-page navigation. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import PrivateRoomChat from './private-room-chat';

type RoleKey = 'VILLAGER' | 'WEREWOLF' | 'SEER' | 'BODYGUARD' | 'HUNTER' | 'MASON' | 'APPRENTICE_SEER' | 'MAYOR' | 'CUPID';
type ActionKind = 'DAY_VOTE' | 'WOLF_VOTE' | 'INVESTIGATE' | 'PROTECT' | 'HUNTER_SHOT' | 'CUPID_PAIR';

interface DashboardData {
  player: {
    id: string;
    displayName: string;
    alive: boolean;
    role: RoleKey | null;
    roleDefinition: { name: string; faction: string; summary: string } | null;
    teammates: Array<{ id: string; displayName: string; alive: boolean }>;
  };
  game: {
    id: string;
    name: string;
    status: string;
    timezone: string;
    counts: { total: number; living: number; werewolvesRemaining: number };
    livingPlayers: Array<{ id: string; displayName: string }>;
    eliminatedPlayers: Array<{ id: string; displayName: string; role: RoleKey | null }>;
    stopReason?: string | null;
  };
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
      phaseId?: string | null;
      sequence?: number | null;
      title?: string;
      body?: string;
      winner?: string | null;
      eliminations?: Array<{ displayName: string; role: string; cause: string }>;
      votes?: Array<{ actorName: string; targetNames: string[] }>;
      protectedAttackBlocked?: boolean;
    };
  }>;
  notifications: Array<{ id: string; type: string; title: string; body: string; createdAt: string }>;
  notificationsHasMore?: boolean;
  notificationsNextCursor?: { createdAt: string; id: string } | null;
  rooms: Array<{ id: string; type: 'WEREWOLF' | 'MASON' | 'DEAD'; status: string; access: string }>;
}

function initials(name: string): string {
  return name.split(/\s+/u).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function readableRole(role: RoleKey | string | null): string {
  return role
    ? role.toLowerCase().split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    : 'Role unavailable';
}

function roleGlyph(role: RoleKey | null): string {
  if (role === 'WEREWOLF') return '☾';
  if (role === 'SEER') return '◉';
  if (role === 'BODYGUARD') return '✚';
  if (role === 'HUNTER') return '⌖';
  if (role === 'MASON') return '◇';
  if (role === 'APPRENTICE_SEER') return '◉';
  if (role === 'MAYOR') return '♛';
  if (role === 'CUPID') return '♥';
  return '⌂';
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

function roleVisibilityKey(playerId: string): string {
  return `werewolf:v1:role-hidden:${playerId}`;
}

function deathAlertKey(gameId: string, playerId: string): string {
  return `werewolf:v1:death-alert:${gameId}:${playerId}`;
}

function PublicWelcome() {
  return (
    <main className="welcome-shell">
      <div className="welcome-moon" aria-hidden="true">☾</div>
      <section className="welcome-card">
        <a className="brand" href="/" aria-label="Watercooler Werewolf home">
          <span className="brand-mark" aria-hidden="true"><span className="brand-moon" /><span className="brand-cup" /></span>
          <span><strong>Watercooler</strong><small>Werewolf</small></span>
        </a>
        <p className="eyebrow accent">A slow-burn social deduction game</p>
        <h1>Suspicion fits neatly between meetings.</h1>
        <p>Private roles, official ballots, and moderator-reviewed outcomes—designed for a month of office intrigue.</p>
        <div className="button-row">
          <a className="primary-link" href="/player-login">Player sign-in</a>
          <a className="secondary-link" href="/moderator">Moderator console</a>
        </div>
        <small>Have an invite link? Open it directly to claim your private seat.</small>
      </section>
    </main>
  );
}

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackError, setFeedbackError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [loadingOlderNotifications, setLoadingOlderNotifications] = useState(false);
  const [roleThemeEnabled, setRoleThemeEnabled] = useState(false);
  const [roleHidden, setRoleHidden] = useState(false);
  const [deathAlert, setDeathAlert] = useState<DashboardData['timeline'][number] | null>(null);
  const [selectedTimeline, setSelectedTimeline] = useState<DashboardData['timeline'][number] | null>(null);
  const activeModal = deathAlert ? 'death' : selectedTimeline ? 'votes' : null;
  const modalState = useRef<{
    deathAlert: DashboardData['timeline'][number] | null;
    selectedTimeline: DashboardData['timeline'][number] | null;
    data: DashboardData | null;
  }>({ deathAlert: null, selectedTimeline: null, data: null });
  const selectionDirty = useRef(false);
  const selectionPhaseId = useRef<string | null>(null);
  const olderNotifications = useRef<DashboardData['notifications']>([]);
  const refreshSequence = useRef(0);

  useLayoutEffect(() => {
    modalState.current = { deathAlert, selectedTimeline, data };
  }, [deathAlert, selectedTimeline, data]);

  const refresh = useCallback(async (preserveLocalSelection = false) => {
    const sequence = ++refreshSequence.current;
    const response = await fetch('/api/player');
    if (sequence !== refreshSequence.current) return;
    if (response.status === 401) {
      setUnauthenticated(true);
      setLoading(false);
      return;
    }
    const result = await response.json() as DashboardData & { error?: string };
    if (!response.ok) throw new Error(result.error ?? 'Unable to load the game.');
    if (sequence !== refreshSequence.current) return;
    const incomingPhaseId = result.phase?.id ?? null;
    const keepLocalSelection = preserveLocalSelection
      && selectionDirty.current
      && selectionPhaseId.current === incomingPhaseId;
    const notificationIds = new Set(result.notifications.map((notification) => notification.id));
    const mergedNotifications = [
      ...result.notifications,
      ...olderNotifications.current.filter((older) => !notificationIds.has(older.id)),
    ];
    setData({ ...result, notifications: mergedNotifications });
    const latestDeath = result.timeline.find((event) => event.eventType === 'PHASE_PUBLISHED' && event.payload.eliminations?.length);
    if (latestDeath) {
      const seenKey = deathAlertKey(result.game.id, result.player.id);
      if (window.localStorage.getItem(seenKey) !== latestDeath.id) setDeathAlert(latestDeath);
    }
    if (!keepLocalSelection) {
      setSelected(result.currentAction?.targetIds ?? []);
      selectionDirty.current = false;
    }
    selectionPhaseId.current = incomingPhaseId;
    setUnauthenticated(false);
    setLoading(false);
  }, []);

  async function loadOlderNotifications() {
    if (!data?.notificationsNextCursor || loadingOlderNotifications) return;
    const sequence = ++refreshSequence.current;
    setLoadingOlderNotifications(true);
    try {
      const params = new URLSearchParams({
        notificationBefore: data.notificationsNextCursor.createdAt,
        notificationBeforeId: data.notificationsNextCursor.id,
      });
      const response = await fetch(`/api/player?${params.toString()}`);
      const result = await response.json() as DashboardData & { error?: string };
      if (sequence !== refreshSequence.current) return;
      if (!response.ok) throw new Error(result.error ?? 'Unable to load older updates.');
      setData((current) => {
        if (!current) return current;
        const notificationIds = new Set(current.notifications.map((notification) => notification.id));
        const merged = [
          ...current.notifications,
          ...result.notifications.filter((incoming) => !notificationIds.has(incoming.id)),
        ];
        olderNotifications.current = merged.slice(result.notifications.length);
        return { ...current, notifications: merged, notificationsHasMore: result.notificationsHasMore, notificationsNextCursor: result.notificationsNextCursor };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load older updates.');
    } finally {
      setLoadingOlderNotifications(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Unable to load the game.');
        setLoading(false);
      });
    }, 0);
    const poll = window.setInterval(() => {
      void refresh(true).catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Unable to refresh the game.');
      });
    }, 10_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, [refresh]);

  useLayoutEffect(() => {
    if (!data?.player.id) return;
    setRoleHidden(window.localStorage.getItem(roleVisibilityKey(data.player.id)) === 'true');
  }, [data?.player.id]);

  useEffect(() => {
    if (!activeModal) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    const focusable = dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.item(0)?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      const current = modalState.current;
      if (event.key === 'Escape' && current.deathAlert) {
        event.preventDefault();
        if (current.data) {
          window.localStorage.setItem(deathAlertKey(current.data.game.id, current.data.player.id), current.deathAlert.id);
        }
        setDeathAlert(null);
        return;
      }
      if (event.key === 'Escape' && current.selectedTimeline) {
        event.preventDefault();
        setSelectedTimeline(null);
        return;
      }
      if (event.key !== 'Tab' || !dialog || !focusable?.length) return;
      const first = focusable.item(0);
      const last = focusable.item(focusable.length - 1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [activeModal]);

  function toggleCandidate(id: string) {
    if (!data) return;
    selectionDirty.current = true;
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (data.permission.maxTargets === 1) return [id];
      if (current.length >= data.permission.maxTargets) return current;
      return [...current, id];
    });
  }

  async function submitAction() {
    if (!data?.phase || !data.permission.actionKind || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch(`/api/phases/${data.phase.id}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actionKind: data.permission.actionKind, targetIds: selected }),
      });
      const result = await response.json() as { error?: string; errors?: string[]; version?: number };
      if (!response.ok) {
        setError(result.error ?? result.errors?.join(' ') ?? 'Unable to submit your action.');
        return;
      }
      selectionDirty.current = false;
      setMessage(`Response saved as revision ${result.version}. You can change it until the phase locks.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to submit your action.');
    } finally {
      setSubmitting(false);
    }
  }

  async function signOut() {
    await fetch('/api/seats/logout', { method: 'POST' });
    router.push('/');
  }

  function toggleRoleTheme() {
    if (!data?.player.role) return;
    setRoleThemeEnabled((current) => !current);
  }

  function toggleRoleVisibility() {
    if (!data?.player.id) return;
    setRoleHidden((current) => {
      const next = !current;
      window.localStorage.setItem(roleVisibilityKey(data.player.id), String(next));
      return next;
    });
  }

  function dismissDeathAlert() {
    if (deathAlert && data) {
      window.localStorage.setItem(deathAlertKey(data.game.id, data.player.id), deathAlert.id);
    }
    setDeathAlert(null);
  }

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendingFeedback) return;
    setFeedbackError('');
    setFeedbackMessage('');
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSendingFeedback(true);
    try {
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
    } catch (caught) {
      setFeedbackError(caught instanceof Error ? caught.message : 'Unable to save feedback.');
    } finally {
      setSendingFeedback(false);
    }
  }

  if (loading) return <main className="setup-shell"><p className="setup-loading">Opening the village…</p></main>;
  if (unauthenticated) return <PublicWelcome />;
  if (!data) return <main className="setup-shell centered"><section className="auth-card"><h1>The village is out of reach.</h1><p>{error}</p><a className="primary-link" href="/player-login">Try signing in</a></section></main>;

  const selectedNames = selected.map((id) => data.candidates.find((candidate) => candidate.id === id)?.displayName).filter(Boolean);
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

  const roleThemeClass = roleThemeEnabled && !roleHidden && data.player.role ? ` role-theme role-theme-${data.player.role.toLowerCase()}` : '';

  return (
    <main className={`app-shell${roleThemeClass}`}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Watercooler Werewolf home">
          <span className="brand-mark" aria-hidden="true"><span className="brand-moon" /><span className="brand-cup" /></span>
          <span><strong>Watercooler</strong><small>Werewolf</small></span>
        </a>
        <div className="game-switcher"><span className="status-dot" aria-hidden="true" />{data.game.name}<span className="chevron" aria-hidden="true">⌄</span></div>
        <div className="profile">
          <button className="theme-toggle" type="button" role="switch" aria-checked={roleThemeEnabled} aria-label={`Role theme ${roleThemeEnabled ? 'on' : 'off'}`} onClick={toggleRoleTheme} disabled={!data.player.role}>
            <span className="theme-toggle-track" aria-hidden="true"><span /></span>
            <span className="theme-toggle-label">Theme</span>
          </button>
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
          <details className="stat-details">
            <summary className="mini-stat stat-trigger"><span>Living</span><strong>{data.game.counts.living}</strong></summary>
            <div className="stat-popover" aria-label="Living players">
              {data.game.livingPlayers.length ? data.game.livingPlayers.map((player) => <div className="stat-player" key={player.id}><span className="candidate-avatar small">{initials(player.displayName)}</span><strong>{player.displayName}</strong></div>) : <p className="empty-note">No living players.</p>}
            </div>
          </details>
          <details className="stat-details">
            <summary className="mini-stat stat-trigger"><span>Eliminated</span><strong>{data.game.counts.total - data.game.counts.living}</strong></summary>
            <div className="stat-popover" aria-label="Eliminated players">
              {data.game.eliminatedPlayers.length ? data.game.eliminatedPlayers.map((player) => <div className="stat-player eliminated-player" key={player.id}><span className="candidate-avatar small">{initials(player.displayName)}</span><span><strong>{player.displayName}</strong><small>{readableRole(player.role)}</small></span></div>) : <p className="empty-note">No one has been eliminated.</p>}
            </div>
          </details>
          <div className="mini-stat wolf-stat"><span>Werewolves left</span><strong>{data.game.counts.werewolvesRemaining}</strong></div>
          <div className="sidebar-note"><span aria-hidden="true">☾</span><p><strong>Keep it quiet.</strong>Your role is private until you are eliminated.</p></div>
        </aside>

        <section className="main-column" id="today">
          <div className="welcome-row">
            <div><p className="eyebrow accent">{data.phase ? `${data.phase.kind.replaceAll('_', ' ')} · Cycle ${data.phase.sequence}` : data.game.status.replaceAll('_', ' ')}</p><h1>{phaseTitle}</h1><p>{data.permission.label}</p></div>
            <div className="deadline-card"><span>Response window</span><strong>{data.game.status === 'COMPLETED' ? 'Complete' : data.game.status === 'STOPPED' ? 'Stopped' : deadlineLabel(data.phase?.deadline ?? null)}</strong><small>{data.phase?.status.replaceAll('_', ' ') ?? (data.game.status === 'COMPLETED' ? 'Campaign complete' : 'No open phase')}</small></div>
          </div>
          {data.game.status === 'STOPPED' && <p className="notice warning" role="status">{data.game.stopReason ?? 'This game is stopped. Player actions and rooms are read-only.'}</p>}

          <section className={`role-card ${data.player.alive ? '' : 'eliminated-role'}`}>
            {!data.player.alive && <span className="eliminated-banner" role="status">☠ Eliminated · spectator mode</span>}
            <div className="role-orbit"><span aria-hidden="true">{roleHidden ? '⌂' : roleGlyph(data.player.role)}</span></div>
            <div className="role-copy">
              <div className="role-copy-heading"><p className="eyebrow">{roleHidden ? 'Private role · concealed' : 'Your private role'}</p><button className="role-visibility-toggle" type="button" aria-pressed={roleHidden} onClick={toggleRoleVisibility}>{roleHidden ? 'Show role' : 'Hide role'}</button></div>
              <h2>{roleHidden ? 'Hidden' : role?.name ?? 'Not released'}</h2>
              <p>{roleHidden ? 'Your role and role details are hidden on this device.' : data.player.alive ? role?.summary ?? 'The moderator is preparing assignments.' : 'You have been eliminated. Your role is now public and you may spectate.'}</p>
            </div>
            <div className="role-faction"><span>Faction</span><strong>{roleHidden ? 'Hidden' : role?.faction ?? 'Hidden'}</strong><small>{data.player.alive ? 'You are alive' : 'Eliminated'}</small></div>
          </section>

          {data.permission.actionKind && data.phase ? (
            <section className="ballot-card">
              <div className="card-heading"><h2>{data.permission.label}</h2><span className="submission-count">{data.participation.submitted}/{data.participation.eligible} submitted</span></div>
              <div className="selection-summary"><span>{selected.length} / {data.permission.maxTargets} selected</span><div className="progress-track"><span style={{ width: `${(selected.length / data.permission.maxTargets) * 100}%` }} /></div><small>{selectedNames.join(' · ') || 'Choose living players below'}</small></div>
              <div className="candidate-grid">
                {data.candidates.map((candidate) => {
                  const isSelected = selected.includes(candidate.id);
                  return <button className={`candidate ${isSelected ? 'selected' : ''}`} key={candidate.id} type="button" onClick={() => toggleCandidate(candidate.id)} aria-pressed={isSelected} disabled={submitting}><span className="candidate-avatar">{initials(candidate.displayName)}</span><span><strong>{candidate.displayName}</strong><small>Living player</small></span><span className="check">{isSelected ? '✓' : ''}</span></button>;
                })}
              </div>
              {error && <p className="form-error" role="alert">{error}</p>}
              {message && <p className="action-success" role="status">{message}</p>}
              <div className="ballot-footer"><p><span>●</span> Your latest revision counts when the phase locks.</p><button className="primary-button" type="button" onClick={submitAction} disabled={submitting || selected.length === 0 || (data.permission.actionKind === 'CUPID_PAIR' && selected.length !== 2)}>{submitting ? 'Saving…' : 'Save response'}</button></div>
            </section>
          ) : (
            <section className="ballot-card waiting-card"><span className="waiting-icon" aria-hidden="true">◐</span><div><h2>{data.permission.label}</h2><p>{data.game.status === 'COMPLETED' ? 'This campaign is complete. Review the official timeline and your private result history below.' : data.player.alive ? 'You can step away. This page will show the next official action when it opens.' : 'Published outcomes and game announcements will continue to appear here.'}</p></div><button className="secondary-button" onClick={() => void refresh()}>Check for updates</button></section>
          )}
        </section>

        <aside className="right-rail">
          {data.notifications.length > 0 && <section className="rail-card announcement" id="notifications"><div className="rail-heading"><div><p className="eyebrow">Your updates</p><h2>Private result history</h2></div><span>{data.notifications.length}</span></div><div className="timeline-mini">{data.notifications.map((notification) => <article key={notification.id}><strong>{notification.type === 'ANNOUNCEMENT' ? 'Announcement' : notification.type === 'LOVER_BOND' ? 'Cupid’s pairing' : 'Private investigation'}</strong><h3>{notification.title}</h3><p>{notification.body}</p><small>{new Date(notification.createdAt).toLocaleString()}</small></article>)}</div>{data.notificationsHasMore && <button className="secondary-button" type="button" onClick={() => void loadOlderNotifications()} disabled={loadingOlderNotifications}>{loadingOlderNotifications ? 'Loading older updates…' : 'Load older updates'}</button>}</section>}
          {data.player.teammates.length > 0 && <section className="rail-card" id="team"><div className="rail-heading"><h2>{data.player.role === 'WEREWOLF' ? 'Your pack' : 'Fellow Masons'}</h2><span>{data.player.teammates.length}</span></div><div className="player-stack">{data.player.teammates.map((teammate) => <div className="player-row" key={teammate.id}><span className="candidate-avatar small">{initials(teammate.displayName)}</span><span><strong>{teammate.displayName}</strong><small>{teammate.alive ? 'Living' : 'Eliminated'}</small></span><span className={`ready-dot ${teammate.alive ? 'ready' : ''}`} /></div>)}</div></section>}
          {data.rooms.length > 0 && <PrivateRoomChat rooms={data.rooms} />}
          <section className="rail-card" id="timeline">
            <div className="rail-heading"><h2>Official timeline</h2><span>{data.timeline.length}</span></div>
            {data.timeline.length ? <div className="timeline-mini">{data.timeline.map((event) => {
              const isPublishedPhase = event.eventType === 'PHASE_PUBLISHED';
              const isPublicBallot = isPublishedPhase && ['DAY', 'FINAL_BALLOT'].includes(event.payload.kind ?? '');
              const title = event.eventType === 'GAME_COMPLETED'
                ? `${event.payload.winner} wins`
                : event.eventType === 'GAME_STOPPED'
                  ? 'Campaign stopped'
                  : event.eventType === 'FINAL_SHOWDOWN_ENTERED'
                    ? 'Final showdown entered'
                    : event.eventType === 'ANNOUNCEMENT'
                      ? event.payload.title
                      : `${event.payload.kind}${event.payload.sequence ? ` · Cycle ${event.payload.sequence}` : ''} resolved`;
              const description = event.eventType === 'ANNOUNCEMENT'
                ? event.payload.body
                : event.eventType === 'GAME_STOPPED'
                  ? 'Player actions are blocked and rooms are read-only.'
                  : event.eventType === 'FINAL_SHOWDOWN_ENTERED'
                    ? 'The final ballot is now the only legal phase.'
                    : event.payload.eliminations?.length
                      ? `${event.payload.eliminations.map((item) => `${item.displayName} · ${readableRole(item.role)}${item.cause === 'LOVER_BOND' ? ' · lover bond' : item.cause === 'HUNTER_SHOT' ? ' · Hunter shot' : ''}`).join(', ')}${event.payload.protectedAttackBlocked ? ' · Bodyguard protection stopped a pack attack.' : ''}`
                      : event.payload.protectedAttackBlocked
                        ? 'Bodyguard protection stopped a pack attack. No one died.'
                        : 'No elimination published.';
              if (!isPublicBallot) {
                return <article key={event.id}><strong>{title}</strong><p>{description}</p><small>{new Date(event.createdAt).toLocaleString()}</small></article>;
              }
              return <article className="timeline-entry" key={event.id}>
                <button className="timeline-trigger" type="button" onClick={() => setSelectedTimeline(event)} aria-label={`View votes for ${title}`}>
                  <span className="timeline-summary-copy"><strong>{title}</strong><span>{description}</span><small>{new Date(event.createdAt).toLocaleString()}</small></span>
                  <span className="timeline-summary-hint">View votes</span>
                </button>
              </article>;
            })}</div> : <p>No published outcomes yet.</p>}
          </section>
          <section className="rail-card pilot-feedback-card" id="feedback"><div className="rail-heading"><h2>Pilot feedback</h2><span aria-hidden="true">?</span></div><p>Share a quick signal with the moderator team. This is private to the pilot operators.</p><form className="chat-compose" onSubmit={submitFeedback}><label>Rating<select name="rating" defaultValue="5"><option value="5">5 — excellent</option><option value="4">4 — good</option><option value="3">3 — mixed</option><option value="2">2 — difficult</option><option value="1">1 — blocked</option></select></label><label>Comment<textarea name="comment" rows={3} maxLength={2000} placeholder="What should we improve?" /></label>{feedbackError && <p className="form-error" role="alert">{feedbackError}</p>}{feedbackMessage && <p className="action-success" role="status">{feedbackMessage}</p>}<button className="secondary-button" type="submit" disabled={sendingFeedback}>{sendingFeedback ? 'Sending…' : 'Send feedback'}</button></form></section>
          <section className="rail-card moon-card"><div className="moon-art" aria-hidden="true">☾</div><p className="eyebrow">Privacy reminder</p><h2>Talk freely. Keep screenshots private.</h2><p>Official actions only count when submitted here.</p></section>
        </aside>
      </div>
      {deathAlert && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) dismissDeathAlert(); }}>
        <section className="game-modal death-modal" role="dialog" aria-modal="true" aria-labelledby="death-alert-title">
          <div className="modal-symbol" aria-hidden="true">☠</div>
          <p className="eyebrow accent">Official game update</p>
          <h2 id="death-alert-title">A player has been eliminated</h2>
          <p className="modal-intro">{deathAlert.payload.kind?.replaceAll('_', ' ') ?? 'The latest phase'} · Cycle {deathAlert.payload.sequence ?? '—'}</p>
          <div className="death-list">{deathAlert.payload.eliminations?.map((elimination) => <article key={`${deathAlert.id}-${elimination.displayName}`}><strong>{elimination.displayName}</strong><span>{readableRole(elimination.role)}{elimination.cause === 'LOVER_BOND' ? ' · lover bond' : elimination.cause === 'HUNTER_SHOT' ? ' · Hunter shot' : ''}</span></article>)}</div>
          <button className="primary-button" type="button" onClick={dismissDeathAlert}>I understand</button>
        </section>
      </div>}
      {selectedTimeline && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedTimeline(null); }}>
        <section className="game-modal timeline-modal" role="dialog" aria-modal="true" aria-labelledby="timeline-modal-title">
          <div className="modal-heading"><div><p className="eyebrow accent">Published ballot</p><h2 id="timeline-modal-title">{selectedTimeline.payload.kind}{selectedTimeline.payload.sequence ? ` · Cycle ${selectedTimeline.payload.sequence}` : ''}</h2><p className="modal-intro">{selectedTimeline.payload.eliminations?.length ? selectedTimeline.payload.eliminations.map((item) => `${item.displayName} · ${readableRole(item.role)}`).join(', ') : 'No elimination published.'}</p></div><button className="icon-button modal-close" type="button" aria-label="Close vote details" onClick={() => setSelectedTimeline(null)}>×</button></div>
          {selectedTimeline.payload.votes?.length ? <div className="vote-ledger">{selectedTimeline.payload.votes.map((vote, index) => <div className="vote-ledger-row" key={`${selectedTimeline.id}-${vote.actorName}-${index}`}><strong>{vote.actorName}</strong><span aria-hidden="true">→</span><span>{vote.targetNames.length ? vote.targetNames.join(', ') : 'No target recorded'}</span></div>)}</div> : <p className="empty-note">No public Day votes were recorded.</p>}
          <p className="timeline-privacy-note">Published Day ballots are public. Night actions and special-role actions remain private.</p>
        </section>
      </div>}
    </main>
  );
}
