'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { pollWhileVisible } from '../../lib/http/poll-while-visible';
import { conditionalGet, responseEtag } from '../../lib/http/conditional-get';
import { RELAXED_POLL_MS } from '../../lib/http/poll-interval';
import type { FeedbackSummary } from '../../lib/game/feedback';
import { attentionEventCount } from '../../lib/game/console-guidance';
import type { AnnouncementRecord } from './communications';

export interface Operations {
  viewerRole: string | null;
  game: { name: string; status: string; chatRetentionDays: number; finalCutoffAt: string; stoppedAt?: string | null; stopReason?: string | null };
  counts: { total: number; claimed: number; living: number };
  seats: Array<{ id: string; displayName: string; status: string; pinLocked?: boolean }>;
  overduePhase: null | { id: string; kind: string; closesAt: string };
  reconciledPhaseIds?: string[];
  activePlayerSessions: number;
  activity: { submittedActions: number; lateRejections: number; lastActionAt: string | null };
  lastBackup: null | { exportedAt: string; checksum: string };
  backups: Array<{ id: string; schemaVersion: number; exportedAt: string; checksum: string }>;
  events: OperationalEvent[];
}

export interface OperationalEvent {
  id: string;
  severity: string;
  source: string;
  message: string;
  createdAt: string;
  /** Result emails only: whether the recap story came from the AI or the standard template. */
  storySource: 'AI' | 'TEMPLATE' | null;
}

export interface Room {
  id: string;
  type: string;
  status: string;
  memberCount: number;
  messageCount: number;
}

export interface RoomMessage {
  id: string;
  roomType: string;
  authorName: string;
  body: string | null;
  createdAt: string;
}

export interface Moderator {
  id: string;
  email: string;
  role: string;
}

/** How often a poll also reloads the lists that rarely change. */
const SLOW_REFRESH_MS = 60_000;

async function parse<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Request failed.');
  return data;
}

/** A conditional GET (lib/http/conditional-get.ts): null when nothing changed since `etag`. */
async function parseIfChanged<T>(url: string, etag: string | null): Promise<{ data: T; etag: string | null } | null> {
  const response = await conditionalGet(url, etag);
  return response ? { data: await parse<T>(response), etag: responseEtag(response) } : null;
}

