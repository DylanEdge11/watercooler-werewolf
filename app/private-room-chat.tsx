'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { LatestRoomRequest } from '../lib/chat/latest-room-request';
import { IDLE_AFTER_MS, pollWhileVisible } from '../lib/http/poll-while-visible';
import { conditionalGet, responseEtag } from '../lib/http/conditional-get';
import { RELAXED_POLL_MS, URGENT_POLL_MS } from '../lib/http/poll-interval';
import { ROOM_NAMES } from '../lib/chat/room-names';

/** A room with a message in the last two minutes counts as in use. */
const CHAT_ACTIVE_MS = 2 * 60_000;

interface Room {
  id: string;
  type: 'WEREWOLF' | 'MASON' | 'DEAD' | 'TOWN_HALL';
  status: string;
  access: string;
}

interface Message {
  id: string;
  authorName: string;
  /** Posted by a moderator; shown as "Moderator" and styled apart. */
  byModerator?: boolean;
  body: string | null;
  deletedAt: string | null;
  purgedAt: string | null;
  createdAt: string;
}


function previewMessages(roomType: Room['type']): Message[] {
  const messagesByRoom: Record<Room['type'], Array<{ authorName: string; body: string }>> = {
    WEREWOLF: [
      { authorName: 'Morgan Lee', body: 'We should compare notes before the ballot closes.' },
      { authorName: 'Taylor Reed', body: 'Agreed. I have a couple of likely targets.' },
    ],
    MASON: [
      { authorName: 'Jamie Park', body: 'I am keeping an eye on the latest announcement.' },
      { authorName: 'Casey Rivera', body: 'Same here. I will check in after the next phase.' },
    ],
    DEAD: [
      { authorName: 'Riley Chen', body: 'Spectator chat is open. Good luck, everyone.' },
      { authorName: 'Jordan Blake', body: 'The last reveal changed the whole story.' },
    ],
    TOWN_HALL: [
      { authorName: 'Avery Stone', body: 'Who else thought that last vote was strange?' },
      { authorName: 'Quinn Harper', body: 'I am watching who goes quiet today.' },
    ],
  };
  const now = Date.now();
  return messagesByRoom[roomType].map((message, index) => ({
    id: `preview-${roomType.toLowerCase()}-${index}`,
    authorName: message.authorName,
    body: message.body,
    deletedAt: null,
    purgedAt: null,
    createdAt: new Date(now - (messagesByRoom[roomType].length - index) * 60_000).toISOString(),
  }));
}

/**
 * One chat card: the Town Hall on its own, or the player's private rooms with
 * a tab for each. Messages show newest first.
 */
