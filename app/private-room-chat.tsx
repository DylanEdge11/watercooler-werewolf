'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface Room {
  id: string;
  type: 'WEREWOLF' | 'MASON' | 'DEAD';
  status: string;
  access: string;
}

interface Message {
  id: string;
  authorName: string;
  body: string | null;
  deletedAt: string | null;
  purgedAt: string | null;
  createdAt: string;
}

const roomNames = { WEREWOLF: 'Pack room', MASON: 'Mason room', DEAD: 'Afterlife' } as const;

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

export default function PrivateRoomChat({ rooms, previewMode = false }: { rooms: Room[]; previewMode?: boolean }) {
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? '');
  const [loadedMessages, setLoadedMessages] = useState<Message[]>([]);
  const [previewMessagesByRoom, setPreviewMessagesByRoom] = useState<Record<string, Message[]>>(
    () => previewMode ? Object.fromEntries(rooms.map((candidate) => [candidate.id, previewMessages(candidate.type)] as const)) : {},
  );
  const [error, setError] = useState('');
  const room = rooms.find((candidate) => candidate.id === roomId) ?? rooms[0];
  const messages = previewMode ? previewMessagesByRoom[room?.id ?? ''] ?? [] : loadedMessages;

  const load = useCallback(async () => {
    if (!roomId || previewMode) return;
    const response = await fetch(`/api/rooms/${roomId}/messages`);
    const data = await response.json() as { messages?: Message[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Unable to load messages.');
    setLoadedMessages(data.messages ?? []);
  }, [previewMode, roomId]);

  useEffect(() => {
    if (previewMode) return;
    const initial = window.setTimeout(() => {
      void load().catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load messages.'));
    }, 0);
    const timer = window.setInterval(() => void load(), 10_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load, previewMode]);

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
    <section className="rail-card private-chat" id="private-room">
      <div className="rail-heading"><h2>{roomNames[room.type]}</h2><span>{messages.length}</span></div>
      {rooms.length > 1 && <div className="room-tabs">{rooms.map((candidate) => <button className={candidate.id === room.id ? 'active' : ''} key={candidate.id} type="button" aria-pressed={candidate.id === room.id} onClick={() => setRoomId(candidate.id)}>{roomNames[candidate.type]}</button>)}</div>}
      <div className="chat-scroll">
        {messages.length ? messages.map((message) => <article key={message.id} className="chat-line"><div><strong>{message.authorName}</strong><small suppressHydrationWarning>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></div><p>{message.body ?? (message.purgedAt ? 'Message expired.' : 'Message removed by a moderator.')}</p></article>) : <p className="empty-note">No messages yet. This room is visible only to its members.</p>}
      </div>
      {room.status === 'OPEN' && room.access === 'WRITE' ? <form className="chat-compose" onSubmit={send}><label><span className="sr-only">Message</span><textarea name="body" rows={2} maxLength={1000} placeholder="Write a private message…" required /></label><button className="primary-button" type="submit">{previewMode ? 'Add preview message' : 'Send'}</button></form> : <p className="field-help">This room is read-only.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
