'use client';

import { ROOM_NAMES } from '@/lib/chat/room-names';
import { AnnouncementCopies, FeedbackBlock } from './communications';
import { useOperations, type OperationalEvent } from './operations-context';
import RoomHistory from './room-history';

/**
 * The fresh invitations a restore produces. They are shown only once, so this stays on Setup, where a restore
 * sends the console, until the moderator leaves the game; the message about the restore is in the banner.
 */
export function RestoredInvites() {
  const { restoreInviteCsv, downloadRestoredInvites } = useOperations();
  if (!restoreInviteCsv) return null;
  return (
    <div className="notice success restored-invites">
      <p>The backup was restored and every player has a fresh private link. They are shown only once, so download them now.</p>
      <div className="button-row"><button className="secondary-button" type="button" onClick={downloadRestoredInvites}>Download fresh invites</button></div>
    </div>
  );
}

function Loading() {
  return <p className="setup-loading compact">Loading operational controls…</p>;
}

/** Roster, living players, sessions, deadline health, and the 24-hour activity, with a manual deadline check. */
export function HealthStrip() {
  const { operations, reconcileDeadlines } = useOperations();
  if (!operations) return null;
  return (
    <section className="health-strip" aria-label="Game health">
      <div className="health-grid">
        <div><span>Roster</span><strong>{operations.counts.claimed}/{operations.counts.total}</strong><small>claimed</small></div>
        <div><span>Living</span><strong>{operations.counts.living}</strong><small>players</small></div>
        <div><span>Sessions</span><strong>{operations.activePlayerSessions}</strong><small>active</small></div>
        <div className={operations.overduePhase ? 'warning' : ''}><span>Deadlines</span><strong>{operations.overduePhase ? 'Overdue' : 'Healthy'}</strong><small>{operations.overduePhase?.kind ?? 'no stale phase'}</small></div>
        <div><span>Activity (24h)</span><strong>{operations.activity.submittedActions}</strong><small>{operations.activity.lateRejections} late rejected</small></div>
      </div>
      <div className="ops-inline-note"><span>Deadline monitor checks due phases and locks player submissions safely.</span><button className="secondary-button" type="button" onClick={() => void reconcileDeadlines()}>Check deadlines</button></div>
    </section>
  );
}

/** Stop and Reset: the controls that end or rewind a game, kept apart from everyday ones. */
export function FailSafeControls() {
  const { operations, busyAction, stopGame, resetGame } = useOperations();
  if (!operations) return <Loading />;
  return (
    <div className="ops-block game-controls">
      <div><p className="eyebrow accent">Fail-safe controls</p><p className="field-help">Stop freezes a campaign. Reset is an owner-only recovery action that preserves a backup and audit history.</p></div>
      <div className="button-row">
        <button className="danger-button" type="button" onClick={() => void stopGame()} disabled={busyAction !== null || ['STOPPED', 'COMPLETED', 'CANCELLED'].includes(operations.game.status)}>{busyAction === 'stop' ? 'Stopping…' : 'Stop game'}</button>
        {operations.viewerRole === 'OWNER' && <button className="secondary-button" type="button" onClick={() => void resetGame()} disabled={busyAction !== null}>{busyAction === 'reset' ? 'Resetting…' : 'Reset to setup'}</button>}
      </div>
      {operations.game.status === 'STOPPED' && <p className="notice warning">Stopped {operations.game.stoppedAt ? new Date(operations.game.stoppedAt).toLocaleString() : ''}: {operations.game.stopReason ?? 'No reason recorded.'}</p>}
    </div>
  );
}

/** Emails sent or failed, automatic steps that could not run, and deadline locks, newest first. */
export function EventLog() {
  const { operations } = useOperations();
  if (!operations) return <Loading />;
  return <EventLogList events={operations.events} />;
}