export default function RoomChat({ rooms, previewMode = false, sectionId, spotlight = false }: {
  rooms: Room[];
  previewMode?: boolean;
  /** The card's id, for the navigation links that jump to it. */
  sectionId: string;
  /** Briefly highlights the card after a navigation link jumped to it. */
  spotlight?: boolean;
}) {
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? '');
  const [loadedMessagesByRoom, setLoadedMessagesByRoom] = useState<Record<string, Message[]>>({});
  const [previewMessagesByRoom, setPreviewMessagesByRoom] = useState<Record<string, Message[]>>(
    () => previewMode ? Object.fromEntries(rooms.map((candidate) => [candidate.id, previewMessages(candidate.type)] as const)) : {},
  );
  const [error, setError] = useState('');
  const messageRequest = useRef<LatestRoomRequest | null>(null);
  if (messageRequest.current === null) {
    messageRequest.current = new LatestRoomRequest(roomId);
  }
  // Per room: the ETag of the messages on screen (lib/http/conditional-get.ts),
  // and when its newest message was posted, which sets how often it refreshes.
  const etagByRoom = useRef<Record<string, string | null>>({});
  const newestMessageAtByRoom = useRef<Record<string, number>>({});
  const roomStatus = useRef<Record<string, string>>({});
  useEffect(() => {
    roomStatus.current = Object.fromEntries(rooms.map((candidate) => [candidate.id, candidate.status]));
  }, [rooms]);
  const room = rooms.find((candidate) => candidate.id === roomId) ?? rooms[0];
  // The server and preview keep messages oldest first; the card shows the newest at the top.
  const messages = [...(previewMode
    ? previewMessagesByRoom[room?.id ?? ''] ?? []
    : loadedMessagesByRoom[room?.id ?? ''] ?? [])].reverse();
  const townHall = room?.type === 'TOWN_HALL';

  const load = useCallback(async () => {
    if (!roomId || previewMode) return;
    await messageRequest.current?.run(
      roomId,
      async () => {
        const response = await conditionalGet(`/api/rooms/${roomId}/messages`, etagByRoom.current[roomId] ?? null);
        // null: nothing changed since the messages on screen.
        if (!response) return null;
        const data = await response.json() as { messages?: Message[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? 'Unable to load messages.');
        return { messages: data.messages ?? [], etag: responseEtag(response) };
      },
      (result) => {
        if (!result) return;
        etagByRoom.current[roomId] = result.etag;
        newestMessageAtByRoom.current[roomId] = Math.max(0, ...result.messages.map((message) => Date.parse(message.createdAt) || 0));
        setLoadedMessagesByRoom((current) => ({ ...current, [roomId]: result.messages }));
      },
      (caught) => setError(caught instanceof Error ? caught.message : 'Unable to load messages.'),
    );
  }, [previewMode, roomId]);

  useEffect(() => {
    if (previewMode) return;
    const initial = window.setTimeout(() => {
      void load().catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load messages.'));
    }, 0);
    // A room with a message in the last two minutes refreshes every 10 s; a quiet one every 30 s.
    const inUse = () => Date.now() - (newestMessageAtByRoom.current[roomId] ?? 0) < CHAT_ACTIVE_MS;
    // Like the dashboard, it pauses while nobody uses the page, and a room that is no longer open (the game
    // ended, or the moderator closed it) has nothing new to fetch until the tab comes back.
    const stopPolling = pollWhileVisible(() => void load(), () => (inUse() ? URGENT_POLL_MS : RELAXED_POLL_MS), {
      idleAfterMs: IDLE_AFTER_MS,
      stopWhen: () => roomStatus.current[roomId] !== undefined && roomStatus.current[roomId] !== 'OPEN',
    });
    return () => {
      window.clearTimeout(initial);
      stopPolling();
    };
  }, [load, previewMode, roomId]);

  if (!room) return null;

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError('');
    if (previewMode) {
      const body = String(data.get('body') ?? '').trim();
      if (!body) return;
      setPreviewMessagesByRoom((current) => ({
        ...current,
        [room.id]: [...(current[room.id] ?? []), {
          id: `preview-local-${Date.now()}`,
          authorName: 'You (preview)',
          body,
          deletedAt: null,
          purgedAt: null,
          createdAt: new Date().toISOString(),
        }],
      }));
      form.reset();
      return;
    }
    const response = await fetch(`/api/rooms/${room.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: data.get('body') }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) return setError(result.error ?? 'Unable to send this message.');
    form.reset();
    await load();
  }

  return (
    <section className={`rail-card private-chat${townHall ? ' town-hall-chat' : ''}`} id={sectionId} data-spotlight={spotlight || undefined}>
      <div className="rail-heading"><h2>{ROOM_NAMES[room.type]}</h2><span>{messages.length}</span></div>
      {townHall && <p className="field-help">Everyone in the game can read the Town Hall. Living players can post.</p>}
      {rooms.length > 1 && <div className="room-tabs">{rooms.map((candidate) => <button className={candidate.id === room.id ? 'active' : ''} key={candidate.id} type="button" aria-pressed={candidate.id === room.id} onClick={() => { messageRequest.current?.select(candidate.id); setRoomId(candidate.id); }}>{ROOM_NAMES[candidate.type]}</button>)}</div>}
      <div className="chat-scroll">
        {messages.length ? messages.map((message) => <article key={message.id} className={message.byModerator ? 'chat-line moderator' : 'chat-line'}><div><strong>{message.authorName}</strong><small suppressHydrationWarning>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></div><p>{message.body ?? (message.purgedAt ? 'Message expired.' : 'Message removed by a moderator.')}</p></article>) : <p className="empty-note">{townHall ? 'No messages yet. Start the village conversation.' : 'No messages yet. This room is visible only to its members.'}</p>}
      </div>
      {room.status === 'OPEN' && room.access === 'WRITE' ? <form className="chat-compose" onSubmit={send}><label><span className="sr-only">Message</span><textarea name="body" rows={2} maxLength={1000} placeholder={townHall ? 'Write to the whole village…' : 'Write a private message…'} required /></label><button className="primary-button" type="submit">{previewMode ? 'Add preview message' : 'Send'}</button></form> : <p className="field-help">{townHall && room.status === 'OPEN' ? 'Only living players can post in the Town Hall.' : 'This room is read-only.'}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
