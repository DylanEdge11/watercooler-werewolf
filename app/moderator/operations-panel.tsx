'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface Operations {
  game: { status: string; chatRetentionDays: number; finalCutoffAt: string };
  counts: { total: number; claimed: number; living: number };
  overduePhase: null | { id: string; kind: string; closesAt: string };
  activePlayerSessions: number;
  lastBackup: null | { exportedAt: string; checksum: string };
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

export default function OperationsPanel({ gameId }: { gameId: string }) {
  const [operations, setOperations] = useState<Operations | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [moderators, setModerators] = useState<Moderator[]>([]);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const [ops, roomData, moderatorData] = await Promise.all([
      parse<Operations>(await fetch(`/api/games/${gameId}/operations`)),
      parse<{ rooms: Room[]; recentMessages: RoomMessage[] }>(await fetch(`/api/games/${gameId}/rooms`)),
      parse<{ moderators: Moderator[] }>(await fetch(`/api/games/${gameId}/moderators`)),
    ]);
    setOperations(ops);
    setRooms(roomData.rooms);
    setMessages(roomData.recentMessages);
    setModerators(moderatorData.moderators);
  }, [gameId]);

  useEffect(() => {
    void refresh().catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load operations.'));
  }, [refresh]);

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

  async function exportBackup() {
    setError('');
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

  if (!operations) return <section className="setup-card"><p className="setup-loading compact">Loading operational controls…</p></section>;

  return (
    <section className="setup-card operations-panel">
      <div className="setup-card-heading"><span>06</span><div><h2>Communications & operations</h2><p>Run private rooms, share official notices, and keep recoverable records.</p></div></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice success" role="status">{message}</p>}

      <div className="health-grid">
        <div><span>Roster</span><strong>{operations.counts.claimed}/{operations.counts.total}</strong><small>claimed</small></div>
        <div><span>Living</span><strong>{operations.counts.living}</strong><small>players</small></div>
        <div><span>Sessions</span><strong>{operations.activePlayerSessions}</strong><small>active</small></div>
        <div className={operations.overduePhase ? 'warning' : ''}><span>Deadlines</span><strong>{operations.overduePhase ? 'Overdue' : 'Healthy'}</strong><small>{operations.overduePhase?.kind ?? 'no stale phase'}</small></div>
      </div>

      <div className="operations-columns">
        <form className="ops-block" onSubmit={announce}><p className="eyebrow accent">Official announcement</p><label>Title<input name="title" required /></label><label>Message<textarea name="body" rows={4} required /></label><button className="primary-button" type="submit">Publish notice</button></form>
        <form className="ops-block" onSubmit={addModerator}><p className="eyebrow accent">Co-moderator access</p><p className="field-help">Current: {moderators.map((moderator) => moderator.email).join(', ')}</p><label>Email<input name="email" type="email" required /></label><label>Temporary password<input name="password" type="password" minLength={12} required /></label><button className="secondary-button" type="submit">Add co-moderator</button>{recoveryCodes.length > 0 && <code className="recovery-list">{recoveryCodes.join(' · ')}</code>}</form>
      </div>

      <div className="ops-block room-operations"><div className="ops-heading"><div><p className="eyebrow accent">Private rooms</p><p className="field-help">Messages expire after {operations.game.chatRetentionDays} days.</p></div><button className="secondary-button" type="button" onClick={purgeRetention}>Purge expired</button></div><div className="room-health-list">{rooms.map((room) => <div key={room.id}><span>{room.type}</span><strong>{room.memberCount} members · {room.messageCount} messages</strong><button type="button" onClick={() => void toggleRoom(room)}>{room.status === 'OPEN' ? 'Make read-only' : 'Reopen'}</button></div>)}</div>{messages.slice(0, 8).map((chat) => <div className="moderation-line" key={chat.id}><span><strong>{chat.authorName}</strong> in {chat.roomType}</span><p>{chat.body ?? 'Removed message'}</p>{chat.body && <button type="button" onClick={() => void removeMessage(chat.id)}>Remove</button>}</div>)}</div>

      <div className="backup-row"><div><p className="eyebrow accent">Verified backup</p><strong>{operations.lastBackup ? `Last export ${new Date(operations.lastBackup.exportedAt).toLocaleString()}` : 'No backup exported yet'}</strong><small>{operations.lastBackup?.checksum ? `Checksum ${operations.lastBackup.checksum.slice(0, 18)}…` : 'Includes game state, audit history, and private rooms.'}</small></div><button className="primary-button" type="button" onClick={exportBackup}>Download JSON backup</button></div>
    </section>
  );
}
