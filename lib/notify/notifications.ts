import { after } from 'next/server';
import { getDb } from '../../db';
import { loadActions, loadPlayers } from '../game/phase-store';
import { outstandingResponders } from '../game/outstanding';
import { loadCurrentLoverPair } from '../game/relationships';
import type { PhaseKind } from '../game/types';
import { CLOSING_SOON_MINUTES, emailNotificationsAvailable, MIN_PHASE_MINUTES_FOR_REMINDER, siteOrigin } from './config';
import { deliver, type Recipient } from './deliver';
import { closingSoonMessage, phaseOpenedMessage, phaseName, resultPublishedMessage } from './messages';
import { storyInputFromPublishedEvent, writeStory, type StoryWriter } from './story';
import { changes } from '../../db/results';

/*
 * Player email. Three events send it: a phase opens, a phase is about to close, and a
 * result is published. Each goes only to players who turned email on, and the first two
 * only to players who have something to do. Every entry point is safe to call from a
 * game action: it does nothing when email is not set up, and it never throws.
 */

const inFlight = new Set<Promise<unknown>>();

/**
 * Runs `task` once the response has been sent, so a slow mail server never delays a
 * page or a moderator's click. Outside a request (tests, scripts) it just starts the task.
 */
export function runAfterResponse(task: () => Promise<unknown>): void {
  const guarded = () => task().catch((error) => console.error('Email task failed', { name: error instanceof Error ? error.name : 'Error' }));
  try {
    after(guarded);
  } catch {
    const promise = guarded().finally(() => inFlight.delete(promise));
    inFlight.add(promise);
  }
}

/** Waits for tasks started outside a request. For tests. */
export async function flushNotifications(): Promise<void> {
  while (inFlight.size) await Promise.all([...inFlight]);
}

interface PhaseContext {
  gameName: string;
  timeZone: string;
  gameStatus: string;
  phase: { id: string; kind: PhaseKind; status: string; sequence: number; opensAt: string; closesAt: string };
}

async function loadPhaseContext(gameId: string, phaseId: string): Promise<PhaseContext | null> {
  const row = await getDb()
    .prepare(
      `SELECT g.name AS gameName, g.timezone AS timeZone, g.status AS gameStatus,
              p.id AS phaseId, p.kind, p.status, p.sequence, p.opens_at AS opensAt, p.closes_at AS closesAt
       FROM phases p JOIN games g ON g.id = p.game_id
       WHERE p.id = ? AND p.game_id = ?`,
    )
    .bind(phaseId, gameId)
    .first<{ gameName: string; timeZone: string; gameStatus: string; phaseId: string; kind: PhaseKind; status: string; sequence: number; opensAt: string; closesAt: string }>();
  if (!row) return null;
  return {
    gameName: row.gameName,
    timeZone: row.timeZone,
    gameStatus: row.gameStatus,
    phase: { id: row.phaseId, kind: row.kind, status: row.status, sequence: Number(row.sequence), opensAt: row.opensAt, closesAt: row.closesAt },
  };
}

/** Claimed players in the game who turned email on. */
async function optedInPlayers(gameId: string): Promise<Recipient[]> {
  const rows = await getDb()
    .prepare(
      `SELECT s.id AS seatId, s.display_name AS displayName, s.email, ep.unsubscribe_token AS unsubscribeToken
       FROM email_preferences ep JOIN seats s ON s.id = ep.seat_id
       WHERE s.game_id = ? AND s.status = 'CLAIMED' AND ep.enabled = 1
       ORDER BY s.display_name COLLATE NOCASE`,
    )
    .bind(gameId)
    .all<Recipient>();
  return rows.results;
}

/** Opted-in players who still owe a response: the same rule the moderator's outstanding list uses. */
async function playersWhoMustAct(gameId: string, phase: PhaseContext['phase']): Promise<Recipient[]> {
  const optedIn = await optedInPlayers(gameId);
  if (!optedIn.length) return [];
  const [players, actions, loverPair] = await Promise.all([loadPlayers(gameId), loadActions(phase.id), loadCurrentLoverPair(gameId)]);
  const owing = new Set(outstandingResponders({ phase: { kind: phase.kind, status: 'OPEN' }, players, actions, cupidPairExists: Boolean(loverPair) }).map((player) => player.id));
  return optedIn.filter((recipient) => owing.has(recipient.seatId));
}

const RUNNING = new Set(['ACTIVE', 'FINAL_SHOWDOWN']);

/** A phase just opened. Tells the players who have something to do. */
export async function notifyPhaseOpened(gameId: string, phaseId: string): Promise<void> {
  try {
    const origin = siteOrigin();
    if (!origin || !emailNotificationsAvailable()) return;
    const context = await loadPhaseContext(gameId, phaseId);
    if (!context || context.phase.status !== 'OPEN' || !RUNNING.has(context.gameStatus)) return;
    const recipients = await playersWhoMustAct(gameId, context.phase);
    await deliver({
      gameId,
      eventId: `opened-${phaseId}`,
      label: `${phaseName(context.phase.kind, context.phase.sequence)} opened`,
      recipients,
      details: { kind: 'OPENED', phaseId },
      compose: (recipient) => phaseOpenedMessage(origin, recipient, { gameName: context.gameName, kind: context.phase.kind, sequence: context.phase.sequence, closesAt: context.phase.closesAt, timeZone: context.timeZone }),
    });
  } catch (error) {
    console.error('Phase-opened email failed', { name: error instanceof Error ? error.name : 'Error' });
  }
}

