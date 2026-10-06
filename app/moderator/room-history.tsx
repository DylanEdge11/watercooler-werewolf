'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { IDLE_AFTER_MS, pollWhileVisible } from '../../lib/http/poll-while-visible';
import { useOperations } from './operations-context';
import { useGameEnded } from './use-game-ended';
import { conditionalGet, responseEtag } from '../../lib/http/conditional-get';
import { RELAXED_POLL_MS, URGENT_POLL_MS } from '../../lib/http/poll-interval';
import { ROOM_NAMES as roomNames } from '../../lib/chat/room-names';

/** A room with a message in the last two minutes counts as in use, as in the player view. */
const CHAT_ACTIVE_MS = 2 * 60_000;

export interface HistoryRoom {
  id: string;
  type: string;
  status: string;
}

interface HistoryMessage {
  id: string;
  authorName: string;
  authorKind: 'PLAYER' | 'SPECTATOR' | 'MODERATOR';
  body: string | null;
  deletedAt: string | null;
  purgedAt: string | null;
  createdAt: string;
}

interface HistoryPage {
  room: HistoryRoom & { postBlockedReason: string | null };
  messages: HistoryMessage[];
  earlierCursor: string | null;
  error?: string;
}

function mergeMessages(earlier: HistoryMessage[], latest: HistoryMessage[]): HistoryMessage[] {
  const latestIds = new Set(latest.map((message) => message.id));
  return [...earlier.filter((message) => !latestIds.has(message.id)), ...latest];
}

function messageText(message: HistoryMessage): string {
  if (message.body !== null) return message.body;
  return message.purgedAt ? 'Message expired.' : 'Message removed by a moderator.';
}

/**
 * A room's whole history for the game's moderators, newest first, with a box to
 * post as "Moderator". The newest page refreshes on its own; older pages load on
 * request at the end of the list.
 * The console renders it with `key={roomId}`, so switching rooms starts afresh.
 */
export default function RoomHistory({
  gameId,
  rooms,
  roomId,
  reloadToken,
  onSelect,
  onClose,
  onRemove,
  onPosted,
}: {
  gameId: string;
  rooms: HistoryRoom[];
  roomId: string;
  /** Changes when the console changed the room (removed a message, switched read-only), so the history reloads. */
  reloadToken: number;
  onSelect: (roomId: string) => void;
  onClose: () => void;
  onRemove: (messageId: string) => Promise<boolean>;
  onPosted: () => void;
}) {
  const { operations } = useOperations();
  const ended = useGameEnded(operations?.game?.status);
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [earlier, setEarlier] = useState<HistoryMessage[]>([]);
  const [earlierCursor, setEarlierCursor] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const etag = useRef<string | null>(null);
  const newestAt = useRef(0);
  const earlierLoaded = useRef(false);

  const url = `/api/games/${gameId}/rooms/${roomId}/messages`;

  const load = useCallback(async (force = false) => {
    const response = await conditionalGet(url, force ? null : etag.current);
    if (!response) return;
    const data = await response.json() as HistoryPage;
    if (!response.ok) throw new Error(data.error ?? 'Unable to load this room.');
    etag.current = responseEtag(response);
    newestAt.current = Math.max(0, ...data.messages.map((message) => Date.parse(message.createdAt) || 0));
    setPage(data);
    if (!earlierLoaded.current) setEarlierCursor(data.earlierCursor);
  }, [url]);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void load(true).catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load this room.'));
    }, 0);
    const inUse = () => Date.now() - newestAt.current < CHAT_ACTIVE_MS;
    const stopPolling = pollWhileVisible(
      () => void load().catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load this room.')),
      () => (inUse() ? URGENT_POLL_MS : RELAXED_POLL_MS),
      { idleAfterMs: IDLE_AFTER_MS, stopWhen: () => ended.current },
    );
    return () => {
      window.clearTimeout(initial);
      stopPolling();
    };
  }, [load, reloadToken, ended]);

  // Kept oldest first for merging pages; shown newest first.
  const messages = page ? mergeMessages(earlier, page.messages).reverse() : [];

  async function loadEarlier() {
    if (!earlierCursor) return;
    setLoadingEarlier(true);
    setError('');
    try {
      const response = await fetch(`${url}?before=${encodeURIComponent(earlierCursor)}`);
      const data = await response.json() as HistoryPage;
      if (!response.ok) throw new Error(data.error ?? 'Unable to load earlier messages.');
      earlierLoaded.current = true;
      setEarlier((current) => mergeMessages(data.messages, current));
      setEarlierCursor(data.earlierCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load earlier messages.');
    } finally {
      setLoadingEarlier(false);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get('body') ?? '');
    setSending(true);
    setError('');
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Unable to send this message.');
      form.reset();
      await load(true);
      onPosted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to send this message.');
    } finally {
      setSending(false);
    }
  }

  async function remove(messageId: string) {
    if (!(await onRemove(messageId))) return;
    // A removed message may be on an earlier page, which the newest-page refresh doesn't cover.
    setEarlier((current) => current.map((message) => message.id === messageId ? { ...message, body: null, deletedAt: new Date().toISOString() } : message));
  }

  const room = page?.room ?? rooms.find((candidate) => candidate.id === roomId);
  const roomName = roomNames[room?.type ?? ''] ?? room?.type ?? 'Room';

  return (
    <section className="room-history" aria-label={`${roomName} history`}>
      <div className="ops-heading">
        <div className="room-tabs" role="group" aria-label="Choose a room">
          {rooms.map((candidate) => (
            <button key={candidate.id} type="button" className={candidate.id === roomId ? 'active' : ''} aria-pressed={candidate.id === roomId} onClick={() => onSelect(candidate.id)}>
              {roomNames[candidate.type] ?? candidate.type}
            </button>
          ))}
        </div>
        <button className="text-button" type="button" onClick={onClose}>Close</button>
      </div>
      <div className="chat-scroll">
        {!page && !error && <p className="empty-note">Loading messages…</p>}
        {page && !messages.length && <p className="empty-note">No messages in this room yet.</p>}
        {messages.map((message) => (
          <article key={message.id} className={message.authorKind === 'MODERATOR' ? 'chat-line moderator' : 'chat-line'}>
            <div>
              <strong>{message.authorName}</strong>
              <small suppressHydrationWarning>{new Date(message.createdAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</small>
            </div>
            <p>{messageText(message)}</p>
            {message.body !== null && <button className="chat-remove" type="button" onClick={() => void remove(message.id)}>Remove</button>}
          </article>
        ))}
        {earlierCursor && <button className="secondary-button load-earlier" type="button" onClick={() => void loadEarlier()} disabled={loadingEarlier}>{loadingEarlier ? 'Loading…' : 'Load earlier messages'}</button>}
      </div>
      {page && (page.room.postBlockedReason
        ? <p className="field-help">{page.room.postBlockedReason}</p>
        : (
          <form className="chat-compose" onSubmit={send}>
            <label><span className="sr-only">Message as Moderator</span><textarea name="body" rows={2} maxLength={1000} placeholder={`Post in the ${roomName} as Moderator…`} required /></label>
            <button className="primary-button" type="submit" disabled={sending}>{sending ? 'Sending…' : 'Post as Moderator'}</button>
          </form>
        ))}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