export interface OperationsValue {
  gameId: string;
  operations: Operations | null;
  rooms: Room[];
  messages: RoomMessage[];
  /** The room whose full history is open, and a counter that tells it to reload after the console changes a room. */
  historyRoomId: string | null;
  setHistoryRoomId: (roomId: string | null) => void;
  roomChanges: number;
  moderators: Moderator[];
  announcements: AnnouncementRecord[];
  latestAnnouncementId: string | null;
  feedback: FeedbackSummary | null;
  recoveryCodes: string[];
  pinSeatId: string;
  setPinSeatId: (seatId: string) => void;
  restoreBackupId: string;
  setRestoreBackupId: (backupId: string) => void;
  restoreInviteCsv: string;
  busyAction: string | null;
  message: string;
  error: string;
  /** Problems in the event log (a failed email batch, an automatic step that could not run): the console flags them on the tab. */
  attentionCount: number;
  refresh: () => Promise<void>;
  /** Clears the last action's confirmation or error, so it doesn't follow the moderator to another tab. */
  clearNotices: () => void;
  announce: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  addModerator: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  removeModerator: (moderator: Moderator) => Promise<void>;
  makeOwner: (moderator: Moderator) => Promise<void>;
  resetPlayerPin: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  exportBackup: () => Promise<void>;
  toggleRoom: (room: Room) => Promise<void>;
  purgeRetention: () => Promise<void>;
  removeMessage: (messageId: string) => Promise<boolean>;
  stopGame: () => Promise<void>;
  resetGame: () => Promise<void>;
  restoreBackup: () => Promise<void>;
  downloadRestoredInvites: () => void;
  reconcileDeadlines: () => Promise<void>;
  submitFeedback: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

const OperationsContext = createContext<OperationsValue | null>(null);

export function useOperations(): OperationsValue {
  const value = useContext(OperationsContext);
  if (!value) throw new Error('useOperations must be used inside an OperationsProvider.');
  return value;
}

/**
 * The operations data and actions for one game: counts, rooms, moderators,
 * announcements, feedback, backups, and the event log. The console renders its
 * parts on different tabs, so one provider owns the polling and the state and
 * each part reads it from here.
 */
export function OperationsProvider({ gameId, refreshToken = 0, onGameChanged, children }: { gameId: string; refreshToken?: number; onGameChanged?: () => void; children: ReactNode }) {
  const [operations, setOperations] = useState<Operations | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [historyRoomId, setHistoryRoomId] = useState<string | null>(null);
  const [roomChanges, setRoomChanges] = useState(0);
  const [moderators, setModerators] = useState<Moderator[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementRecord[]>([]);
  const [latestAnnouncementId, setLatestAnnouncementId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackSummary | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [pinSeatId, setPinSeatId] = useState('');
  const [restoreBackupId, setRestoreBackupId] = useState('');
  const [restoreInviteCsv, setRestoreInviteCsv] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const refreshSequence = useRef(0);

  const lastFullRefresh = useRef(0);
  // The ETags of the operations and rooms data on screen, by URL.
  const etags = useRef(new Map<string, string | null>());

  /**
   * Operations and rooms change during play and refresh on every poll, as
   * conditional requests that skip unchanged data. The co-moderator list,
   * announcements, and feedback rarely change, so a poll reloads them at most
   * once a minute; opening the console and the moderator's own changes (which
   * call refresh()) always reload everything.
   */
  const refreshInternal = useCallback(async (options: { onlyLive?: boolean } = {}) => {
    const sequence = ++refreshSequence.current;
    const full = !options.onlyLive || Date.now() - lastFullRefresh.current >= SLOW_REFRESH_MS;
    const operationsUrl = `/api/games/${gameId}/operations`;
    const roomsUrl = `/api/games/${gameId}/rooms`;
    const [opsResult, roomResult, slow] = await Promise.all([
      parseIfChanged<Operations>(operationsUrl, etags.current.get(operationsUrl) ?? null),
      parseIfChanged<{ rooms: Room[]; recentMessages: RoomMessage[] }>(roomsUrl, etags.current.get(roomsUrl) ?? null),
      full
        ? Promise.all([
            fetch(`/api/games/${gameId}/moderators`).then(parse<{ moderators: Moderator[] }>),
            fetch(`/api/games/${gameId}/announcements`).then(parse<{ announcements: AnnouncementRecord[] }>),
            fetch(`/api/games/${gameId}/feedback`).then(parse<{ feedback: FeedbackSummary }>),
          ])
        : Promise.resolve(null),
    ]);
    if (sequence !== refreshSequence.current) return;
    if (roomResult) {
      etags.current.set(roomsUrl, roomResult.etag);
      setRooms(roomResult.data.rooms);
      setMessages(roomResult.data.recentMessages);
    }
    if (slow) {
      lastFullRefresh.current = Date.now();
      const [moderatorData, announcementData, feedbackData] = slow;
      setModerators(moderatorData.moderators);
      setAnnouncements(announcementData.announcements);
      setFeedback(feedbackData.feedback);
    }
    if (opsResult) {
      etags.current.set(operationsUrl, opsResult.etag);
      const ops = opsResult.data;
      setOperations(ops);
      setRestoreBackupId((current) => current && ops.backups?.some((backup) => backup.id === current) ? current : ops.backups?.[0]?.id ?? '');
    }
  }, [gameId]);

  const refresh = useCallback(() => refreshInternal(), [refreshInternal]);
  const clearNotices = useCallback(() => {
    setMessage('');
    setError('');
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshInternal().catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load operations.'));
    }, 0);
    const stopPolling = pollWhileVisible(() => {
      void refreshInternal({ onlyLive: true }).catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to refresh operations.'));
    }, RELAXED_POLL_MS);
    return () => {
      window.clearTimeout(timer);
      stopPolling();
    };
  }, [refreshInternal, refreshToken]);

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
      const response = await fetch(`/api/games/${gameId}/announcements`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: data.get('title'), body: data.get('body') }) });
      const created = await parse<{ announcement: AnnouncementRecord }>(response);
      form.reset();
      setLatestAnnouncementId(created.announcement.id);
      setMessage('Announcement published in the app. Its email and chat copy are ready below.');
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

  async function removeModerator(moderator: Moderator) {
    if (!window.confirm(`Remove ${moderator.email} from this game? They lose access to it at once. Their account stays, so you can add them again.`)) return;
    setError('');
    setBusyAction('moderator');
    try {
      await parse(await fetch(`/api/games/${gameId}/moderators/${moderator.id}`, { method: 'DELETE' }));
      setMessage(`${moderator.email} was removed from this game.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to remove the co-moderator.');
    } finally {
      setBusyAction(null);
    }
  }

  async function makeOwner(moderator: Moderator) {
    if (!window.confirm(`Make ${moderator.email} the owner of this game? You stay on as a co-moderator, and only the new owner can reset, restore, cancel setup, or manage moderators.`)) return;
    setError('');
    setBusyAction('moderator');
    try {
      await parse(await fetch(`/api/games/${gameId}/moderators/${moderator.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'OWNER' }),
      }));
      setMessage(`${moderator.email} now owns this game. You are a co-moderator.`);
      await refresh();
      onGameChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to transfer ownership.');
    } finally {
      setBusyAction(null);
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
      setRoomChanges((count) => count + 1);
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

  /** Resolves true once the message is removed; false if the moderator cancelled or the removal failed. */
  async function removeMessage(messageId: string): Promise<boolean> {
    const reason = window.prompt('Why should this message be removed?');
    if (!reason) return false;
    try {
      await post(`/api/games/${gameId}/rooms`, { action: 'DELETE_MESSAGE', messageId, reason });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to remove message.');
      return false;
    }
    setRoomChanges((count) => count + 1);
    await refresh().catch(() => undefined);
    return true;
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
      setMessage('Your feedback was recorded.');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to record pilot feedback.');
    }
  }

  const attentionCount = useMemo(() => attentionEventCount(operations?.events ?? []), [operations]);

  const value: OperationsValue = {
    gameId, operations, rooms, messages, historyRoomId, setHistoryRoomId, roomChanges, moderators, announcements, latestAnnouncementId, feedback,
    recoveryCodes, pinSeatId, setPinSeatId, restoreBackupId, setRestoreBackupId, restoreInviteCsv, busyAction, message, error, attentionCount,
    refresh, clearNotices, announce, addModerator, removeModerator, makeOwner, resetPlayerPin, exportBackup, toggleRoom, purgeRetention, removeMessage,
    stopGame, resetGame, restoreBackup, downloadRestoredInvites, reconcileDeadlines, submitFeedback,
  };
  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}