function EventLogList({ events }: { events: OperationalEvent[] }) {
  return (
    <div className="ops-block event-log">
      <p className="eyebrow accent">Event log</p>
      <p className="field-help">Player emails, automatic results, and deadline locks for this game, newest first. Warnings need your attention.</p>
      {events.length ? (
        <ul aria-label="Event log">
          {events.map((event) => (
            <li key={event.id} className={event.severity === 'WARNING' ? 'warning' : undefined}>
              <small>{new Date(event.createdAt).toLocaleString()}</small>
              <span>
                {event.severity === 'WARNING' ? 'Warning: ' : ''}{event.message}
                {event.storySource === 'AI' ? ' Story written by AI.' : event.storySource === 'TEMPLATE' ? ' Story from the standard template (the AI story was unavailable).' : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="field-help">Nothing recorded yet.</p>}
    </div>
  );
}

/** The last backup and a download button, then (owner only) restoring a stored snapshot. */
export function BackupControls() {
  const { operations, busyAction, exportBackup, restoreBackupId, setRestoreBackupId, restoreBackup, restoreInviteCsv, downloadRestoredInvites } = useOperations();
  if (!operations) return <Loading />;
  return <>
    <div className="backup-row"><div><p className="eyebrow accent">Verified backup</p><strong>{operations.lastBackup ? `Last export ${new Date(operations.lastBackup.exportedAt).toLocaleString()}` : 'No backup exported yet'}</strong><small>{operations.lastBackup?.checksum ? `Checksum ${operations.lastBackup.checksum.slice(0, 18)}…` : 'Includes game state, audit history, and private rooms.'}</small></div><button className="primary-button" type="button" onClick={() => void exportBackup()} disabled={busyAction !== null}>{busyAction === 'export' ? 'Creating…' : 'Download JSON backup'}</button></div>
    {operations.viewerRole === 'OWNER' && operations.game.status !== 'CANCELLED' && operations.backups.length > 0 && <div className="ops-block restore-backup-block"><p className="eyebrow accent">Recovery restore</p><p className="field-help">Restore a verified snapshot into this game’s setup state. Secrets are never restored; fresh seat links are generated.</p><div className="button-row"><label className="restore-select">Snapshot<select value={restoreBackupId} onChange={(event) => setRestoreBackupId(event.target.value)} disabled={busyAction !== null}>{operations.backups.map((backup) => <option key={backup.id} value={backup.id}>{new Date(backup.exportedAt).toLocaleString()} · {backup.checksum.slice(0, 12)}…</option>)}</select></label><button className="secondary-button" type="button" onClick={() => void restoreBackup()} disabled={busyAction !== null}>{busyAction === 'restore' ? 'Restoring…' : 'Restore to setup'}</button>{restoreInviteCsv && <button className="secondary-button" type="button" onClick={downloadRestoredInvites}>Download fresh invites</button>}</div></div>}
  </>;
}

/** Sets a new PIN for a player who forgot theirs or whose seat locked. */
export function PlayerAccessRecovery() {
  const { operations, pinSeatId, setPinSeatId, resetPlayerPin } = useOperations();
  if (!operations) return <Loading />;
  return (
    <form className="ops-block" onSubmit={(event) => void resetPlayerPin(event)}><p className="eyebrow accent">Player access recovery</p><p className="field-help">Use when a claimed player forgets a PIN or their seat is locked after 10 wrong PINs in a row. The new PIN is shown only to you, prior sessions are revoked, and the seat unlocks.</p><label>Player<select name="seatId" value={pinSeatId} onChange={(event) => setPinSeatId(event.target.value)} required><option value="">Choose a claimed seat</option>{operations.seats.filter((seat) => seat.status === 'CLAIMED').map((seat) => <option key={seat.id} value={seat.id}>{seat.displayName}{seat.pinLocked ? ' (locked: too many wrong PINs)' : ''}</option>)}</select></label><label>New six-digit PIN<input name="newPin" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required /></label><label>Reason<textarea name="reason" rows={2} minLength={5} required placeholder="Player forgot the previous PIN" /></label><button className="secondary-button" type="submit">Reset player PIN</button></form>
  );
}

/** The game's moderators; the owner can add, remove, or hand the game over. */
export function CoModeratorAccess() {
  const { operations, moderators, recoveryCodes, busyAction, addModerator, makeOwner, removeModerator } = useOperations();
  if (!operations) return <Loading />;
  return (
    <form className="ops-block" onSubmit={(event) => void addModerator(event)}><p className="eyebrow accent">Co-moderator access</p><ul className="moderator-list" aria-label="Moderators">{moderators.map((moderator) => <li key={moderator.id}><span className="moderator-email">{moderator.email}</span><small>{moderator.role === 'OWNER' ? 'Owner' : 'Co-moderator'}</small>{operations.viewerRole === 'OWNER' && moderator.role !== 'OWNER' && <span className="moderator-actions"><button type="button" onClick={() => void makeOwner(moderator)} disabled={busyAction !== null}>Make owner</button><button type="button" onClick={() => void removeModerator(moderator)} disabled={busyAction !== null}>Remove</button></span>}</li>)}</ul><label>Email<input name="email" type="email" required /></label><label>Moderator password<input name="password" type="password" minLength={12} required /></label><p className="field-help">There is no forced expiry; the moderator can recover with a one-time code.</p><button className="secondary-button" type="submit">Add co-moderator</button>{recoveryCodes.length > 0 && <code className="recovery-list">{recoveryCodes.join(' · ')}</code>}</form>
  );
}

/** Publishes an official notice to every player, then lists each notice with copy-ready email and chat text. */
export function Announcements() {
  const { operations, announcements, latestAnnouncementId, announce } = useOperations();
  if (!operations) return <Loading />;
  return <>
    <form className="ops-block" onSubmit={(event) => void announce(event)}><p className="eyebrow accent">Official announcement</p><label>Title<input name="title" required /></label><label>Message<textarea name="body" rows={4} required /></label><button className="primary-button" type="submit">Publish notice</button></form>
    <AnnouncementCopies announcements={announcements} highlightId={latestAnnouncementId} />
  </>;
}

/** Every room's size and state, its full history on request, and the latest messages across all of them. */
export function ChatRooms() {
  const { operations, rooms, messages, historyRoomId, setHistoryRoomId, roomChanges, gameId, toggleRoom, purgeRetention, removeMessage, refresh } = useOperations();
  if (!operations) return <Loading />;
  return (
    <div className="ops-block room-operations">
      <div className="ops-heading">
        <div><p className="eyebrow accent">Chat rooms</p><p className="field-help">Messages older than {operations.game.chatRetentionDays} days are removed when you select Purge expired.</p></div>
        <button className="secondary-button" type="button" onClick={() => void purgeRetention()}>Purge expired</button>
      </div>
      <div className="room-health-list">{rooms.map((room) => <div key={room.id}><span>{ROOM_NAMES[room.type] ?? room.type}</span><strong>{room.memberCount} members · {room.messageCount} messages</strong><button className="room-open" type="button" aria-pressed={historyRoomId === room.id} onClick={() => setHistoryRoomId(room.id)}>Open room</button><button type="button" onClick={() => void toggleRoom(room)}>{room.status === 'OPEN' ? 'Make read-only' : 'Reopen'}</button></div>)}</div>
      {historyRoomId && rooms.some((room) => room.id === historyRoomId) && <RoomHistory key={historyRoomId} gameId={gameId} rooms={rooms} roomId={historyRoomId} reloadToken={roomChanges} onSelect={setHistoryRoomId} onClose={() => setHistoryRoomId(null)} onRemove={removeMessage} onPosted={() => void refresh().catch(() => undefined)} />}
      {messages.slice(0, 8).map((chat) => <div className="moderation-line" key={chat.id}><span><strong>{chat.authorName}</strong> in {ROOM_NAMES[chat.roomType] ?? chat.roomType}</span><p>{chat.body ?? 'Removed message'}</p>{chat.body && <button type="button" onClick={() => void removeMessage(chat.id)}>Remove</button>}</div>)}
    </div>
  );
}

/** What players and moderators have sent, plus a form for the moderator's own rating. */
export function FeedbackSection() {
  const { operations, feedback, submitFeedback } = useOperations();
  if (!operations) return <Loading />;
  return <>
    <FeedbackBlock feedback={feedback} />
    <form className="ops-block pilot-feedback" onSubmit={(event) => void submitFeedback(event)}><p className="eyebrow accent">Send your own feedback</p><p className="field-help">Add a quick moderator rating; it appears in the Feedback list above.</p><label>Rating<select name="rating" defaultValue="5"><option value="5">5 — excellent</option><option value="4">4 — good</option><option value="3">3 — mixed</option><option value="2">2 — difficult</option><option value="1">1 — blocked</option></select></label><label>Comment<textarea name="comment" rows={3} maxLength={2000} placeholder="What should we improve before the next game?" /></label><button className="secondary-button" type="submit">Save feedback</button></form>
  </>;
}
