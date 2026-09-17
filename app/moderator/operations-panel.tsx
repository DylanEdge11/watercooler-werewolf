'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface Operations {
  viewerRole: string | null;
  game: { name: string; status: string; chatRetentionDays: number; finalCutoffAt: string; stoppedAt?: string | null; stopReason?: string | null };
  counts: { total: number; claimed: number; living: number };
  seats: Array<{ id: string; displayName: string; status: string }>;
  overduePhase: null | { id: string; kind: string; closesAt: string };
  reconciledPhaseIds?: string[];
  activePlayerSessions: number;
  activity: { submittedActions: number; lateRejections: number; lastActionAt: string | null };
  lastBackup: null | { exportedAt: string; checksum: string };
  backups: Array<{ id: string; schemaVersion: number; exportedAt: string; checksum: string }>;
  events: Array<{ id: string; severity: string; source: string; message: string; createdAt: string }>;
}

interface Room {
  id: string;
  type: string;
  status: string;
  memberCount: number;
  messageCount: number;
}

interface RoomMessage {
  id: string;
  roomType: string;
  authorName: string;
  body: string | null;
  createdAt: string;
}

interface Moderator {
  id: string;
  email: string;
  role: string;
}

async function parse<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Request failed.');
  return data;
}

export default function OperationsPanel({ gameId, refreshToken = 0, onGameChanged }: { gameId: string; refreshToken?: number; onGameChanged?: () => void }) {
  const router = useRouter();
  const [operations, setOperations] = useState<Operations | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [moderators, setModerators] = useState<Moderator[]>([]);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [pinSeatId, setPinSeatId] = useState('');
  const [restoreBackupId, setRestoreBackupId] = useState('');
  const [restoreInviteCsv, setRestoreInviteCsv] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const [ops, roomData, moderatorData] = await Promise.all([
      parse<Operations>(await fetch(`/api/games/${gameId}/operations`)),
      parse<{ rooms: Room[]; recentMessages: RoomMessage[] }>(await fetch(`/api/games/${gameId}/rooms`)),
      parse<{ moderators: Moderator[] }>(await fetch(`/api/games/${gameId}/moderators`)),
    ]);
    if (sequence !== refreshSequence.current) return;
    setOperations(ops);
    setRooms(roomData.rooms);
    setMessages(roomData.recentMessages);
    setModerators(moderatorData.moderators);
    setRestoreBackupId((current) => current && ops.backups?.some((backup) => backup.id === current) ? current : ops.backups?.[0]?.id ?? '');
  }, [gameId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load operations.'));
    }, 0);
    const poll = window.setInterval(() => {
      void refresh().catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to refresh operations.'));
    }, 10_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, [refresh, refreshToken]);

  async function post(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await parse(response);
  }

  async function announce(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await post(`/api/games/${gameId}/announcements`, { title: data.get('title'), body: data.get('body') });
      form.reset();
      setMessage('Announcement published in-app. Email-ready copy was generated with it.');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to publish announcement.');
    }
  }

  async function addModerator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const result = await parse<{ recoveryCodes: string[] }>(await fetch(`/api/games/${gameId}/moderators`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
      }));
      setRecoveryCodes(result.recoveryCodes);
      form.reset();
      setMessage('Co-moderator access added.');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to add co-moderator.');
    }
  }

  async function resetPlayerPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await post(`/api/games/${gameId}/operations`, {
        action: 'RESET_PLAYER_PIN',
        seatId: data.get('seatId'),
        newPin: data.get('newPin'),
        reason: data.get('reason'),
      });
      form.reset();
      setPinSeatId('');
      setMessage('Player PIN replaced and all prior player sessions were invalidated. Share the new PIN privately.');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to reset the player PIN.');
    }
  }

  async function exportBackup() {
    if (busyAction) return;
    setError('');
    setBusyAction('export');
    try {
      const response = await fetch(`/api/games/${gameId}/export`, { method: 'POST' });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? 'Unable to create backup.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `watercooler-werewolf-${gameId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage('Verified JSON backup created and downloaded.');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create backup.');
    } finally {
      setBusyAction(null);
    }
  }

  async function toggleRoom(room: Room) {
    try {
      await post(`/api/games/${gameId}/rooms`, { action: 'SET_ROOM_STATUS', roomId: room.id, status: room.status === 'OPEN' ? 'READ_ONLY' : 'OPEN' });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update room.');
    }
  }

  async function purgeRetention() {
    try {
      const result = await parse<{ purged: number }>(await fetch(`/api/games/${gameId}/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'PURGE_RETENTION' }),
      }));
      setMessage(`${result.purged} expired message${result.purged === 1 ? '' : 's'} purged.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to purge messages.');
    }
  }

  async function removeMessage(messageId: string) {
    const reason = window.prompt('Why should this message be removed?');
    if (!reason) return;
    try {
      await post(`/api/games/${gameId}/rooms`, { action: 'DELETE_MESSAGE', messageId, reason });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to remove message.');
    }
  }

  async function stopGame() {
    const reason = window.prompt('Why are you stopping this game?');
    if (!reason) return;
    if (!window.confirm('Stop the game now? Active phases will close, player actions will be blocked, and rooms will become read-only.')) return;
    setError('');
    if (busyAction) return;
    setBusyAction('stop');
    try {
      await post(`/api/games/${gameId}/operations`, { action: 'STOP', confirmed: true, reason });
      setMessage('Game stopped. Player actions are blocked and rooms are read-only.');
      await refresh();
      onGameChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to stop the game.');
    } finally {
      setBusyAction(null);
    }
  }

  async function resetGame() {
    const confirmationName = window.prompt(`Type the exact game name to reset: ${operations?.game.name ?? ''}`);
    if (confirmationName === null) return;
    if (!window.confirm('Reset this game to setup? A recoverable backup will be created first, player sessions will be revoked, and active roles/phases/notifications will be removed.')) return;
    setError('');
    if (busyAction) return;
    setBusyAction('reset');
    try {
      await post(`/api/games/${gameId}/operations`, { action: 'RESET', confirmed: true, confirmationName });
      setMessage('Game reset to setup state. Re-import the roster before configuring roles.');
      await refresh();
      onGameChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to reset the game.');
    } finally {
      setBusyAction(null);
    }
  }

  async function restoreBackup() {
    if (!operations || !restoreBackupId || busyAction) return;
    const confirmationName = window.prompt(`Type the exact game name to restore into: ${operations.game.name}`);
    if (confirmationName === null) return;
    if (!window.confirm('Restore this backup to setup state? A safety backup will be created first, all player sessions and old invite links will be invalidated, and active roles/phases/messages will be removed.')) return;
    setError('');
    setBusyAction('restore');
    try {
      const result = await parse<{ inviteRows?: Array<{ displayName: string; email: string; claimUrl: string; inviteCode: string }>; restoredSeatCount: number }>(await fetch(`/api/games/${gameId}/operations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'RESTORE_BACKUP', backupId: restoreBackupId, confirmed: true, confirmationName }),
      }));
      const rows = result.inviteRows ?? [];
      setRestoreInviteCsv(rows.length ? [
        ['display_name', 'email', 'claim_url', 'invite_code'].join(','),
        ...rows.map((row) => [row.displayName, row.email, row.claimUrl, row.inviteCode].map((value) => `"${value.replaceAll('"', '""')}"`).join(',')),
      ].join('\r\n') : '');
      setMessage(`Backup restored to setup with ${result.restoredSeatCount} fresh private seat links. Download the invite CSV now; codes are not shown again.`);
      await refresh();
      onGameChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to restore the backup.');
    } finally {
      setBusyAction(null);
    }
  }

  function downloadRestoredInvites() {
    if (!restoreInviteCsv) return;
    const url = URL.createObjectURL(new Blob([restoreInviteCsv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `watercooler-werewolf-restored-invites-${gameId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function reconcileDeadlines() {
    setError('');
    try {
      const result = await parse<{ lockedPhaseIds: string[] }>(await fetch(`/api/games/${gameId}/operations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'RECONCILE_DEADLINES' }),
      }));
      setMessage(result.lockedPhaseIds.length ? `${result.lockedPhaseIds.length} deadline${result.lockedPhaseIds.length === 1 ? '' : 's'} locked.` : 'No due deadlines found.');
      await refresh();
      onGameChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to reconcile deadlines.');
    }
  }

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await post(`/api/games/${gameId}/feedback`, { rating: Number(data.get('rating')), comment: data.get('comment') });
      form.reset();
      setMessage('Pilot feedback recorded for the operational review.');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to record pilot feedback.');
    }
  }

  async function signOut() {
    await fetch('/api/moderators/logout', { method: 'POST' });
    router.push('/moderator');
  }

  if (!operations) return <section className="setup-card"><p className="setup-loading compact">Loading operational controls…</p></section>;

  return (
    <section className="setup-card operations-panel">
      <div className="setup-card-heading"><span>06</span><div><h2>Communications & operations</h2><p>Run private rooms, share official notices, and keep recoverable records.</p></div><button className="text-button" type="button" onClick={signOut}>Sign out</button></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice success" role="status">{message}</p>}

      <div className="ops-block game-controls">
        <div><p className="eyebrow accent">Fail-safe controls</p><p className="field-help">Stop freezes a campaign. Reset is an owner-only recovery action that preserves a backup and audit history.</p></div>
        <div className="button-row">
          <button className="danger-button" type="button" onClick={() => void stopGame()} disabled={busyAction !== null || ['STOPPED', 'COMPLETED', 'CANCELLED'].includes(operations.game.status)}>{busyAction === 'stop' ? 'Stopping…' : 'Stop game'}</button>
          {operations.viewerRole === 'OWNER' && <button className="secondary-button" type="button" onClick={() => void resetGame()} disabled={busyAction !== null}>{busyAction === 'reset' ? 'Resetting…' : 'Reset to setup'}</button>}
        </div>
        {operations.game.status === 'STOPPED' && <p className="notice warning">Stopped {operations.game.stoppedAt ? new Date(operations.game.stoppedAt).toLocaleString() : ''}: {operations.game.stopReason ?? 'No reason recorded.'}</p>}
      </div>

      <div className="health-grid">
        <div><span>Roster</span><strong>{operations.counts.claimed}/{operations.counts.total}</strong><small>claimed</small></div>
        <div><span>Living</span><strong>{operations.counts.living}</strong><small>players</small></div>
        <div><span>Sessions</span><strong>{operations.activePlayerSessions}</strong><small>active</small></div>
        <div className={operations.overduePhase ? 'warning' : ''}><span>Deadlines</span><strong>{operations.overduePhase ? 'Overdue' : 'Healthy'}</strong><small>{operations.overduePhase?.kind ?? 'no stale phase'}</small></div>
        <div><span>Activity (24h)</span><strong>{operations.activity.submittedActions}</strong><small>{operations.activity.lateRejections} late rejected</small></div>
      </div>
      <div className="ops-inline-note"><span>Deadline monitor checks due phases and locks player submissions safely.</span><button className="secondary-button" type="button" onClick={() => void reconcileDeadlines()}>Check deadlines</button></div>

      <div className="operations-columns">
        <form className="ops-block" onSubmit={announce}><p className="eyebrow accent">Official announcement</p><label>Title<input name="title" required /></label><label>Message<textarea name="body" rows={4} required /></label><button className="primary-button" type="submit">Publish notice</button></form>
        <form className="ops-block" onSubmit={addModerator}><p className="eyebrow accent">Co-moderator access</p><p className="field-help">Current: {moderators.map((moderator) => moderator.email).join(', ')}</p><label>Email<input name="email" type="email" required /></label><label>Moderator password<input name="password" type="password" minLength={12} required /></label><p className="field-help">There is no forced expiry; the moderator can recover with a one-time code.</p><button className="secondary-button" type="submit">Add co-moderator</button>{recoveryCodes.length > 0 && <code className="recovery-list">{recoveryCodes.join(' · ')}</code>}</form>
        <form className="ops-block" onSubmit={resetPlayerPin}><p className="eyebrow accent">Player access recovery</p><p className="field-help">Use when a claimed player forgets a PIN. The new PIN is shown only to you and prior sessions are revoked.</p><label>Player<select name="seatId" value={pinSeatId} onChange={(event) => setPinSeatId(event.target.value)} required><option value="">Choose a claimed seat</option>{operations.seats.filter((seat) => seat.status === 'CLAIMED').map((seat) => <option key={seat.id} value={seat.id}>{seat.displayName}</option>)}</select></label><label>New six-digit PIN<input name="newPin" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required /></label><label>Reason<textarea name="reason" rows={2} minLength={5} required placeholder="Player forgot the previous PIN" /></label><button className="secondary-button" type="submit">Reset player PIN</button></form>
      </div>

      <div className="ops-block room-operations"><div className="ops-heading"><div><p className="eyebrow accent">Private rooms</p><p className="field-help">Messages expire after {operations.game.chatRetentionDays} days.</p></div><button className="secondary-button" type="button" onClick={purgeRetention}>Purge expired</button></div><div className="room-health-list">{rooms.map((room) => <div key={room.id}><span>{room.type}</span><strong>{room.memberCount} members · {room.messageCount} messages</strong><button type="button" onClick={() => void toggleRoom(room)}>{room.status === 'OPEN' ? 'Make read-only' : 'Reopen'}</button></div>)}</div>{messages.slice(0, 8).map((chat) => <div className="moderation-line" key={chat.id}><span><strong>{chat.authorName}</strong> in {chat.roomType}</span><p>{chat.body ?? 'Removed message'}</p>{chat.body && <button type="button" onClick={() => void removeMessage(chat.id)}>Remove</button>}</div>)}</div>

      <form className="ops-block pilot-feedback" onSubmit={submitFeedback}><p className="eyebrow accent">Pilot feedback</p><p className="field-help">Capture a quick moderator signal while the pilot is running.</p><label>Rating<select name="rating" defaultValue="5"><option value="5">5 — excellent</option><option value="4">4 — good</option><option value="3">3 — mixed</option><option value="2">2 — difficult</option><option value="1">1 — blocked</option></select></label><label>Comment<textarea name="comment" rows={3} maxLength={2000} placeholder="What should we improve before the next game?" /></label><button className="secondary-button" type="submit">Save feedback</button></form>

      <div className="backup-row"><div><p className="eyebrow accent">Verified backup</p><strong>{operations.lastBackup ? `Last export ${new Date(operations.lastBackup.exportedAt).toLocaleString()}` : 'No backup exported yet'}</strong><small>{operations.lastBackup?.checksum ? `Checksum ${operations.lastBackup.checksum.slice(0, 18)}…` : 'Includes game state, audit history, and private rooms.'}</small></div><button className="primary-button" type="button" onClick={exportBackup} disabled={busyAction !== null}>{busyAction === 'export' ? 'Creating…' : 'Download JSON backup'}</button></div>
      {operations.viewerRole === 'OWNER' && operations.backups.length > 0 && <div className="ops-block restore-backup-block"><p className="eyebrow accent">Recovery restore</p><p className="field-help">Restore a verified snapshot into this game’s setup state. Secrets are never restored; fresh seat links are generated.</p><div className="button-row"><label className="restore-select">Snapshot<select value={restoreBackupId} onChange={(event) => setRestoreBackupId(event.target.value)} disabled={busyAction !== null}>{operations.backups.map((backup) => <option key={backup.id} value={backup.id}>{new Date(backup.exportedAt).toLocaleString()} · {backup.checksum.slice(0, 12)}…</option>)}</select></label><button className="secondary-button" type="button" onClick={() => void restoreBackup()} disabled={busyAction !== null}>{busyAction === 'restore' ? 'Restoring…' : 'Restore to setup'}</button>{restoreInviteCsv && <button className="secondary-button" type="button" onClick={downloadRestoredInvites}>Download fresh invites</button>}</div></div>}
    </section>
  );
}