/**
 * Thirty minutes before a deadline, reminds the players who have not saved a move. The
 * first caller to mark the phase sends; every other caller (another poll, the scheduler)
 * finds it marked and does nothing, so the reminder goes out once. The mark comes first,
 * so a send that fails is reported to the moderator but not retried: retrying could mail
 * some players twice, and a broken mail account would be retried on every page visit.
 * Returns whether this call was the one that sent it.
 */
export async function notifyClosingSoon(gameId: string, phaseId: string): Promise<boolean> {
  try {
    const origin = siteOrigin();
    if (!origin || !emailNotificationsAvailable()) return false;
    const context = await loadPhaseContext(gameId, phaseId);
    if (!context || context.phase.status !== 'OPEN' || !RUNNING.has(context.gameStatus)) return false;
    const claimed = await getDb()
      .prepare("UPDATE phases SET closing_reminder_at = ? WHERE id = ? AND game_id = ? AND status = 'OPEN' AND closing_reminder_at IS NULL")
      .bind(new Date().toISOString(), phaseId, gameId)
      .run();
    if (changes(claimed) !== 1) return false;
    const recipients = await playersWhoMustAct(gameId, context.phase);
    await deliver({
      gameId,
      eventId: `closing-${phaseId}`,
      label: `${phaseName(context.phase.kind, context.phase.sequence)} closing soon`,
      recipients,
      details: { kind: 'CLOSING_SOON', phaseId },
      compose: (recipient) => closingSoonMessage(origin, recipient, { gameName: context.gameName, kind: context.phase.kind, sequence: context.phase.sequence, closesAt: context.phase.closesAt, timeZone: context.timeZone }),
    });
    return true;
  } catch (error) {
    console.error('Closing-soon email failed', { name: error instanceof Error ? error.name : 'Error' });
    return false;
  }
}

/** Whether a phase is inside its reminder window and has not been reminded. Pure, so a poll can check without a query. */
export function closingReminderDue(phase: { status: string; opensAt: string; closesAt: string; closingReminderAt: string | null }, now: Date): boolean {
  if (phase.status !== 'OPEN' || phase.closingReminderAt) return false;
  const closes = new Date(phase.closesAt).valueOf();
  const opens = new Date(phase.opensAt).valueOf();
  if (Number.isNaN(closes) || Number.isNaN(opens)) return false;
  if (closes - opens <= MIN_PHASE_MINUTES_FOR_REMINDER * 60_000) return false;
  const time = now.valueOf();
  return time < closes && time >= closes - CLOSING_SOON_MINUTES * 60_000;
}

/**
 * The scheduler's entry point: every running game whose open phase is inside its
 * reminder window. Players' and moderators' page refreshes do the same check for their
 * own game, so reminders still go out when no scheduler is set up and someone is looking.
 * Returns how many phases this call sent a reminder for.
 */
export async function sweepClosingReminders(now = new Date()): Promise<number> {
  if (!emailNotificationsAvailable()) return 0;
  const windowEnd = new Date(now.valueOf() + CLOSING_SOON_MINUTES * 60_000).toISOString();
  const due = await getDb()
    .prepare(
      `SELECT p.id AS phaseId, p.game_id AS gameId, p.status, p.opens_at AS opensAt, p.closes_at AS closesAt, p.closing_reminder_at AS closingReminderAt
       FROM phases p JOIN games g ON g.id = p.game_id
       WHERE p.status = 'OPEN' AND p.closing_reminder_at IS NULL AND p.closes_at > ? AND p.closes_at <= ?
         AND g.status IN ('ACTIVE', 'FINAL_SHOWDOWN')`,
    )
    .bind(now.toISOString(), windowEnd)
    .all<{ phaseId: string; gameId: string; status: string; opensAt: string; closesAt: string; closingReminderAt: string | null }>();
  let started = 0;
  for (const phase of due.results) {
    if (!closingReminderDue(phase, now)) continue;
    if (await notifyClosingSoon(phase.gameId, phase.phaseId)) started += 1;
  }
  return started;
}

/**
 * A result was just published. Every player who turned email on gets the recap, whether
 * or not they are still alive. The story is written once and sent to all of them.
 */
export async function notifyResultPublished(gameId: string, phaseId: string, options: { storyWriter?: StoryWriter | null } = {}): Promise<void> {
  try {
    const origin = siteOrigin();
    if (!origin || !emailNotificationsAvailable()) return;
    const recipients = await optedInPlayers(gameId);
    if (!recipients.length) return;
    const context = await loadPhaseContext(gameId, phaseId);
    if (!context) return;
    const event = await getDb()
      .prepare("SELECT payload_json AS payloadJson FROM game_events WHERE game_id = ? AND phase_id = ? AND event_type = 'PHASE_PUBLISHED' ORDER BY created_at DESC LIMIT 1")
      .bind(gameId, phaseId)
      .first<{ payloadJson: string }>();
    if (!event) return;
    const input = storyInputFromPublishedEvent(context.gameName, context.phase.kind, context.phase.sequence, JSON.parse(event.payloadJson) as Record<string, unknown>);
    const { story, source } = options.storyWriter === undefined ? await writeStory(input) : await writeStory(input, options.storyWriter);
    await deliver({
      gameId,
      eventId: `result-${phaseId}`,
      label: `${phaseName(context.phase.kind, context.phase.sequence)} result`,
      recipients,
      details: { kind: 'RESULT', phaseId, storySource: source, story },
      compose: (recipient) => resultPublishedMessage(origin, recipient, { gameName: context.gameName, kind: context.phase.kind, sequence: context.phase.sequence }, story),
    });
  } catch (error) {
    console.error('Result email failed', { name: error instanceof Error ? error.name : 'Error' });
  }
}
